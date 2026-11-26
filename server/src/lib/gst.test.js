import { describe, it, expect } from 'vitest';
import { financialYear, formatInvoiceNo, computeLineTax } from './gst.js';

describe('computeLineTax', () => {
  it('Retailer A (Tamil Nadu): 150 packets gives CGST + SGST, total Rs 7,875', () => {
    const t = computeLineTax({ qty: 150, ratePaise: 5000, gstRateBp: 500,
                               sellerState: '33', placeOfSupply: '33' });
    expect(t.taxable).toBe(750000n);
    expect(t.cgst).toBe(18750n);
    expect(t.sgst).toBe(18750n);
    expect(t.igst).toBe(0n);
    expect(t.taxable + t.cgst + t.sgst + t.igst).toBe(787500n);
  });

  it('Distributor B (Karnataka): 120 packets gives IGST only', () => {
    const t = computeLineTax({ qty: 120, ratePaise: 5000, gstRateBp: 500,
                               sellerState: '33', placeOfSupply: '29' });
    expect(t.taxable).toBe(600000n);
    expect(t.igst).toBe(30000n);
    expect(t.cgst).toBe(0n);
    expect(t.sgst).toBe(0n);
  });

  it('rounds to whole paise', () => {
    const t = computeLineTax({ qty: 1, ratePaise: 5010, gstRateBp: 500,
                               sellerState: '33', placeOfSupply: '33' });
    expect(t.cgst).toBe(125n);   // 125.25 rounds to 125
    expect(t.sgst).toBe(125n);
  });
});

describe('financialYear', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-11-25')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
  });
});

describe('formatInvoiceNo', () => {
  it('pads the sequence', () => {
    expect(formatInvoiceNo('2026-27', 1)).toBe('2026-27/0001');
    expect(formatInvoiceNo('2026-27', 125)).toBe('2026-27/0125');
  });
});