import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth, loadUser } from '../middleware/auth.js';

export const authRoutes = Router();

authRoutes.post('/register', async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1),
      email: z.string().email(),
      password: z.string().min(8)
    }).parse(req.body);
    if (await User.exists({ email: body.email.toLowerCase() })) return res.status(409).json({ message: 'Email is already registered' });
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await User.create({ name: body.name, email: body.email, passwordHash });
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await user.comparePassword(body.password))) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'development-secret', { expiresIn: '8h' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

authRoutes.post('/logout', requireAuth, (_req, res) => res.json({ message: 'Logged out' }));
authRoutes.get('/me', requireAuth, loadUser, (req, res) => res.json({ id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role }));
