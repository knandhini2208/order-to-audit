import express from 'express';
import cors from 'cors';
import { pool, withTransaction } from './db.js';
import { login, requireAuth, requireRole } from './auth.js';
import { logAudit } from './services/audit.js';
import {
  createOrder, checkOrderStock, approveOrder, createInvoice,
  recordDispatch, recordPayment, StockShortageError,
} from './services/sales.js';
import { loadInvoice, renderInvoicePdf } from './services/invoicePdf.js';
import { recordProductionRun, getRunReport } from './services/production.js';

const app = express();
app.use(cors());
app.use(express.json());
app.set('json replacer', (k, v) => (typeof v === 'bigint' ? v.toString() : v));

const h = (fn) => (req, res, next) => fn(req, res).catch(next);
const ID = (req) => Number(req.params.id);

app.post('/api/login', h(async (req, res) => {
  const result = await login(req.body.username, req.body.password);
  if (!result) return res.status(401).json({ error: 'Wrong username or password' });
  res.json(result);
}));

app.use('/api', requireAuth);   // everything below needs a login

app.get('/api/me', (req, res) => res.json(req.user));

app.get('/api/products', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT code, name, selling_price_paise FROM items WHERE item_type = 'FG' ORDER BY id`);
  res.json(rows);
}));

app.get('/api/customers', requireRole('SALESMAN', 'ADMIN', 'OWNER'), h(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, customer_type, state_code FROM customers ORDER BY name');
  res.json(rows);
}));

// Salesman places an order; the price always comes from the price list
app.post('/api/orders', requireRole('SALESMAN'), h(async (req, res) => {
  const { customerId, lines, note } = req.body;
  const { rows: [cust] } = await pool.query('SELECT name FROM customers WHERE id = $1', [customerId]);
  if (!cust) return res.status(400).json({ error: 'Unknown customer' });
  const orderId = await withTransaction((c) => createOrder(c, {
    customerName: cust.name, salesmanUsername: req.user.username, lines, note,
  }));
  res.status(201).json({ orderId });
}));

// Salesmen see only their own orders; admin and owner see all
app.get('/api/orders', requireRole('SALESMAN', 'ADMIN', 'OWNER'), h(async (req, res) => {
  const own = req.user.role === 'SALESMAN';
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.created_at, c.name AS customer, u.full_name AS salesman,
            (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS packets,
            inv.id AS invoice_id, inv.invoice_no, inv.total_paise,
            COALESCE((SELECT SUM(amount_paise) FROM payments WHERE invoice_id = inv.id), 0) AS paid_paise
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = o.salesman_id
     LEFT JOIN invoices inv ON inv.order_id = o.id AND inv.status = 'POSTED'
     WHERE ($1::int IS NULL OR o.salesman_id = $1)
     ORDER BY o.id DESC`,
    [own ? req.user.id : null]);
  res.json(rows);
}));

app.get('/api/orders/:id/stock-check', requireRole('ADMIN'), h(async (req, res) => {
  res.json(await withTransaction((c) => checkOrderStock(c, ID(req))));
}));

app.post('/api/orders/:id/approve', requireRole('ADMIN'), h(async (req, res) => {
  await withTransaction((c) => approveOrder(c, ID(req), { userId: req.user.id }));
  res.json({ status: 'APPROVED' });
}));

app.post('/api/orders/:id/reject', requireRole('ADMIN'), h(async (req, res) => {
  await withTransaction(async (c) => {
    const { rows: [o] } = await c.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [ID(req)]);
    if (!o) throw new Error('Order not found');
    if (o.status !== 'SUBMITTED') throw new Error(`Order is ${o.status}, cannot reject`);
    await c.query(`UPDATE orders SET status = 'REJECTED' WHERE id = $1`, [ID(req)]);
    await logAudit(c, { userId: req.user.id, entity: 'order', entityId: ID(req), action: 'REJECT',
                        before: { status: 'SUBMITTED' }, after: { status: 'REJECTED' } });
  });
  res.json({ status: 'REJECTED' });
}));

app.post('/api/orders/:id/invoice', requireRole('ADMIN'), h(async (req, res) => {
  res.status(201).json(await withTransaction((c) => createInvoice(c, ID(req), { userId: req.user.id })));
}));

app.post('/api/invoices/:id/dispatch', requireRole('ADMIN'), h(async (req, res) => {
  await withTransaction((c) => recordDispatch(c, ID(req), { userId: req.user.id }));
  res.json({ status: 'DISPATCHED' });
}));

app.post('/api/invoices/:id/payments', requireRole('ADMIN'), h(async (req, res) => {
  const paymentId = await withTransaction((c) => recordPayment(c, {
    invoiceId: ID(req), amount: req.body.amount, mode: req.body.mode,
  }));
  res.status(201).json({ paymentId });
}));

app.get('/api/invoices/:id/pdf', requireRole('ADMIN', 'ACCOUNTANT', 'OWNER'), h(async (req, res) => {
  const data = await loadInvoice(pool, ID(req));
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `inline; filename="invoice-${data.inv.invoice_no.replace('/', '-')}.pdf"`);
  renderInvoicePdf(res, data);
}));

app.get('/api/bom/:code', requireRole('PRODUCTION', 'ADMIN', 'OWNER'), h(async (req, res) => {
  const { rows: [bom] } = await pool.query(
    `SELECT b.id, b.batch_yield, b.tolerance_bp, i.code, i.name
     FROM boms b JOIN items i ON i.id = b.fg_item_id WHERE i.code = $1`, [req.params.code]);
  if (!bom) return res.status(404).json({ error: 'No BOM for that product' });
  const { rows: items } = await pool.query(
    `SELECT i.code, i.name, i.item_type, i.base_unit, bi.qty_per_batch
     FROM bom_items bi JOIN items i ON i.id = bi.item_id
     WHERE bi.bom_id = $1 ORDER BY i.id`, [bom.id]);
  res.json({ product: bom.code, name: bom.name, batchYield: bom.batch_yield,
             toleranceBp: bom.tolerance_bp, items });
}));

app.post('/api/production-runs', requireRole('PRODUCTION', 'ADMIN'), h(async (req, res) => {
  const { productCode, batches, goodOutput, lines, labour, overhead } = req.body;
  const out = await withTransaction(async (c) => {
    const run = await recordProductionRun(c, {
      productCode, batches: batches || 1, goodOutput, lines,
      labour: labour || '0', overhead: overhead || '0',
    });
    await logAudit(c, { userId: req.user.id, entity: 'production_run', entityId: run.runId,
                        action: 'CREATE', after: { productCode, goodOutput } });
    return { runId: run.runId, report: await getRunReport(c, run.runId) };
  });
  res.status(201).json(out);
}));

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}
const REPORT_ROLES = ['ADMIN', 'ACCOUNTANT', 'OWNER'];

app.get('/api/reports/sales-register.csv', requireRole(...REPORT_ROLES), h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.invoice_no AS "Invoice No", to_char(i.invoice_date, 'DD-MM-YYYY') AS "Date",
            c.name AS "Customer", COALESCE(c.gstin, '') AS "Customer GSTIN",
            i.place_of_supply AS "Place of supply",
            (i.taxable_paise / 100.0)::numeric(14,2) AS "Taxable value",
            (i.cgst_paise / 100.0)::numeric(14,2) AS "CGST",
            (i.sgst_paise / 100.0)::numeric(14,2) AS "SGST",
            (i.igst_paise / 100.0)::numeric(14,2) AS "IGST",
            (i.total_paise / 100.0)::numeric(14,2) AS "Total", i.status AS "Status"
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE ($1::date IS NULL OR i.invoice_date >= $1::date)
       AND ($2::date IS NULL OR i.invoice_date <= $2::date)
     ORDER BY i.id`,
    [req.query.from || null, req.query.to || null]);
  sendCsv(res, 'sales-register.csv', rows);
}));

app.get('/api/reports/stock-summary.csv', requireRole(...REPORT_ROLES), h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.code AS "Code", i.name AS "Item", i.item_type AS "Type", i.base_unit AS "Unit",
            COALESCE(b.qty, 0) AS "Closing qty (base unit)",
            (COALESCE(b.value_paise, 0) / 100.0)::numeric(14,2) AS "Value"
     FROM items i LEFT JOIN stock_balance b ON b.item_id = i.id ORDER BY i.id`);
  sendCsv(res, 'stock-summary.csv', rows);
}));

app.get('/api/reports/stock-ledger.csv', requireRole(...REPORT_ROLES), h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id AS "Entry", to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI') AS "When",
            i.code AS "Item", l.movement_type AS "Movement", l.qty_delta AS "Qty change",
            i.base_unit AS "Unit",
            SUM(l.qty_delta) OVER (PARTITION BY l.item_id ORDER BY l.id) AS "Running balance",
            (l.value_delta_paise / 100.0)::numeric(14,2) AS "Value change",
            l.source_type AS "Source", l.source_id AS "Source id"
     FROM stock_ledger l JOIN items i ON i.id = l.item_id
     WHERE ($1::text IS NULL OR i.code = $1)
     ORDER BY i.id, l.id`,
    [req.query.item || null]);
  sendCsv(res, 'stock-ledger.csv', rows);
}));

app.get('/api/outstanding', requireRole('ADMIN', 'ACCOUNTANT', 'OWNER'), h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name,
            COALESCE((SELECT SUM(total_paise) FROM invoices
                      WHERE customer_id = c.id AND status = 'POSTED'), 0) AS billed_paise,
            COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = c.id), 0) AS paid_paise
     FROM customers c ORDER BY c.name`);
  res.json(rows);
}));

app.get('/api/stock', requireRole('ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'), h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.code, i.name, i.item_type, i.base_unit,
            COALESCE(b.qty, 0) AS qty, COALESCE(b.value_paise, 0) AS value_paise
     FROM items i LEFT JOIN stock_balance b ON b.item_id = i.id ORDER BY i.id`);
  res.json(rows);
}));

app.use((err, req, res, next) => {
  if (err instanceof StockShortageError) {
    return res.status(409).json({ error: err.message, shortages: err.shortages });
  }
  console.error(err.message);
  res.status(400).json({ error: err.message });
});

export default app;