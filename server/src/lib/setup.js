import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db');
const FILES = ['schema.sql', 'seed.sql', 'schema_sales.sql', 'seed_sales.sql'];

const USERS = [
  ['salesman_a', 'Salesman A', 'SALESMAN'],
  ['salesman_b', 'Salesman B', 'SALESMAN'],
  ['admin', 'Factory Admin', 'ADMIN'],
  ['production', 'Production Supervisor', 'PRODUCTION'],
  ['accountant', 'Accountant', 'ACCOUNTANT'],
  ['owner', 'Owner', 'OWNER'],
];

export async function seedUsers(pool) {
  const hash = await bcrypt.hash('Demo@123', 10);
  for (const [username, fullName, role] of USERS) {
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING`,
      [username, hash, fullName, role]);
  }
}

// Wipes everything and reloads schema + seed data + demo users.
// Safety: refuses to touch any database whose name does not end in _test,
// unless allowNonTest is passed on purpose.
export async function resetDatabase(pool, { allowNonTest = false } = {}) {
  const { rows: [{ name }] } = await pool.query('SELECT current_database() AS name');
  if (!allowNonTest && !name.endsWith('_test')) {
    throw new Error(`Refusing to reset "${name}": only databases ending in _test are reset automatically`);
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const f of FILES) {
    await pool.query(fs.readFileSync(path.join(dbDir, f), 'utf8'));
  }
  await seedUsers(pool);
}