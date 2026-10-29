// API tests against a real MySQL test database: the yard flow end to end and the
// access rules around it. Run with `npm run test:api` (needs TEST_DATABASE_URL).
import './env';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { Server } from 'http';
import app from '../../src/app';
import prisma from '../../src/lib/prisma';
import { generateToken } from '../../src/lib/auth';
import { hashCode } from '../../src/services/passwordResetService';
import jwt from 'jsonwebtoken';

let server: Server;
let base = '';
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tok[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const machine = (id: string) => prisma.machine.findUniqueOrThrow({ where: { id } });

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const roles = {
    admin: 'ADMIN', secA: 'SECURITY', secB: 'SECURITY', ym: 'YARD_MANAGER',
    pdi: 'PDI', mg: 'MAIN_GATE', viewer: 'VIEW_ONLY', op: 'OPERATOR'
  } as const;
  for (const [key, role] of Object.entries(roles)) {
    const u = await prisma.user.create({ data: { email: `${key}@test.local`, password: 'not-used', name: `Test ${key}`, role } });
    ids[key] = u.id;
    tok[key] = generateToken(u.id, role);
  }
  ids.driver = (await prisma.driver.create({ data: { name: 'Test Driver', employeeCode: 'EMP-T1' } })).id;
  const base18 = { model: 'TEST', modelType: 'MT-A', productionDate: new Date(2026, 8, 1), assemblyStage: 18 };
  ids.m1 = (await prisma.machine.create({ data: { ...base18, serialNumber: 'SN-T1', barcode: 'BC-1' } })).id;
  ids.m2 = (await prisma.machine.create({ data: { ...base18, serialNumber: 'SN-T2', barcode: 'BC-2' } })).id;
  ids.m3 = (await prisma.machine.create({ data: { ...base18, serialNumber: 'SN-T3', barcode: null, assemblyStage: 10 } })).id;
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test('access: no token is 401, the wrong role is 403', async () => {
  assert.equal((await call(null, 'GET', '/api/dispatch-plans')).status, 401);
  assert.equal((await call('viewer', 'POST', '/api/yards', { name: 'X', rows: 1, cols: 1 })).status, 403);
  assert.equal((await call('viewer', 'POST', '/api/dispatch-plans', { lines: [{ modelType: 'MT-A', qty: 1 }] })).status, 403);
  assert.equal((await call('viewer', 'GET', '/api/backups')).status, 403);
  assert.equal((await call('ym', 'GET', '/api/role-access')).status, 403, 'Role Access is Admin-only');
});

test('yard: the yard manager creates a yard with its slots', async () => {
  const r = await call('ym', 'POST', '/api/yards', { name: 'Test Yard', rows: 2, cols: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.yard = r.data.id;
  assert.equal(await prisma.slot.count({ where: { yardId: ids.yard } }), 6);
});

test('gate in: refuses an unknown badge and a machine not ready, admits a ready one', async () => {
  let r = await call('secA', 'POST', '/api/gate/authenticate', { driverBarcode: 'NOPE', barcode: 'BC-1', direction: 'IN' });
  assert.equal(r.data.result, 'REJECTED');
  assert.match(r.data.reason, /Unknown driver/);

  r = await call('secA', 'POST', '/api/gate/authenticate', { driverBarcode: 'EMP-T1', machineId: ids.m3, direction: 'IN' });
  assert.equal(r.data.result, 'REJECTED');
  assert.match(r.data.reason, /not ready/);

  r = await call('secA', 'POST', '/api/gate/authenticate', { driverBarcode: 'emp-t1', barcode: 'BC-1', direction: 'IN' });
  assert.equal(r.data.result, 'AUTHORIZED', JSON.stringify(r.data));
  const m = await machine(ids.m1);
  assert.equal(m.parkStatus, 'IN_TRANSIT');
  assert.ok(m.plannedSlotId, 'a slot is reserved at the gate');
  assert.equal(m.driverId, ids.driver);

  r = await call('secA', 'POST', '/api/gate/authenticate', { driverBarcode: 'EMP-T1', barcode: 'BC-1', direction: 'OUT' });
  assert.equal(r.data.result, 'REJECTED', 'not released for exit');
});

test('parking: security confirms for the driver, the same person cannot approve it', async () => {
  let r = await call('secA', 'POST', `/api/machines/${ids.m1}/parked`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await machine(ids.m1)).parkStatus, 'PARKED_PENDING');

  r = await call('secA', 'POST', `/api/machines/${ids.m1}/verify-parking`, { status: 'APPROVED' });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /two-person/);

  r = await call('ym', 'POST', `/api/machines/${ids.m1}/verify-parking`, { status: 'APPROVED' });
  assert.equal(r.status, 403, 'only Security verifies by default');

  r = await call('secB', 'POST', `/api/machines/${ids.m1}/verify-parking`, { status: 'APPROVED' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await machine(ids.m1)).parkStatus, 'PARKED_VERIFIED');
});

test('dispatch: plan takes free stock only, gate out needs no exit request', async () => {
  let r = await call('ym', 'POST', '/api/dispatch-plans', { lines: [{ modelType: 'MT-A', qty: 2 }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Not enough free stock/);

  r = await call('ym', 'POST', '/api/dispatch-plans', { lines: [{ modelType: 'MT-A', qty: 1 }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const item = await prisma.dispatchItem.findFirstOrThrow({ where: { machineId: ids.m1 } });
  ids.item = item.id;
  assert.equal(item.status, 'PLANNED');

  r = await call('secA', 'POST', '/api/gate/authenticate', { driverBarcode: 'EMP-T1', barcode: 'BC-1', direction: 'OUT' });
  assert.equal(r.data.result, 'AUTHORIZED', JSON.stringify(r.data));
  assert.equal((await machine(ids.m1)).parkStatus, 'EXITED');
  assert.equal((await prisma.dispatchItem.findUniqueOrThrow({ where: { id: ids.item } })).status, 'OUT_OF_YARD');
});

test('PDI: main gate-out only after PDI pass; hold needs a remark', async () => {
  const pdi = (who: string, body: unknown) => call(who, 'POST', `/api/dispatch-plans/items/${ids.item}/pdi`, body);
  const gate = (who: string) => call(who, 'POST', `/api/dispatch-plans/items/${ids.item}/main-gate-out`, {});

  let r = await gate('mg');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /PDI has not passed/);

  assert.equal((await pdi('viewer', { result: 'PASS' })).status, 403);
  assert.equal((await pdi('pdi', { result: 'HOLD' })).status, 400, 'hold without a remark');
  assert.equal((await pdi('pdi', { result: 'HOLD', remark: 'Scratch on boom' })).status, 200);

  r = await gate('mg');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /on hold/);

  assert.equal((await pdi('pdi', { result: 'PASS' })).status, 200);
  assert.equal((await gate('pdi')).status, 403, 'PDI cannot mark main gate-out');
  r = await gate('mg');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await prisma.dispatchItem.findUniqueOrThrow({ where: { id: ids.item } })).status, 'MAIN_GATE_OUT');
});

test('bulk stock load: off by default, checks every row, places only good rows', async () => {
  const rows = [
    { serial: 'SN-T2', yard: 'test yard', slot: 'B3', inwardDate: '15-08-2026' },
    { serial: 'SN-T3', yard: 'Test Yard', slot: 'B2' },
    { serial: 'SN-NONE', yard: 'Test Yard', slot: 'B1' },
    { serial: 'BC-2', yard: 'Test Yard', slot: 'A1' },
    { serial: 'SN-T1', yard: 'Test Yard', slot: 'Z9' }
  ];
  let r = await call('ym', 'POST', '/api/machines/bulk-allocate', { rows });
  assert.equal(r.status, 403, 'initial stock load is off');

  assert.equal((await call('admin', 'PUT', '/api/settings', { initialStockLoad: true })).status, 200);
  assert.equal((await call('op', 'POST', '/api/machines/bulk-allocate', { rows })).status, 403, 'operator has no machines.allocate');

  r = await call('ym', 'POST', '/api/machines/bulk-allocate', { rows });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const res = r.data.results;
  assert.equal(r.data.ok, 1);
  assert.equal(res[0].ok, true);
  assert.match(res[1].error, /Stage 18/);
  assert.match(res[2].error, /not found/);
  assert.match(res[3].error, /Same machine/, 'barcode of the same machine is a duplicate');
  assert.match(res[4].error, /has left the yard|does not exist/i);
  assert.equal((await machine(ids.m2)).currentSlotId, null, 'the check alone places nothing');

  r = await call('ym', 'POST', '/api/machines/bulk-allocate', { rows, commit: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.placed, 1);
  const m2 = await prisma.machine.findUniqueOrThrow({ where: { id: ids.m2 }, include: { currentSlot: true } });
  assert.equal(m2.parkStatus, 'PARKED_PENDING');
  assert.deepEqual([m2.currentSlot?.row, m2.currentSlot?.col], [2, 3]);
  assert.equal(m2.yardInwardAt?.getDate(), 15);
  assert.equal(m2.currentSlot?.status, 'OCCUPIED');

  r = await call('ym', 'POST', '/api/machines/bulk-allocate', { rows: [rows[0]], commit: true });
  assert.equal(r.data.placed, 0, 'a second upload does not place it twice');
  assert.match(r.data.results[0].error, /Already in a slot/);

  await call('admin', 'PUT', '/api/settings', { initialStockLoad: false });
});

test('two-person rule can be switched off in Settings', async () => {
  // m2 was placed by the yard manager; Security did not park it, so B may approve.
  // Switch the rule off and check that the parker could then approve their own.
  const parker = await prisma.movement.findFirstOrThrow({ where: { machineId: ids.m2 }, orderBy: { timestamp: 'desc' } });
  await prisma.movement.update({ where: { id: parker.id }, data: { userId: ids.secA } });
  assert.equal((await call('secA', 'POST', `/api/machines/${ids.m2}/verify-parking`, { status: 'APPROVED' })).status, 403);
  assert.equal((await call('admin', 'PUT', '/api/settings', { parkingTwoPersonRule: false })).status, 200);
  assert.equal((await call('secA', 'POST', `/api/machines/${ids.m2}/verify-parking`, { status: 'APPROVED' })).status, 200);
  await call('admin', 'PUT', '/api/settings', { parkingTwoPersonRule: true });
});

test('feedback: anyone sends, only the sender or an Admin sees it', async () => {
  let r = await call('viewer', 'POST', '/api/feedback', { type: 'ISSUE', message: 'Too short?', page: 'FG Yard' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.id;
  assert.equal((await call('viewer', 'POST', '/api/feedback', { type: 'ISSUE', message: 'hi' })).status, 400);
  assert.equal((await call('viewer', 'GET', '/api/feedback')).status, 403);
  assert.equal((await call('admin', 'GET', '/api/feedback')).data.total, 1);
  assert.equal((await call('secA', 'GET', `/api/feedback/${id}/screenshot`)).status, 404, 'another user');
  assert.equal((await call('viewer', 'GET', `/api/feedback/${id}/screenshot`)).status, 404, 'no screenshot sent');
});

test('create account: off by default, on only when an Admin allows it', async () => {
  assert.equal((await call(null, 'GET', '/api/auth/options')).data.allowRegistration, false);
  const body = { name: 'New Person', email: 'new.person@test.local', password: 'longenough1' };
  let r = await call(null, 'POST', '/api/auth/register', body);
  assert.equal(r.status, 403);
  assert.equal((await call('admin', 'PUT', '/api/settings', { allowRegistration: true })).status, 200);
  assert.equal((await call(null, 'GET', '/api/auth/options')).data.allowRegistration, true);
  r = await call(null, 'POST', '/api/auth/register', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'VIEW_ONLY');
  await call('admin', 'PUT', '/api/settings', { allowRegistration: false });
});

test('forgot password: same answer for any e-mail, code works once, old sign-ins end', async () => {
  // A token from a minute ago, as a user who signed in earlier would hold.
  const oldToken = jwt.sign({ userId: ids.viewer, role: 'VIEW_ONLY', iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET!);
  const me = (t: string) => fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }).then((x) => x.status);
  assert.equal(await me(oldToken), 200);

  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: 'nobody@test.local' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: 'not-an-email' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: 'VIEWER@test.local' })).status, 200);
  const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId: ids.viewer } });
  // No SMTP in the tests, so the Admins are asked to reset it by hand.
  assert.ok(await prisma.notification.findFirst({ where: { userId: ids.admin, type: 'PASSWORD_RESET_REQUEST' } }));

  // The real code went nowhere; put a known one in its place.
  await prisma.passwordReset.update({ where: { id: row.id }, data: { codeHash: hashCode(ids.viewer, '123456') } });
  const reset = (code: string, password = 'brand-new-pass') =>
    call(null, 'POST', '/api/auth/reset-password', { email: 'viewer@test.local', code, password });

  assert.equal((await reset('000000')).status, 400);
  assert.equal((await prisma.passwordReset.findUniqueOrThrow({ where: { id: row.id } })).attempts, 1);
  assert.equal((await reset('123456', 'short')).status, 400);
  assert.equal((await reset('123456')).status, 200);
  assert.equal((await reset('123456')).status, 400, 'a code works once');

  assert.equal(await me(oldToken), 401, 'old sign-in ends after the reset');
  const login = await call(null, 'POST', '/api/auth/login', { email: 'viewer@test.local', password: 'brand-new-pass' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

test('dashboard: 7-day trend, activity and open plans', async () => {
  const r = await call('ym', 'GET', '/api/dashboard');
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.trend.length, 7);
  const sum = (k: string) => r.data.trend.reduce((n: number, d: Record<string, number>) => n + d[k], 0);
  assert.equal(sum('gateIn'), 1);
  assert.equal(sum('gateOut'), 1);
  assert.equal(sum('mainGateOut'), 1);
  const kinds = r.data.activity.map((a: { kind: string }) => a.kind);
  // One PDI row per machine: a hold later passed shows as passed.
  for (const k of ['GATE_IN', 'GATE_OUT', 'VERIFIED', 'PDI_PASS', 'MAIN_GATE_OUT']) assert.ok(kinds.includes(k), k);
  assert.equal(r.data.dispatch.openPlans.count, 0, 'the only plan is complete');
  assert.ok(Array.isArray(r.data.dispatch.pdiHold.items));
});
