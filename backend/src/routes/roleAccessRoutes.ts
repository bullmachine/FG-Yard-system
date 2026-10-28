import { Router, Request, Response } from 'express';
import { auth, requireRole } from '../middleware/auth';
import { getMatrix, permissionsFor, resetToDefaults, saveChanges, AccessChange } from '../services/roleAccessService';

const router = Router();

function userOf(req: Request) {
  return (req as Request & { user?: { id: string; role: string } }).user;
}

// The signed-in user's own permissions, so the screens show only what they may use.
router.get('/me', auth, async (req: Request, res: Response) => {
  try {
    const user = userOf(req);
    res.json({ role: user?.role, permissions: await permissionsFor(user?.role) });
  } catch (error) {
    console.error('role access me error:', error);
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

// The matrix itself is Admin-only, both to read and to change.
router.get('/', auth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    res.json(await getMatrix());
  } catch (error) {
    console.error('role access matrix error:', error);
    res.status(500).json({ error: 'Failed to load role access' });
  }
});

/** Body: { changes: [{ role, permission, allowed }] } */
router.put('/', auth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  const changes = Array.isArray(req.body?.changes) ? (req.body.changes as AccessChange[]) : null;
  if (!changes) return res.status(400).json({ error: 'Send the changes to save' });
  try {
    const changed = await saveChanges(changes, userOf(req)!.id);
    res.json({ changed, matrix: await getMatrix() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save role access';
    res.status(400).json({ error: message });
  }
});

router.post('/reset', auth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const changed = await resetToDefaults(userOf(req)!.id);
    res.json({ changed, matrix: await getMatrix() });
  } catch (error) {
    console.error('role access reset error:', error);
    res.status(500).json({ error: 'Failed to reset role access' });
  }
});

export default router;
