import { pool, withTransaction } from '../src/db.js';
import { recordProductionRun, getRunReport } from '../src/services/production.js';

const { runId } = await withTransaction((client) =>
  recordProductionRun(client, {
    productCode: 'MUR200',
    goodOutput: 188,
    lines: [
      { itemCode: 'FLOUR',    qty: '40',   unit: 'kg' },
      { itemCode: 'OIL',      qty: '10.5', unit: 'l' },        // 0.5 L over standard
      { itemCode: 'SPICE',    qty: '1.2',  unit: 'kg' },
      { itemCode: 'POUCH200', qty: '188',  unit: 'pcs', wasted: '6' },
      { itemCode: 'CARTON20', qty: '9',    unit: 'pcs' },
    ],
  })
);

const report = await withTransaction((client) => getRunReport(client, runId));
console.log('Run id:', runId);
console.table(report.consumption);
console.log('Yield:', report.yield);
console.log('Material cost (paise):', report.materialCostPaise);
await pool.end();