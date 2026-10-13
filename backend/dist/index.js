"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const yardRoutes_1 = __importDefault(require("./routes/yardRoutes"));
const machineRoutes_1 = __importDefault(require("./routes/machineRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const assemblyRoutes_1 = __importDefault(require("./routes/assemblyRoutes"));
const fertCategoryRoutes_1 = __importDefault(require("./routes/fertCategoryRoutes"));
const vehicleModelMasterRoutes_1 = __importDefault(require("./routes/vehicleModelMasterRoutes"));
const materialMasterRoutes_1 = __importDefault(require("./routes/materialMasterRoutes"));
const driverRoutes_1 = __importDefault(require("./routes/driverRoutes"));
const gateRoutes_1 = __importDefault(require("./routes/gateRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const settingsRoutes_1 = __importDefault(require("./routes/settingsRoutes"));
const securityRoutes_1 = __importDefault(require("./routes/securityRoutes"));
const movementRoutes_1 = __importDefault(require("./routes/movementRoutes"));
const exitRequestRoutes_1 = __importDefault(require("./routes/exitRequestRoutes"));
const scheduler_1 = require("./services/scheduler");
const realtime_1 = require("./services/realtime");
const notificationService_1 = require("./services/notificationService");
const settingsService_1 = require("./services/settingsService");
const upload_1 = require("./lib/upload");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
(0, upload_1.ensureUploadDirs)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Uploaded driver photos are served straight from disk. Mounted before the API routes
// with no index listing, and covered by the cors() above, so an <img> tag on the
// frontend can fetch them without extra headers.
app.use('/uploads', express_1.default.static(upload_1.UPLOADS_ROOT, { dotfiles: 'deny', index: false }));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Yard Management System API is running' });
});
app.use('/api/auth', authRoutes_1.default);
app.use('/api/yards', yardRoutes_1.default);
app.use('/api/machines', machineRoutes_1.default);
app.use('/api/assembly', assemblyRoutes_1.default);
app.use('/api/fert-categories', fertCategoryRoutes_1.default);
app.use('/api/vehicle-model-masters', vehicleModelMasterRoutes_1.default);
app.use('/api/material-masters', materialMasterRoutes_1.default);
app.use('/api/drivers', driverRoutes_1.default);
app.use('/api/gate', gateRoutes_1.default);
app.use('/api/users', userRoutes_1.default);
app.use('/api/notifications', notificationRoutes_1.default);
app.use('/api/settings', settingsRoutes_1.default);
app.use('/api/security', securityRoutes_1.default);
app.use('/api/movements', movementRoutes_1.default);
app.use('/api/exit-requests', exitRequestRoutes_1.default);
// Multer raises its own errors (oversized file, unexpected end of stream) which would
// otherwise reach Express' default HTML handler. Turn them into the same JSON shape
// the rest of the API returns. Declared after the routes so it only sees their errors.
app.use((err, _req, res, next) => {
    if (!err)
        return next();
    const code = err.code;
    if (code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Photo must be 1 MB or smaller' });
    }
    if (code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field. Send the photo as "photo".' });
    }
    console.error('Request error:', err);
    return res.status(500).json({ error: 'Request failed' });
});
// Settings must be loaded before the scheduler starts so the first cron registration
// uses the stored values rather than the bootstrap defaults.
(0, settingsService_1.init)()
    .then(() => (0, scheduler_1.startScheduler)())
    .catch((error) => {
    console.error('Failed to initialise settings or scheduler:', error);
});
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
(0, realtime_1.attachRealtime)(server);
console.log('Realtime WebSocket listening on /ws');
(0, notificationService_1.pruneReadNotifications)()
    .then((removed) => {
    if (removed > 0)
        console.log(`Pruned ${removed} read notification(s) older than 30 days`);
})
    .catch((error) => console.error('Failed to prune notifications:', error));
