import { Router } from 'express';
import { z } from 'zod';
import { resolveBuildComponents, checkCompatibility } from '../services/compatibility.service.js';

export const compatibilityRoutes = Router();

compatibilityRoutes.post('/check', async (req, res, next) => {
  try {
    const components = z.record(z.string()).parse(req.body.components || {});
    const products = await resolveBuildComponents(components);
    res.json({ components: products, ...checkCompatibility(products) });
  } catch (error) {
    next(error);
  }
});
