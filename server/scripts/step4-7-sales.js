import { pool, withTransaction } from '../src/db.js';
import {
  createOrder, checkOrderStock, approveOrder, previewInvoice, createInvoice,
  recordDispatch, recordPayment, getCustomerOutstanding, StockShortageError,
} from '../src/services/sales.js';

// Display only: paise to "Rs 7875.00" using integers (no floats)
const rs = (p) => `Rs ${p / 100n}.${String(p % 100n).padStart(2, '0')}`;

console.log('--- Step 4: Salesman A orders 150 packets for Retailer A (Tamil Nadu)');
const orderA = await withTransaction((c) => createOrder(c, {
  customerName: 'Retailer A', salesmanUsername: 'salesman_a',
  lines: [{ itemCode: 'MUR200', qty: 150 }],
}));
console.log('Order id:', orderA);

console.log('--- Step 5: Admin checks stock, approves, invoices, dispatches');
console.log('Stock check:', await withTransaction((c) => checkOrderStock(c, orderA)));
await withTransaction((c) => approveOrder(c, orderA));
const inv = await withTransaction((c) => createInvoice(c, orderA));
console.log(`Invoice ${inv.invoiceNo}: taxable ${rs(inv.taxable)}, CGST ${rs(inv.cgst)}, ` +
            `SGST ${rs(inv.sgst)}, IGST ${rs(inv.igst)}, total ${rs(inv.total)}`);
await withTransaction((c) => recordDispatch(c, inv.invoiceId));
console.log('Dispatched.');

console.log('--- Step 6: Salesman B orders 120 packets for Distributor B (Karnataka)');
const orderB = await withTransaction((c) => createOrder(c, {
  customerName: 'Distributor B', salesmanUsername: 'salesman_b',
  lines: [{ itemCode: 'MUR200', qty: 120 }],
}));
console.log('Stock check:', await withTransaction((c) => checkOrderStock(c, orderB)));
const prev = await withTransaction((c) => previewInvoice(c, orderB));
console.log(`If invoiced: taxable ${rs(prev.taxable)}, CGST ${rs(prev.cgst)}, ` +
            `SGST ${rs(prev.sgst)}, IGST ${rs(prev.igst)}`);
try {
  await withTransaction((c) => approveOrder(c, orderB));
} catch (e) {
  if (e instanceof StockShortageError) console.log('Approval blocked:', e.message);
  else throw e;
}

console.log('--- Step 7: Retailer A pays Rs 4,000');
await withTransaction((c) => recordPayment(c, { invoiceId: inv.invoiceId, amount: '4000', mode: 'UPI' }));
const out = await withTransaction((c) => getCustomerOutstanding(c, 'Retailer A'));
console.log(`Billed ${rs(out.billed)}, paid ${rs(out.paid)}, outstanding ${rs(out.outstanding)}`);

await pool.end();