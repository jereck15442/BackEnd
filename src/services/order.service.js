import mongoose from 'mongoose';
import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { Coupon } from '../models/Coupon.js';
import { Order } from '../models/Order.js';

export function validateCoupon(coupon, subtotal) {
  const now = new Date();
  if (!coupon || !coupon.active) return { valid: false, message: 'Invalid coupon', status: 422 };
  if (now < coupon.validFrom || now > coupon.validUntil) return { valid: false, message: 'Invalid coupon', status: 422 };
  if (coupon.minimumPurchase && subtotal < coupon.minimumPurchase) return { valid: false, message: 'Coupon not eligible', status: 422 };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { valid: false, message: 'Coupon not eligible', status: 422 };
  return { valid: true };
}

export async function createValidatedOrder(userId, couponCode) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || cart.items.length === 0) throw Object.assign(new Error('Cart is empty'), { status: 422 });

  let subtotal = 0;
  const items = [];
  for (const item of cart.items) {
    if (item.quantity < 1) throw Object.assign(new Error('Quantity must be greater than zero'), { status: 422 });
    const product = await Product.findById(item.product._id);
    if (!product || !product.active) throw Object.assign(new Error(`Product ${item.product.name} is unavailable`), { status: 409 });
    if (product.stock < item.quantity) throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 409 });
    subtotal += product.price * item.quantity;
    items.push({ product: product._id, name: product.name, price: product.price, quantity: item.quantity });
  }

  let discount = 0;
  let coupon = null;
  if (couponCode) {
    coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    const result = validateCoupon(coupon, subtotal);
    if (!result.valid) throw Object.assign(new Error(result.message), { status: result.status });
    discount = coupon.discountType === 'percentage'
      ? subtotal * (coupon.discountValue / 100)
      : coupon.discountValue;
    discount = Math.min(discount, subtotal);
  }

  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      for (const item of items) {
        const result = await Product.updateOne(
          { _id: item.product, active: true, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } }
        );
        if (result.modifiedCount !== 1) throw Object.assign(new Error(`Insufficient stock for ${item.name}`), { status: 409 });
      }
      if (coupon) await Coupon.updateOne({ _id: coupon._id, usedCount: { $lt: coupon.usageLimit == null ? Number.MAX_SAFE_INTEGER : coupon.usageLimit } }, { $inc: { usedCount: 1 } });
      [order] = await Order.create([{
        user: userId, items, subtotal, discount, total: subtotal - discount,
        couponCode: coupon?.code || null, paymentStatus: 'pending', fulfillmentStatus: 'pending', reserved: true
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  cart.items = [];
  cart.couponCode = null;
  await cart.save();
  return order;
}

export async function releaseReservation(order) {
  if (!order.reserved) return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const item of order.items) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, { session });
      }
      order.reserved = false;
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }
}
