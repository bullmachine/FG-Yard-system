// Unit tests: pure rules, no database. Run with `npm test`.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, EDITABLE_ROLES, isLocked, requirePermission } from '../../src/services/roleAccessService';
import { blocksOwnApproval } from '../../src/services/parkingRules';
import { parseSlotLabel, parseInwardDate, findDuplicates } from '../../src/services/stockLoadService';
import { parseDatabaseUrl, backupFileName, filesToDelete } from '../../src/services/backupService';

test('role access: every permission key is unique and defaults use real roles', () => {
  const keys = PERMISSIONS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const p of PERMISSIONS) {
    for (const r of p.defaults) assert.ok(EDITABLE_ROLES.includes(r), `${p.key}: ${r}`);
  }
});

test('role access: a driver can never get staff permissions', () => {
  assert.equal(isLocked('DRIVER', 'page.gate'), true);
  assert.equal(isLocked('DRIVER', 'security.verify'), true);
  assert.equal(isLocked('DRIVER', 'page.parked'), false);
  assert.equal(isLocked('SECURITY', 'page.gate'), false);
  for (const p of PERMISSIONS) {
    if (p.defaults.includes('DRIVER')) assert.equal(isLocked('DRIVER', p.key), false, p.key);
  }
});

test('role access: key defaults stay as agreed', () => {
  const def = (k: string) => PERMISSIONS.find((p) => p.key === k)!.defaults;
  assert.deepEqual(def('security.verify'), ['SECURITY']);
  assert.ok(def('page.gate').includes('SECURITY'));
  assert.ok(def('parked.confirmOthers').includes('SECURITY'));
  assert.deepEqual(def('pdi.check').sort(), ['PDI', 'YARD_MANAGER']);
  assert.deepEqual(def('pdi.mainGate').sort(), ['MAIN_GATE', 'YARD_MANAGER']);
  assert.deepEqual(def('machines.allocate'), ['YARD_MANAGER']);
  assert.deepEqual(def('yards.delete'), []);
  assert.deepEqual(def('machines.delete'), []);
});

test('role access: a route guard with a misspelt key fails at start-up', () => {
  assert.throws(() => requirePermission('page.gaet'), /Unknown permission/);
  assert.doesNotThrow(() => requirePermission('page.gate', 'gate.logs'));
});

test('two-person rule: the parker cannot approve, anyone can reject', () => {
  assert.equal(blocksOwnApproval(true, 'u1', 'u1', 'APPROVED'), true);
  assert.equal(blocksOwnApproval(true, 'u1', 'u1', 'REJECTED'), false);
  assert.equal(blocksOwnApproval(true, 'u1', 'u2', 'APPROVED'), false);
  assert.equal(blocksOwnApproval(false, 'u1', 'u1', 'APPROVED'), false);
  assert.equal(blocksOwnApproval(true, null, 'u1', 'APPROVED'), false);
});

test('stock load: slot labels', () => {
  assert.deepEqual(parseSlotLabel('B7'), { row: 2, col: 7 });
  assert.deepEqual(parseSlotLabel(' a12 '), { row: 1, col: 12 });
  assert.deepEqual(parseSlotLabel('C-3'), { row: 3, col: 3 });
  assert.deepEqual(parseSlotLabel('2-7'), { row: 2, col: 7 });
  assert.equal(parseSlotLabel('7B'), null);
  assert.equal(parseSlotLabel(''), null);
});

test('stock load: inward dates', () => {
  const today = new Date(2026, 9, 29);
  assert.equal(parseInwardDate('', today), null);
  assert.deepEqual(parseInwardDate('2026-08-15', today), new Date(2026, 7, 15));
  assert.deepEqual(parseInwardDate('15-08-2026', today), new Date(2026, 7, 15));
  assert.deepEqual(parseInwardDate('15/08/2026', today), new Date(2026, 7, 15));
  assert.equal(parseInwardDate('31-02-2026', today), undefined);
  assert.equal(parseInwardDate('2026-12-01', today), undefined, 'future date');
  assert.equal(parseInwardDate('08/15/2026', today), undefined, 'US order');
});

test('stock load: duplicates in one file', () => {
  const dup = findDuplicates([
    { serial: 'SN1', yard: 'Y1', slot: 'A1' },
    { serial: 'sn1', yard: 'Y1', slot: 'A2' },
    { serial: 'SN3', yard: 'y1', slot: 'a1' },
    { serial: 'SN4', yard: 'Y2', slot: 'A1' }
  ]);
  assert.equal(dup.get(1), 'Same machine as line 2');
  assert.equal(dup.get(2), 'Same slot as line 2');
  assert.equal(dup.has(0), false);
  assert.equal(dup.has(3), false);
});

test('backup: database URL parts', () => {
  assert.deepEqual(parseDatabaseUrl('mysql://root:p%40ss@localhost:3307/yard_management?connection_limit=5'), {
    host: 'localhost', port: '3307', user: 'root', password: 'p@ss', database: 'yard_management'
  });
  assert.equal(parseDatabaseUrl('mysql://root@127.0.0.1/db').port, '3306');
  assert.throws(() => parseDatabaseUrl(undefined), /not set/);
  assert.throws(() => parseDatabaseUrl('postgres://a@b/c'), /mysql/);
});

test('backup: file name and retention', () => {
  assert.equal(backupFileName(new Date(2026, 9, 29, 1, 5)), 'fg-yard_2026-10-29_0105.sql.gz');
  const now = new Date(2026, 9, 29);
  const day = (n: number) => new Date(now.getTime() - n * 86400000);
  const files = [0, 1, 2, 15, 20, 30].map((n) => ({ name: `f${n}`, size: 1, modifiedAt: day(n) }));
  assert.deepEqual(filesToDelete(files, now, 14).map((f) => f.name).sort(), ['f15', 'f20', 'f30']);
  // The newest three are kept even when all are old (e.g. the server was off for weeks).
  const old = [40, 41, 42, 43].map((n) => ({ name: `o${n}`, size: 1, modifiedAt: day(n) }));
  assert.deepEqual(filesToDelete(old, now, 14).map((f) => f.name), ['o43']);
});

test('password reset: codes and old sign-ins', async () => {
  const { newCode, hashCode } = await import('../../src/services/passwordResetService');
  const { issuedBeforePasswordChange } = await import('../../src/middleware/auth');
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/);
  assert.equal(hashCode('u1', '123456'), hashCode('u1', '123456'));
  assert.notEqual(hashCode('u1', '123456'), hashCode('u2', '123456'));
  const changed = new Date(2026, 9, 29, 10, 0, 0);
  const sec = (d: Date, plus: number) => Math.floor(d.getTime() / 1000) + plus;
  assert.equal(issuedBeforePasswordChange(sec(changed, -60), changed), true);
  assert.equal(issuedBeforePasswordChange(sec(changed, 5), changed), false);
  assert.equal(issuedBeforePasswordChange(sec(changed, -60), null), false);
});

test('dashboard: India dates for the 7-day trend', async () => {
  const { istDay, emptyTrend } = await import('../../src/controllers/dashboardController');
  // 20:00 UTC is already the next day in India.
  assert.equal(istDay(new Date(Date.UTC(2026, 9, 28, 20, 0))), '2026-10-29');
  assert.equal(istDay(new Date(Date.UTC(2026, 9, 28, 18, 0))), '2026-10-28');
  const days = emptyTrend(new Date(Date.UTC(2026, 9, 28, 18, 30)));
  assert.deepEqual(days.map((d) => d.day), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
});

test('assembly: a stage is done only when the plant reports INSPECTION-COMPLETED', async () => {
  const { isTrxCompleted, getHighestCompletedStage } = await import('../../src/services/productionApiService');
  const op = (seq: string, state?: string, qty = '1.00', end = '2026-10-30 10:00:00') => ({
    operation_seq_no: seq, start_dt_time: '2026-10-30 09:00:00', end_dt_time: end,
    work_center_cd: `STAGE-${Number(seq) / 10}`, operation_completed_qty: qty,
    ...(state === undefined ? {} : { end_state_cd: state })
  });
  assert.equal(isTrxCompleted(op('180', 'INSPECTION-COMPLETED')), true);
  assert.equal(isTrxCompleted(op('180', 'IN-INSPECTION')), false, 'qty 1.00 but still in inspection');
  assert.equal(isTrxCompleted(op('10', 'RUN')), false);
  assert.equal(isTrxCompleted(op('180', 'INSPECTION-COMPLETED', '1.00', '')), false, 'no end time');
  // Older responses without end_state_cd keep the quantity rule.
  assert.equal(isTrxCompleted(op('180')), true);
  assert.equal(isTrxCompleted(op('180', undefined, '0.00')), false);
  assert.equal(getHighestCompletedStage([op('170', 'INSPECTION-COMPLETED'), op('180', 'IN-INSPECTION')]), 17);
  assert.equal(getHighestCompletedStage([op('170', 'IN-INSPECTION'), op('180', 'INSPECTION-COMPLETED')]), 18);
});
