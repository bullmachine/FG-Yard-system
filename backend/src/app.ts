import express from 'express';
import cors from 'cors';
import yardRoutes from './routes/yardRoutes';
import machineRoutes from './routes/machineRoutes';
import authRoutes from './routes/authRoutes';
import assemblyRoutes from './routes/assemblyRoutes';
import fertCategoryRoutes from './routes/fertCategoryRoutes';
import vehicleModelMasterRoutes from './routes/vehicleModelMasterRoutes';
import materialMasterRoutes from './routes/materialMasterRoutes';
import driverRoutes from './routes/driverRoutes';
import gateRoutes from './routes/gateRoutes';
import userRoutes from './routes/userRoutes';
import notificationRoutes from './routes/notificationRoutes';
import settingsRoutes from './routes/settingsRoutes';
import securityRoutes from './routes/securityRoutes';
import movementRoutes from './routes/movementRoutes';
import exitRequestRoutes from './routes/exitRequestRoutes';
import dashboardV2Routes from './routes/dashboardV2Routes';
import dashboardRoutes from './routes/dashboardRoutes';
import yardStockRoutes from './routes/yardStockRoutes';
import dispatchPlanRoutes from './routes/dispatchPlanRoutes';
import integrationRoutes from './routes/integrationRoutes';
import roleAccessRoutes from './routes/roleAccessRoutes';
import feedbackRoutes from './routes/feedbackRoutes';
import loginHistoryRoutes from './routes/loginHistoryRoutes';
import backupRoutes from './routes/backupRoutes';
import { UPLOADS_ROOT, ensureUploadDirs } from './lib/upload';

/** The Express app with every route. index.ts starts it; the API tests use it directly. */
const app = express();

ensureUploadDirs();

// IIS on this server proxies the site to this API. Trust X-Forwarded-For only from the
// local machine, so req.ip is the user's address behind IIS and cannot be faked from outside.
app.set('trust proxy', 'loopback');
app.use(cors());
app.use(express.json());
// Uploaded driver photos are served straight from disk. Mounted before the API routes
// with no index listing, and covered by the cors() above, so an <img> tag on the
// frontend can fetch them without extra headers.
app.use('/uploads', express.static(UPLOADS_ROOT, { dotfiles: 'deny', index: false }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'FG Yard API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/yards', yardRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/assembly', assemblyRoutes);
app.use('/api/fert-categories', fertCategoryRoutes);
app.use('/api/vehicle-model-masters', vehicleModelMasterRoutes);
app.use('/api/material-masters', materialMasterRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/gate', gateRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/movements', movementRoutes);
app.use('/api/exit-requests', exitRequestRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/dashboard-v2', dashboardV2Routes);
app.use('/api/yard-stock', yardStockRoutes);
app.use('/api/dispatch-plans', dispatchPlanRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/role-access', roleAccessRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/login-history', loginHistoryRoutes);
app.use('/api/backups', backupRoutes);

// Multer raises its own errors (oversized file, unexpected end of stream) which would
// otherwise reach Express' default HTML handler. Turn them into the same JSON shape
// the rest of the API returns. Declared after the routes so it only sees their errors.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  const code = (err as { code?: unknown }).code;
  if (code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The file is too large (photo 1 MB, screenshot 2 MB at most)' });
  }
  if (code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.' });
  }
  console.error('Request error:', err);
  return res.status(500).json({ error: 'Request failed' });
});

export default app;
