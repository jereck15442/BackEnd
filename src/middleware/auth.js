import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET || 'development-secret');
    next();
  } catch {
    res.status(401).json({ message: 'Unauthorized' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  next();
}

export async function loadUser(req, res, next) {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  req.user = user;
  next();
}
