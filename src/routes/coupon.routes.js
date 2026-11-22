import { Router } from 'express';
import { z } from 'zod';
import { Coupon } from '../models/Coupon.js';
import { Cart } from '../models/Cart.js';
import { requireAuth, requireAdmin, loadUser } from '../middleware/auth.js';

export const couponRoutes = Router();

couponRoutes.post('/apply', requireAuth, loadUser, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim().min(1) }).parse(req.body);
    const coupon = await Coupon.findOne({ code: code.toUpper(), active: true });
    const now = new Date();
    if (!coupon || now < coupon.validFrom || now > coupon.validUntil ||
        (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit)) {
      return res.status(422).json({ message: 'Invalid coupon' });
    }
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(422).json({ message: 'Cart is empty' });
    await Cart.updateOne({ user: req.user._id }, { couponCode: coupon.code });
    res.json({ code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});

couponRoutes.post('/', requireAuth, loadUser, requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      code: z.string().trim().min(1),
      discountType: z.enum(['percentage', 'fixed']),
      discountValue: z.number().nonnegative(),
      minimumPurchase: z.number().nonnegative().optional(),
      usageLimit: z.number().int().positive().nullable().optional(),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date(),
      active: z.boolean().optional()
    }).parse(req.body);
    if (body.validUntil <= body.validFrom) return res.status(422).json({ message: 'validUntil must be after validFrom' });
    const coupon = await Coupon.create(body);
    res.status(201).json(coupon);
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    next(error);
  }
});
