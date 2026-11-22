import { Router } from 'express';
import { z } from 'zod';
import { Product } from '../models/Product.js';
import { requireAuth, requireAdmin, loadUser } from '../middleware/auth.js';

export const productRoutes = Router();

productRoutes.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const filter = { active: true };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) filter.$text = { $search: req.query.search };
  const sort = req.query.sort === 'price_desc' ? { price: -1 } : req.query.sort === 'price_asc' ? { price: 1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([
    Product.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter)
  ]);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

productRoutes.get('/admin/low-stock', requireAuth, loadUser, requireAdmin, async (req, res) => {
  const products = await Product.find({
    active: true,
    $expr: { $lte: ['$stock', '$lowStockThreshold'] }
  }).sort({ stock: 1 });
  res.json({ items: products });
});

productRoutes.get('/:id', async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, active: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

const productSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.enum(['CPU', 'motherboard', 'GPU', 'RAM', 'storage', 'PSU', 'case']),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  specifications: z.record(z.any()).optional()
});

productRoutes.post('/', requireAuth, loadUser, requireAdmin, async (req, res, next) => {
  try {
    const body = productSchema.parse(req.body);
    const product = await Product.create(body);
    res.status(201).json(product);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

productRoutes.patch('/:id', requireAuth, loadUser, requireAdmin, async (req, res, next) => {
  try {
    const body = productSchema.partial().parse(req.body);
    const product = await Product.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

productRoutes.delete('/:id', requireAuth, loadUser, requireAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});
