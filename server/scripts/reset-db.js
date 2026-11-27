import { pool } from '../src/db.js';
import { resetDatabase } from '../src/lib/setup.js';

await resetDatabase(pool, { allowNonTest: true });
console.log('Database reset: schema, seed data and demo users loaded.');
await pool.end();