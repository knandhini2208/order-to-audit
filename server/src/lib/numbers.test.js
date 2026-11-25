import { describe, it, expect } from 'vitest';
import { toScaledInt, divRound, valueOfIssue } from './numbers.js';

describe('toScaledInt', () => {
  it('converts kg and litres to base units', () => {
    expect(toScaledInt('60', 1000)).toBe(60000n);
    expect(toScaledInt('10.5', 1000)).toBe(10500n);
    expect(toScaledInt('1.2', 1000)).toBe(1200n);
  });
  it('converts rupees to paise', () => {
    expect(toScaledInt('45', 100)).toBe(4500n);
    expect(toScaledInt('2.50', 100)).toBe(250n);
  });
  it('rejects values that cannot be exact', () => {
    expect(() => toScaledInt('0.0005', 1000)).toThrow();
    expect(() => toScaledInt('abc', 1000)).toThrow();
  });
});

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(7n, 2n)).toBe(4n);
    expect(divRound(-7n, 2n)).toBe(-4n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(divRound(2n, 3n)).toBe(1n);
  });
});

describe('valueOfIssue (weighted average)', () => {
  it('values 40 kg of flour at Rs 1725 after the 60 kg purchase', () => {
    // balance: 160 kg worth 690000 paise (100 kg @ 42 + 60 kg @ 45)
    expect(valueOfIssue(690000n, 160000n, 40000n)).toBe(172500n);
  });
  it('issuing the whole balance returns the whole value', () => {
    expect(valueOfIssue(690000n, 160000n, 160000n)).toBe(690000n);
  });
});