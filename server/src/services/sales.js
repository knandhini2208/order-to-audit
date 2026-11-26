import { financialYear, formatInvoiceNo, computeLineTax } from '../lib/gst.js';
import { toScaledInt } from '../lib/numbers.js';
import { issueAtAverageCost, getBalance } from './stock.js';
import { logAudit } from './audit.js';

export class StockShortageError extends Error {
  constructor(shortages) {
    super('Insufficient finished-goods stock: ' +
      shortages.map((s) => `${s.item} short by ${s.shortage} (need ${s.required}, have ${s.available})`).join('; '));
    this.shortages = shortages;
  }
}

// lines: [{ itemCode: 'MUR200', qty: 150 }]. Price comes from the price list (items.selling_price_paise).
export async function createOrder(client, { customerName, salesmanUsername = null, lines, note = null }) {
  const { rows: [customer] } = await client.query('SELECT id FROM customers WHERE name = $1', [customerName]);
  if (!customer) throw new Error(`Unknown customer: ${customerName}`);

  let salesmanId = null;
  if (salesmanUsername) {
    const { rows: [u] } = await client.query(
      `SELECT id FROM users WHERE username = $1 AND role = 'SALESMAN'`, [salesmanUsername]);
    if (!u) throw new Error(`Unknown salesman: ${salesmanUsername}`);
    salesmanId = u.id;
  }

  const { rows: [order] } = await client.query(
    `INSERT INTO orders (customer_id, salesman_id, note) VALUES ($1, $2, $3) RETURNING id`,
    [customer.id, salesmanId, note]);

  for (const line of lines) {
    const qty = BigInt(line.qty);
    if (qty <= 0n) throw new Error('Quantity must be positive');
    const { rows: [item] } = await client.query(
      `SELECT id, selling_price_paise FROM items WHERE code = $1 AND item_type = 'FG'`, [line.itemCode]);
    if (!item || item.selling_price_paise == null) throw new Error(`${line.itemCode} cannot be sold`);
    await client.query(
      `INSERT INTO order_items (order_id, item_id, qty, rate_paise) VALUES ($1, $2, $3, $4)`,
      [order.id, item.id, qty.toString(), item.selling_price_paise]);
  }
  return order.id;
}

// Shows whether finished-goods stock covers the order (admin sees this before approving).
export async function checkOrderStock(client, orderId) {
  const { rows } = await client.query(
    `SELECT oi.item_id, i.code, SUM(oi.qty) AS required
     FROM order_items oi JOIN items i ON i.id = oi.item_id
     WHERE oi.order_id = $1 GROUP BY oi.item_id, i.code ORDER BY oi.item_id`, [orderId]);
  const result = [];
  for (const r of rows) {
    const bal = await getBalance(client, r.item_id);
    const required = BigInt(r.required);
    result.push({
      item: r.code, required, available: bal.qty,
      shortage: required > bal.qty ? required - bal.qty : 0n,
    });
  }
  return result;
}

export async function approveOrder(client, orderId, { userId = null } = {}) {
  const { rows: [order] } = await client.query(
    'SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status !== 'SUBMITTED') throw new Error(`Order ${orderId} is ${order.status}, cannot approve`);

  const short = (await checkOrderStock(client, orderId)).filter((c) => c.shortage > 0n);
  if (short.length) throw new StockShortageError(short);

  await client.query(`UPDATE orders SET status = 'APPROVED' WHERE id = $1`, [orderId]);
  await logAudit(client, { userId, entity: 'order', entityId: orderId, action: 'APPROVE',
                           before: { status: 'SUBMITTED' }, after: { status: 'APPROVED' } });
}

// Works out tax for an order. CGST+SGST if same state as the factory, otherwise IGST.
async function buildInvoice(client, orderId) {
  const { rows: [order] } = await client.query(
    `SELECT o.id, o.status, o.customer_id, c.state_code AS place_of_supply
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId]);
  if (!order) throw new Error(`Order ${orderId} not found`);
  const { rows: [company] } = await client.query('SELECT state_code FROM company WHERE id = 1');
  const { rows: items } = await client.query(
    `SELECT oi.item_id, oi.qty, oi.rate_paise, i.hsn_code, i.gst_rate_bp
     FROM order_items oi JOIN items i ON i.id = oi.item_id
     WHERE oi.order_id = $1 ORDER BY oi.id`, [orderId]);

  const lines = items.map((it) => ({
    ...it,
    ...computeLineTax({
      qty: it.qty, ratePaise: it.rate_paise, gstRateBp: it.gst_rate_bp,
      sellerState: company.state_code, placeOfSupply: order.place_of_supply,
    }),
  }));
  const sum = (k) => lines.reduce((s, l) => s + l[k], 0n);
  const taxable = sum('taxable'), cgst = sum('cgst'), sgst = sum('sgst'), igst = sum('igst');
  return { order, lines, taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
}

export async function previewInvoice(client, orderId) {
  const { order, lines, ...totals } = await buildInvoice(client, orderId);
  return totals;
}

export async function createInvoice(client, orderId, { userId = null, invoiceDate = null } = {}) {
  await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const inv = await buildInvoice(client, orderId);
  if (inv.order.status !== 'APPROVED') {
    throw new Error(`Order ${orderId} is ${inv.order.status}; only APPROVED orders can be invoiced`);
  }

  const { rows: [{ d }] } = await client.query(
    `SELECT to_char(COALESCE($1::date, CURRENT_DATE), 'YYYY-MM-DD') AS d`, [invoiceDate]);
  const fy = financialYear(d);

  // Gapless numbering per financial year; the counter row is locked until commit.
  const { rows: [c] } = await client.query(
    `INSERT INTO invoice_counters (fy, last_seq) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_seq = invoice_counters.last_seq + 1
     RETURNING last_seq`, [fy]);
  const invoiceNo = formatInvoiceNo(fy, c.last_seq);

  const { rows: [row] } = await client.query(
    `INSERT INTO invoices (invoice_no, order_id, customer_id, invoice_date, place_of_supply,
                           taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [invoiceNo, orderId, inv.order.customer_id, d, inv.order.place_of_supply,
     inv.taxable.toString(), inv.cgst.toString(), inv.sgst.toString(),
     inv.igst.toString(), inv.total.toString()]);

  for (const l of inv.lines) {
    await client.query(
      `INSERT INTO invoice_items (invoice_id, item_id, hsn_code, qty, rate_paise, gst_rate_bp,
                                  taxable_paise, cgst_paise, sgst_paise, igst_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [row.id, l.item_id, l.hsn_code, l.qty, l.rate_paise, l.gst_rate_bp,
       l.taxable.toString(), l.cgst.toString(), l.sgst.toString(), l.igst.toString()]);
  }

  await client.query(`UPDATE orders SET status = 'INVOICED' WHERE id = $1`, [orderId]);
  await logAudit(client, { userId, entity: 'invoice', entityId: row.id, action: 'CREATE',
                           after: { invoiceNo, total: inv.total } });
  return { invoiceId: row.id, invoiceNo, taxable: inv.taxable, cgst: inv.cgst,
           sgst: inv.sgst, igst: inv.igst, total: inv.total };
}

// Dispatch takes finished goods out of the ledger, linked to the invoice.
export async function recordDispatch(client, invoiceId, { userId = null } = {}) {
  const { rows: [inv] } = await client.query(
    'SELECT id, status, order_id FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  if (inv.status !== 'POSTED') throw new Error(`Invoice ${invoiceId} is ${inv.status}`);
  const { rows: done } = await client.query('SELECT 1 FROM dispatches WHERE invoice_id = $1', [invoiceId]);
  if (done.length) throw new Error(`Invoice ${invoiceId} is already dispatched`);

  const { rows: lines } = await client.query(
    'SELECT item_id, qty FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
  for (const l of lines) {
    await issueAtAverageCost(client, {
      itemId: l.item_id, qty: BigInt(l.qty), movementType: 'DISPATCH',
      sourceType: 'invoice', sourceId: invoiceId,
    });
  }
  await client.query('INSERT INTO dispatches (invoice_id) VALUES ($1)', [invoiceId]);
  await client.query(`UPDATE orders SET status = 'DISPATCHED' WHERE id = $1`, [inv.order_id]);
  await logAudit(client, { userId, entity: 'invoice', entityId: invoiceId, action: 'DISPATCH' });
}

export async function recordPayment(client, { invoiceId, amount, mode = null, paidOn = null }) {
  const { rows: [inv] } = await client.query(
    'SELECT id, customer_id, total_paise, status FROM invoices WHERE id = $1', [invoiceId]);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  if (inv.status !== 'POSTED') throw new Error(`Invoice ${invoiceId} is ${inv.status}`);

  const paise = toScaledInt(amount, 100);
  const { rows: [p] } = await client.query(
    'SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM payments WHERE invoice_id = $1', [invoiceId]);
  const outstanding = BigInt(inv.total_paise) - BigInt(p.paid);
  if (paise > outstanding) throw new Error(`Payment is more than the outstanding ${outstanding} paise`);

  const { rows: [row] } = await client.query(
    `INSERT INTO payments (customer_id, invoice_id, amount_paise, paid_on, mode)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5) RETURNING id`,
    [inv.customer_id, invoiceId, paise.toString(), paidOn, mode]);
  return row.id;
}

export async function getCustomerOutstanding(client, customerName) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE((SELECT SUM(total_paise) FROM invoices
                      WHERE customer_id = c.id AND status = 'POSTED'), 0) AS billed,
            COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = c.id), 0) AS paid
     FROM customers c WHERE c.name = $1`, [customerName]);
  if (!r) throw new Error(`Unknown customer: ${customerName}`);
  const billed = BigInt(r.billed), paid = BigInt(r.paid);
  return { billed, paid, outstanding: billed - paid };
}