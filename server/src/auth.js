import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

export async function login(username, password) {
  const { rows: [u] } = await pool.query(
    'SELECT id, username, full_name, role, password_hash FROM users WHERE username = $1', [username]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return null;
  const user = { id: u.id, username: u.username, name: u.full_name, role: u.role };
  return { token: jwt.sign(user, SECRET, { expiresIn: '12h' }), user };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Not allowed for your role' });