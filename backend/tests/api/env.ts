// Imported first by every API test: point Prisma at the test database before
// anything creates a client. Refuses any database whose name does not end in _test,
// so the tests can never touch the live data.
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL (a separate MySQL database ending in _test) to run the API tests');
const db = new URL(url).pathname.replace(/^\//, '');
if (!/_test$/.test(db)) throw new Error(`TEST_DATABASE_URL must point to a database ending in _test, not "${db}"`);

process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'api-test-secret';
