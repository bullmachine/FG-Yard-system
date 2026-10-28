import { Router } from 'express';
import {
  getAllFertCategories,
  getFertCategoryById,
  createFertCategory,
  updateFertCategory,
  deleteFertCategory
} from '../controllers/fertCategoryController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

router.get('/', getAllFertCategories);
router.get('/:id', getFertCategoryById);
router.post('/', auth, requirePermission('fert.manage'), createFertCategory);
router.put('/:id', auth, requirePermission('fert.manage'), updateFertCategory);
router.delete('/:id', auth, requirePermission('fert.manage'), deleteFertCategory);

export default router;
