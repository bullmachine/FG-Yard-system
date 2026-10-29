// Recreate the test database schema from prisma/schema.prisma before the API tests.
// Only ever runs against a database whose name ends in _test.
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('Set TEST_DATABASE_URL (e.g. mysql://root@localhost:3306/yard_management_test) in backend/.env');
  process.exit(1);
}
const db = new URL(url).pathname.replace(/^\//, '');
if (!/_test$/.test(db)) {
  console.error(`TEST_DATABASE_URL must point to a database ending in _test, not "${db}"`);
  process.exit(1);
}

execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', {
  cwd: path.resolve(__dirname, '../..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url }
});
