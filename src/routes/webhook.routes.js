import { Router } from 'express';
import crypto from 'node:crypto';
import { Order } from '../models/Order.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { releaseReservation } from '../services/order.service.js';

export const webhookRoutes = Router();

function validSignature(rawBody, signature) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  if (!signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const supplied = String(signature).replace(/^sha256=/, '');
  const a = Buffer.from(digest);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

webhookRoutes.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paymongo-signature'] || req.headers['paymongo-signature'];
  if (!validSignature(req.body, signature)) return res.status(401).json({ message: 'Invalid webhook' });

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid webhook payload' });
  }
  const eventId = event.id || event.data?.id;
  if (!eventId) return res.status(400).json({ message: 'Invalid webhook payload' });

  const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
  try {
    await WebhookEvent.create({ eventId, payloadHash });
  } catch (error) {
    if (error?.code === 11000) return res.status(200).json({ received: true, duplicate: true });
    throw error;
  }

  const data = event.data?.attributes || event.data || {};
  const orderId = data.metadata?.orderId || data.metadata?.order_id;
  if (!orderId) return res.status(200).json({ received: true });
  const order = await Order.findById(orderId);
  if (!order) return res.status(200).json({ received: true });

  const eventType = event.type || data.type || '';
  if (eventType.includes('payment.paid') || data.status === 'succeeded') {
    if (order.paymentStatus !== 'paid') {
      order.paymentStatus = 'paid';
      order.paymentReference = eventId;
      await order.save();
    }
  } else if (eventType.includes('failed') || eventType.includes('cancelled') || eventType.includes('expired') ||
             ['failed', 'cancelled', 'expired'].includes(data.status)) {
    if (order.paymentStatus === 'pending') {
      const newStatus = eventType.includes('cancelled') || data.status === 'cancelled' ? 'cancelled'
        : eventType.includes('expired') || data.status === 'expired' ? 'expired' : 'failed';
      order.paymentStatus = newStatus;
      await order.save();
      await releaseReservation(order);
    }
  }
  res.json({ received: true });
});
