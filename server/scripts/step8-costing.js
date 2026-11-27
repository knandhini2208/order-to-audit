import { pool, withTransaction } from '../src/db.js';
import { addRunOverheads } from '../src/services/production.js';
import { getRunCosting } from '../src/services/costing.js';

const rs = (p) => `Rs ${p / 100n}.${String(p % 100n).padStart(2, '0')}`;
const pct = (bp) => `${bp / 100n}.${String(bp % 100n).padStart(2, '0')}%`;

console.log('--- Step 8: add labour Rs 1,200 and gas/power Rs 600 to run 1');
await withTransaction((c) => addRunOverheads(c, 1, { labour: '1200', overhead: '600' }));

const k = await withTransaction((c) => getRunCosting(c, 1));
console.log('Materials     :', rs(k.materialCostPaise));
console.log('Labour        :', rs(k.labourPaise));
console.log('Gas/power     :', rs(k.overheadPaise));
console.log('Total run cost:', rs(k.totalCostPaise));
console.log('Good packets  :', k.goodPackets);
console.log('Cost per packet:', rs(k.costPerPacketPaise));
console.log('Selling price :', rs(k.sellingPricePaise));
console.log('Margin        :', rs(k.marginPaise), `(${pct(k.marginBp)})`);
await pool.end();