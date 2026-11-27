import { pool } from '../src/db.js';
import { seedUsers } from '../src/lib/setup.js';

await seedUsers(pool);
console.log('Users ready. Demo password for all: Demo@123');
await pool.end();