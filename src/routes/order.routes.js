import { Router } from 'express';
import { Order } from '../models/Order.js';
import { Cart } from '../models/Cart.js';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { createValidatedOrder, releaseReservation } from '../services/order.service.js';

export const orderRoutes = Router();
orderRoutes.use(requireAuth, loadUser);

orderRoutes.get('/admin/all', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const [items, total] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments()
  ]);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

orderRoutes.patch('/:id/status', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { fulfillmentStatus } = req.body;
    const allowed = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(fulfillmentStatus)) return res.status(422).json({ message: 'Invalid fulfillment status' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const legal = {
      pending: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: []
    };
    if (!legal[order.fulfillmentStatus].includes(fulfillmentStatus)) return res.status(409).json({ message: 'Invalid state transition' });
    order.fulfillmentStatus = fulfillmentStatus;
    await order.save();
    res.json(order);
  } catch (error) {
    next(error);
  }
});

orderRoutes.post('/', async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    const order = await createValidatedOrder(req.user._id, cart?.couponCode);
    res.status(201).json({
      order,
      sandboxPayment: {
        checkoutUrl: null,
        reference: `TEST-${order._id}`,
        message: 'Configure PayMongo credentials to initiate real sandbox checkout.'
      }
    });
  } catch (error) {
    next(error);
  }
});

orderRoutes.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const [items, total] = await Promise.all([
    Order.find({ user: req.user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments({ user: req.user._id })
  ]);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

orderRoutes.get('/:id', async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  res.json(order);
});

orderRoutes.post('/:id/cancel', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Forbidden' });
    if (order.paymentStatus !== 'pending') return res.status(409).json({ message: 'Invalid state transition' });
    order.paymentStatus = 'cancelled';
    order.fulfillmentStatus = 'cancelled';
    await order.save();
    await releaseReservation(order);
    res.json(order);
  } catch (error) {
    next(error);
  }
});
