import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getSettings } from '../services/settingsService';
import { apiMainGateOut, apiPendingMainGate } from '../controllers/dispatchPlanController';

const router = Router();

/**
 * Software-to-software calls from the main gate system. They carry the key from
 * Settings in the x-api-key header instead of a user login. No key configured means
 * the API is switched off.
 */
async function requireMainGateKey(req: Request, res: Response, next: NextFunction) {
  const { mainGateApiKey } = await getSettings();
  if (!mainGateApiKey) return res.status(503).json({ ok: false, error: 'Main gate API is not enabled' });

  const sent = Buffer.from(String(req.headers['x-api-key'] ?? ''));
  const expected = Buffer.from(mainGateApiKey);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }
  next();
}

router.get('/main-gate/pending', requireMainGateKey, apiPendingMainGate);
router.post('/main-gate/out', requireMainGateKey, apiMainGateOut);

export default router;
