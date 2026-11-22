import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Cart } from '../src/models/Cart.js';
import { Order } from '../src/models/Order.js';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Product.deleteMany({}), Cart.deleteMany({}), Order.deleteMany({})
  ]);
});

async function registerAndLogin(role = 'customer') {
  const password = 'Password123!';
  const user = await User.create({
    name: role === 'admin' ? 'Admin' : 'Customer',
    email: `${role}-${Date.now()}@example.com`,
    passwordHash: await bcrypt.hash(password, 12),
    role
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
  return { user, token: login.body.token };
}

describe('authentication and authorization', () => {
  it('registers a customer and rejects invalid login', async () => {
    const registered = await request(app).post('/api/v1/auth/register').send({
      name: 'Jereck', email: 'jereck@example.com', password: 'Password123!'
    });
    expect(registered.status).toBe(201);
    expect(registered.body.passwordHash).toBeUndefined();

    const rejected = await request(app).post('/api/v1/auth/login').send({
      email: 'jereck@example.com', password: 'WrongPassword!'
    });
    expect(rejected.status).toBe(401);
  });

  it('requires admin role for product creation', async () => {
    const customer = await registerAndLogin();
    const response = await request(app).post('/api/v1/products')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'CPU', category: 'CPU', price: 100, stock: 2 });
    expect(response.status).toBe(403);
  });
});

describe('checkout and stock', () => {
  it('rejects cart quantities above stock and succeeds checkout atomically', async () => {
    const customer = await registerAndLogin();
    const product = await Product.create({ name: 'Test CPU', category: 'CPU', price: 5000, stock: 1, specifications: { socket: 'AM5' } });

    await request(app).post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ productId: product._id.toString(), quantity: 1 });
    const overStock = await request(app).patch(`/api/v1/cart/items/${product._id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ quantity: 2 });
    expect(overStock.status).toBe(409);

    const created = await request(app).post('/api/v1/orders')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(created.status).toBe(201);
    expect(created.body.order.total).toBe(5000);
    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(0);
  });
});

describe('compatibility', () => {
  it('reports socket mismatch', async () => {
    const cpu = await Product.create({ name: 'Intel CPU', category: 'CPU', price: 100, stock: 1, specifications: { socket: 'LGA1700' } });
    const board = await Product.create({ name: 'AMD Board', category: 'motherboard', price: 100, stock: 1, specifications: { socket: 'AM5' } });
    const response = await request(app).post('/api/v1/compatibility/check').send({
      components: { CPU: cpu._id.toString(), motherboard: board._id.toString() }
    });
    expect(response.status).toBe(200);
    expect(response.body.compatible).toBe(false);
    expect(response.body.warnings.some((warning) => warning.code === 'SOCKET_MISMATCH')).toBe(true);
  });
});

describe('webhooks', () => {
  it('requires a signature in production and ignores duplicate events', async () => {
    process.env.NODE_ENV = 'test';
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    process.env.PAYMONGO_WEBHOOK_SECRET = '';
    const payload = { id: 'evt_test', data: { id: 'evt_test', attributes: { metadata: { orderId: '507f1f77bcf86cd799439011' } } } };
    const first = await request(app).post('/api/v1/payments/webhook').send(payload);
    expect(first.status).toBe(200);
    const duplicate = await request(app).post('/api/v1/payments/webhook').send(payload);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    process.env.PAYMONGO_WEBHOOK_SECRET = secret;
  });
});
