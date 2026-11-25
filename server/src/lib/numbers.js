// Parse a decimal string like "10.5" into an integer scaled by `scale`.
// toScaledInt("10.5", 1000) -> 10500n. Throws if it can't be exact.
export function toScaledInt(amount, scale) {
  const s = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid number: ${amount}`);
  const [intPart, frac = ''] = s.split('.');
  const denom = 10n ** BigInt(frac.length);
  const numer = BigInt(intPart + frac) * BigInt(scale);
  if (numer % denom !== 0n) throw new Error(`${amount} is too precise for scale ${scale}`);
  return numer / denom;
}

// Integer division rounded half away from zero.
export function divRound(n, d) {
  if (d === 0n) throw new Error('Division by zero');
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return negative ? -q : q;
}

// Weighted-average value of issuing `qty` from a balance of (balQty, balValue).
export function valueOfIssue(balValue, balQty, qty) {
  if (balQty <= 0n) throw new Error('No stock to value');
  return divRound(balValue * qty, balQty);
}