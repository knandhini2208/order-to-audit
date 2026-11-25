import { pool, withTransaction } from '../src/db.js';
import { recordPurchase } from '../src/services/purchases.js';

const id = await withTransaction((client) =>
  recordPurchase(client, {
    billNo: 'BENCH-001',
    lines: [{ itemCode: 'FLOUR', qty: '60', unit: 'kg', rate: '45' }],
  })
);
console.log('Purchase recorded, id =', id);
await pool.end();