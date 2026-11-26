import { divRound } from './numbers.js';

// Indian financial year runs April to March. Accepts 'YYYY-MM-DD' or a Date.
export function financialYear(date) {
  let y, m;
  if (typeof date === 'string') {
    [y, m] = date.split('-').map(Number);
  } else {
    y = date.getFullYear();
    m = date.getMonth() + 1;
  }
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNo(fy, seq) {
  return `${fy}/${String(seq).padStart(4, '0')}`;
}

// Same state as the factory: CGST + SGST (half each). Different state: IGST.
// qty is in packets, ratePaise is paise per packet, gstRateBp 500 = 5%.
export function computeLineTax({ qty, ratePaise, gstRateBp, sellerState, placeOfSupply }) {
  const taxable = BigInt(qty) * BigInt(ratePaise);
  const rate = BigInt(gstRateBp);
  if (sellerState === placeOfSupply) {
    const half = divRound(taxable * rate, 20000n);
    return { taxable, cgst: half, sgst: half, igst: 0n };
  }
  return { taxable, cgst: 0n, sgst: 0n, igst: divRound(taxable * rate, 10000n) };
}