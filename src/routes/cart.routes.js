import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';

export const cartRoutes = Router();
cartRoutes.use(requireAuth, loadUser);

async function getCart(userId) {
  let cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

cartRoutes.get('/', async (req, res) => {
  const cart = await getCart(req.user._id);
  res.json(cart);
});

cartRoutes.post('/items', async (req, res, next) => {
  try {
    const body = z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }).parse(req.body);
    const product = await Product.findById(body.productId);
    if (!product || !product.active) return res.status(409).json({ message: 'Product is inactive or unavailable' });
    if (product.stock < body.quantity) return res.status(409).json({ message: 'Insufficient stock' });
    const cart = await getCart(req.user._id);
    const existing = cart.items.find((item) => item.product._id?.toString() === body.productId);
    if (existing) existing.quantity += body.quantity;
    else cart.items.push({ product: product._id, quantity: body.quantity });
    await cart.save();
    res.status(201).json(cart);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

cartRoutes.patch('/items/:productId', async (req, res, next) => {
  try {
    const body = z.object({ quantity: z.number().int().positive() }).parse(req.body);
    const cart = await getCart(req.user._id);
    const item = cart.items.find((entry) => entry.product._id?.toString() === req.params.productId);
    if (!item) return res.status(404).json({ message: 'Cart item not found' });
    const product = await Product.findById(req.params.productId);
    if (!product || !product.active) return res.status(409).json({ message: 'Product is inactive or unavailable' });
    if (product.stock < body.quantity) return res.status(409).json({ message: 'Insufficient stock' });
    item.quantity = body.quantity;
    await cart.save();
    res.json(cart);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

cartRoutes.delete('/items/:productId', async (req, res) => {
  const cart = await getCart(req.user._id);
  cart.items = cart.items.filter((item) => item.product._id?.toString() !== req.params.productId);
  await cart.save();
  res.json(cart);
});
