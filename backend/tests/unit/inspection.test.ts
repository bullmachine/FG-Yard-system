import test from 'node:test';
import assert from 'node:assert/strict';
import { trxInspection } from '../../src/services/syncService';
import type { ProductionOrderTrx } from '../../src/services/productionApiService';

const trx = (inspections: unknown): ProductionOrderTrx => ({
  operation_seq_no: '130', start_dt_time: '', end_dt_time: '', work_center_cd: 'STAGE-13',
  operation_completed_qty: '1.00', end_state_cd: 'INSPECTION-COMPLETED',
  production_order_inspections: inspections
});
const insp = (at: string, action: string) => ({ operation_seq_no: '130', item_serial_no: 'X', inspection_dt_time: at, inspection_action_cd: action });

test('inspection status: none, accepted, open rework, rework then accepted', () => {
  assert.deepEqual(trxInspection(trx([])), { inspectionStatus: null, inspectedAt: null });

  let r = trxInspection(trx({ production_order_inspection: insp('2026-11-05 21:53:00', 'ACCEPTED') }));
  assert.equal(r.inspectionStatus, 'ACCEPTED');
  assert.ok(r.inspectedAt);

  r = trxInspection(trx({ production_order_inspection: insp('2026-11-06 11:13:00', 'RE-WORK') }));
  assert.equal(r.inspectionStatus, 'RE-WORK');

  // Plant order is not trusted: sorted by time, the latest wins.
  r = trxInspection(trx({ production_order_inspection: [insp('2026-11-15 14:04:00', 'ACCEPTED'), insp('2026-11-06 11:13:00', 'RE-WORK')] }));
  assert.equal(r.inspectionStatus, 'REWORK-ACCEPTED');
  assert.equal(r.inspectedAt?.getDate(), 15);
});
