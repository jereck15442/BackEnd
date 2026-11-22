import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { Product } from '../models/Product.js';
import { checkCompatibility } from '../services/compatibility.service.js';

export const advisorRoutes = Router();

const aiLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
advisorRoutes.use(requireAuth, loadUser, aiLimit);

advisorRoutes.post('/recommend', async (req, res) => {
  try {
    const body = z.object({
      budget: z.number().positive().max(10_000_000),
      usage: z.string().trim().min(1).max(200)
    }).parse(req.body);

    const candidates = await Product.find({
      active: true,
      stock: { $gt: 0 },
      price: { $lte: body.budget }
    }).sort({ price: 1 }).limit(100);

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ message: 'AI advisor is temporarily unavailable. Please use the product catalog or custom PC builder.' });
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `Recommend one compatible PC build for PHP ${body.budget} for ${body.usage}.
Return only JSON with: {"components":{"CPU":"product id",...},"explanation":"text"}.
Use only these candidate products: ${JSON.stringify(candidates.map((p) => ({
      id: p._id, name: p.name, category: p.category, price: p.price, stock: p.stock, specifications: p.specifications
    })))}`
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      contents: prompt
    });
    const raw = result.text || '';
    const jsonText = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonText);
    const candidateIds = new Set(candidates.map((p) => p._id.toString()));
    for (const id of Object.values(parsed.components || {})) {
      if (!candidateIds.has(String(id))) throw new Error('AI returned a product outside the database candidates');
    }

    const selected = {};
    for (const [category, id] of Object.entries(parsed.components || {})) {
      const product = candidates.find((p) => p._id.toString() === String(id));
      if (product) selected[category] = product;
    }
    const estimatedPrice = Object.values(selected).reduce((sum, p) => sum + p.price, 0);
    res.json({
      components: selected,
      estimatedPrice,
      compatibility: checkCompatibility(selected),
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : 'AI recommendation'
    });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(422).json({ message: 'Validation error', details: error.errors });
    res.status(503).json({ message: 'AI advisor is temporarily unavailable. Please use the product catalog or custom PC builder.' });
  }
});
