import dotenv from 'dotenv';

// Load backend/.env before anything reads process.env.
dotenv.config();

import app from './app';
import { startScheduler } from './services/scheduler';
import { attachRealtime } from './services/realtime';
import { pruneReadNotifications } from './services/notificationService';
import { init as initSettings } from './services/settingsService';

const PORT = process.env.PORT || 5000;

// Settings must be loaded before the scheduler starts so the first cron registration
// uses the stored values rather than the bootstrap defaults.
initSettings()
  .then(() => startScheduler())
  .catch((error) => {
    console.error('Failed to initialise settings or scheduler:', error);
  });

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

attachRealtime(server);
console.log('Realtime WebSocket listening on /ws');

pruneReadNotifications()
  .then((removed) => {
    if (removed > 0) console.log(`Pruned ${removed} read notification(s) older than 30 days`);
  })
  .catch((error) => console.error('Failed to prune notifications:', error));
