import { useState } from 'react';
import { downloadFile } from './api.js';

const FILES = [
  ['Sales register (all invoices)', '/reports/sales-register.csv', 'sales-register.csv'],
  ['Stock summary', '/reports/stock-summary.csv', 'stock-summary.csv'],
  ['Stock ledger (every movement)', '/reports/stock-ledger.csv', 'stock-ledger.csv'],
];

export default function Reports() {
  const [err, setErr] = useState('');
  return (
    <div className="card">
      <h2>Reports (CSV, opens in Excel)</h2>
      {FILES.map(([label, path, name]) => (
        <button key={path}
          onClick={() => downloadFile(path, name).catch((e) => setErr(e.message))}>
          {label}
        </button>
      ))}
      {err && <div className="err">{err}</div>}
    </div>
  );
}