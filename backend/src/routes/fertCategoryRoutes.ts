import { Router } from 'express';
import {
  getAllFertCategories,
  getFertCategoryById,
  createFertCategory,
  updateFertCategory,
  deleteFertCategory
} from '../controllers/fertCategoryController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', getAllFertCategories);
router.get('/:id', getFertCategoryById);
router.post('/', auth, requireRole(['ADMIN']), createFertCategory);
router.put('/:id', auth, requireRole(['ADMIN']), updateFertCategory);
router.delete('/:id', auth, requireRole(['ADMIN']), deleteFertCategory);

export default router;
