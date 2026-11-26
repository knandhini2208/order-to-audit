import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const users = [
  ['salesman_a', 'Salesman A', 'SALESMAN'],
  ['salesman_b', 'Salesman B', 'SALESMAN'],
  ['admin', 'Factory Admin', 'ADMIN'],
  ['production', 'Production Supervisor', 'PRODUCTION'],
  ['accountant', 'Accountant', 'ACCOUNTANT'],
  ['owner', 'Owner', 'OWNER'],
];

const hash = await bcrypt.hash('Demo@123', 10);
for (const [username, fullName, role] of users) {
  await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING`,
    [username, hash, fullName, role]);
}
console.log('Users ready. Demo password for all: Demo@123');
await pool.end();