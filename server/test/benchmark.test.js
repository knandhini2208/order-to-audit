import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, withTransaction as tx } from '../src/db.js';
import { resetDatabase } from '../src/lib/setup.js';
import { recordPurchase } from '../src/services/purchases.js';
import { recordProductionRun, getRunReport, addRunOverheads } from '../src/services/production.js';
import { getRunCosting } from '../src/services/costing.js';
import {
  createOrder, checkOrderStock, approveOrder, previewInvoice, createInvoice,
  recordDispatch, recordPayment, getCustomerOutstanding, StockShortageError,
} from '../src/services/sales.js';
import { InsufficientStockError } from '../src/services/stock.js';

async function balance(code) {
  const { rows: [r] } = await pool.query(
    `SELECT b.qty, b.value_paise FROM stock_balance b
     JOIN items i ON i.id = b.item_id WHERE i.code = $1`, [code]);
  return { qty: BigInt(r.qty), value: BigInt(r.value_paise) };
}

describe('Section 5 benchmark, replayed end to end', () => {
  const ctx = {};

  beforeAll(async () => { await resetDatabase(pool); });
  afterAll(async () => { await pool.end(); });

  it('starts from the opening stock in the master data', async () => {
    expect((await balance('FLOUR')).qty).toBe(100000n);
    expect((await balance('OIL')).qty).toBe(30000n);
    expect((await balance('POUCH200')).qty).toBe(500n);
    expect((await balance('MUR200')).qty).toBe(50n);
  });

  it('step 1: purchase of 60 kg flour at Rs 45', async () => {
    await tx((c) => recordPurchase(c, {
      billNo: 'BENCH-001',
      lines: [{ itemCode: 'FLOUR', qty: '60', unit: 'kg', rate: '45' }],
    }));
    const flour = await balance('FLOUR');
    expect(flour.qty).toBe(160000n);
    expect(flour.value).toBe(690000n);          // 100 kg @ 42 + 60 kg @ 45
  });

  it('steps 2-3: production run updates raw, packaging and finished stock', async () => {
    const r = await tx((c) => recordProductionRun(c, {
      productCode: 'MUR200', goodOutput: 188,
      lines: [
        { itemCode: 'FLOUR', qty: '40', unit: 'kg' },
        { itemCode: 'OIL', qty: '10.5', unit: 'l' },
        { itemCode: 'SPICE', qty: '1.2', unit: 'kg' },
        { itemCode: 'POUCH200', qty: '188', unit: 'pcs', wasted: '6' },
        { itemCode: 'CARTON20', qty: '9', unit: 'pcs' },
      ],
    }));
    ctx.runId = r.runId;
    expect((await balance('FLOUR')).qty).toBe(120000n);     // 120 kg
    expect((await balance('OIL')).qty).toBe(19500n);        // 19.5 L
    expect((await balance('POUCH200')).qty).toBe(306n);
    expect((await balance('MUR200')).qty).toBe(238n);
    expect(r.materialCostPaise).toBe(405500n);              // Rs 4,055 (weighted average)
  });

  it('steps 2-3: variances are calculated and flagged', async () => {
    const report = await tx((c) => getRunReport(c, ctx.runId));
    const row = (code) => report.consumption.find((x) => x.item === code);
    expect(report.yield.variancePct).toBe('-6.00%');
    expect(report.yield.flagged).toBe(true);
    expect(row('OIL').variancePct).toBe('5.00%');
    expect(row('OIL').flagged).toBe(true);
    expect(row('FLOUR').flagged).toBe(false);
  });

  it('steps 4-5: Retailer A order becomes a CGST+SGST invoice of Rs 7,875', async () => {
    ctx.orderA = await tx((c) => createOrder(c, {
      customerName: 'Retailer A', salesmanUsername: 'salesman_a',
      lines: [{ itemCode: 'MUR200', qty: 150 }],
    }));
    const check = await tx((c) => checkOrderStock(c, ctx.orderA));
    expect(check[0].available).toBe(238n);
    expect(check[0].shortage).toBe(0n);
    await tx((c) => approveOrder(c, ctx.orderA));
    ctx.inv = await tx((c) => createInvoice(c, ctx.orderA, { invoiceDate: '2026-11-25' }));
    expect(ctx.inv.invoiceNo).toBe('2026-27/0001');
    expect(ctx.inv.taxable).toBe(750000n);
    expect(ctx.inv.cgst).toBe(18750n);
    expect(ctx.inv.sgst).toBe(18750n);
    expect(ctx.inv.igst).toBe(0n);
    expect(ctx.inv.total).toBe(787500n);
  });

  it('step 5: dispatch takes finished goods down to 88', async () => {
    await tx((c) => recordDispatch(c, ctx.inv.invoiceId));
    expect((await balance('MUR200')).qty).toBe(88n);
  });

  it('step 6: Distributor B order shows a shortage of 32 and IGST', async () => {
    ctx.orderB = await tx((c) => createOrder(c, {
      customerName: 'Distributor B', salesmanUsername: 'salesman_b',
      lines: [{ itemCode: 'MUR200', qty: 120 }],
    }));
    const check = await tx((c) => checkOrderStock(c, ctx.orderB));
    expect(check[0].required).toBe(120n);
    expect(check[0].available).toBe(88n);
    expect(check[0].shortage).toBe(32n);
    const preview = await tx((c) => previewInvoice(c, ctx.orderB));
    expect(preview.igst).toBe(30000n);
    expect(preview.cgst).toBe(0n);
    expect(preview.sgst).toBe(0n);
  });

  it('step 6: the short order cannot be approved and stock is untouched', async () => {
    await expect(tx((c) => approveOrder(c, ctx.orderB))).rejects.toBeInstanceOf(StockShortageError);
    const { rows: [o] } = await pool.query('SELECT status FROM orders WHERE id = $1', [ctx.orderB]);
    expect(o.status).toBe('SUBMITTED');
    expect((await balance('MUR200')).qty).toBe(88n);
  });

  it('step 7: Rs 4,000 payment leaves Rs 3,875 outstanding', async () => {
    await tx((c) => recordPayment(c, { invoiceId: ctx.inv.invoiceId, amount: '4000', mode: 'UPI' }));
    const out = await tx((c) => getCustomerOutstanding(c, 'Retailer A'));
    expect(out.billed).toBe(787500n);
    expect(out.paid).toBe(400000n);
    expect(out.outstanding).toBe(387500n);
  });

  it('step 8: labour and gas/power give Rs 31.14 per packet', async () => {
    await tx((c) => addRunOverheads(c, ctx.runId, { labour: '1200', overhead: '600' }));
    const k = await tx((c) => getRunCosting(c, ctx.runId));
    expect(k.totalCostPaise).toBe(585500n);        // 4055 + 1200 + 600
    expect(k.costPerPacketPaise).toBe(3114n);      // 585500 / 188 = 3114.36 paise
    expect(k.marginPaise).toBe(1886n);
    expect(k.marginBp).toBe(3772n);                // 37.72%
  });

  it('the stock ledger cannot be edited or deleted', async () => {
    await expect(pool.query('UPDATE stock_ledger SET qty_delta = 1')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM stock_ledger')).rejects.toThrow(/append-only/);
  });

  it('a failed production run changes nothing (one transaction per event)', async () => {
    const before = await balance('FLOUR');
    await expect(tx((c) => recordProductionRun(c, {
      productCode: 'MUR200', goodOutput: 10,
      lines: [{ itemCode: 'FLOUR', qty: '1000', unit: 'kg' }],
    }))).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await balance('FLOUR')).qty).toBe(before.qty);
    const { rows: [r] } = await pool.query('SELECT count(*)::int AS n FROM production_runs');
    expect(r.n).toBe(1);
  });
});