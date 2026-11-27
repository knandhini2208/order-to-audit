import express from 'express';
import cors from 'cors';
import { pool, withTransaction } from './db.js';
import { login, requireAuth, requireRole } from './auth.js';
import {
  createOrder, checkOrderStock, approveOrder, createInvoice,
  recordDispatch, recordPayment, StockShortageError,
} from './services/sales.js';

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
            (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS packets
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = o.salesman_id
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