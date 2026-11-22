import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { authRoutes } from './routes/auth.routes.js';
import { productRoutes } from './routes/product.routes.js';
import { cartRoutes } from './routes/cart.routes.js';
import { couponRoutes } from './routes/coupon.routes.js';
import { orderRoutes } from './routes/order.routes.js';
import { buildRoutes } from './routes/build.routes.js';
import { compatibilityRoutes } from './routes/compatibility.routes.js';
import { advisorRoutes } from './routes/advisor.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';

export const app = express();

app.use(helmet());
app.use(cors());
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const openapiPath = path.resolve('openapi.yaml');
const openapi = fs.existsSync(openapiPath)
  ? YAML.parse(fs.readFileSync(openapiPath, 'utf8'))
  : { openapi: '3.0.3', info: { title: 'PC Parts Store API', version: '1.0.0' }, paths: {} };

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/coupons', couponRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/builds', buildRoutes);
app.use('/api/v1/compatibility', compatibilityRoutes);
app.use('/api/v1/advisor', advisorRoutes);
app.use('/api/v1/payments', webhookRoutes);

app.use((req, res) => res.status(404).json({ message: 'Route not found', path: req.originalUrl }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.status) return res.status(error.status).json({ message: error.message, details: error.details });
  return res.status(500).json({ message: 'Internal server error' });
});
