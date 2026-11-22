import { Router } from 'express';
import { z } from 'zod';
import { SavedBuild } from '../models/SavedBuild.js';
import { Cart } from '../models/Cart.js';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { resolveBuildComponents, checkCompatibility } from '../services/compatibility.service.js';
import { Product } from '../models/Product.js';

export const buildRoutes = Router();
buildRoutes.use(requireAuth, loadUser);

buildRoutes.post('/validate', async (req, res, next) => {
  try {
    const components = z.record(z.string()).parse(req.body.components || {});
    const products = await resolveBuildComponents(components);
    const total = Object.values(products).reduce((sum, product) => sum + product.price, 0);
    res.json({ components: products, estimatedPrice: total, ...checkCompatibility(products) });
  } catch (error) {
    next(error);
  }
});

buildRoutes.post('/', async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1), components: z.record(z.string()) }).parse(req.body);
    await resolveBuildComponents(body.components);
    const build = await SavedBuild.create({ user: req.user._id, name: body.name, components: body.components });
    res.status(201).json(build);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

buildRoutes.get('/', async (req, res) => {
  res.json(await SavedBuild.find({ user: req.user._id }).sort({ createdAt: -1 }));
});

buildRoutes.get('/:id', async (req, res) => {
  const build = await SavedBuild.findById(req.params.id);
  if (!build) return res.status(404).json({ message: 'Saved build not found' });
  if (build.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Forbidden' });
  res.json(build);
});

buildRoutes.post('/:id/cart', async (req, res, next) => {
  try {
    const build = await SavedBuild.findById(req.params.id);
    if (!build) return res.status(404).json({ message: 'Saved build not found' });
    if (build.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Forbidden' });
    const components = Object.fromEntries(build.components);
    const products = await resolveBuildComponents(components);
    const cart = await Cart.findOne({ user: req.user._id }) || await Cart.create({ user: req.user._id, items: [] });
    for (const product of Object.values(products)) {
      if (product.stock < 1) return res.status(409).json({ message: `Insufficient stock for ${product.name}` });
      const existing = cart.items.find((item) => item.product.toString() === product._id.toString());
      if (existing) existing.quantity += 1;
      else cart.items.push({ product: product._id, quantity: 1 });
    }
    await cart.save();
    res.status(201).json({ cart, compatibility: checkCompatibility(products) });
  } catch (error) {
    next(error);
  }
});
