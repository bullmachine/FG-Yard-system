import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  getHighestCompletedStage,
  extractModelFromDescription,
  getFertCategory,
  getOrderTrxs,
  toNullableString,
  ProductionOrder
} from '../src/services/productionApiService';

const prisma = new PrismaClient();

const DAYS = 10;

/**
 * A plant order with every text field already coerced to `string | null`.
 *
 * The plant sends single-value fields as a bare string or as a one-element array, and
 * an absent value as an empty array. Prisma rejects an array outright, which is what
 * produced "Argument `barcode`: Invalid value provided. Expected String or Null" during
 * the daily sync. Normalising once up front means every map key and every Prisma write
 * below works with a plain string.
 */
type NormalizedOrder = Omit<
  ProductionOrder,
  'order_no' | 'item_serial_no' | 'item_cd' | 'item_dsc' | 'plan_operation_group_cd' | 'barcode_val' | 'production_order_id'
> & {
  order_no: string | null;
  item_serial_no: string | null;
  item_cd: string | null;
  item_dsc: string | null;
  plan_operation_group_cd: string | null;
  barcode_val: string | null;
  production_order_id: string | null;
};

function normalizeOrder(order: ProductionOrder): NormalizedOrder {
  return {
    ...order,
    order_no: toNullableString(order.order_no),
    item_serial_no: toNullableString(order.item_serial_no),
    item_cd: toNullableString(order.item_cd),
    item_dsc: toNullableString(order.item_dsc),
    plan_operation_group_cd: toNullableString(order.plan_operation_group_cd),
    barcode_val: toNullableString(order.barcode_val),
    production_order_id: toNullableString(order.production_order_id)
  };
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(toDateString(d));
  }
  return dates;
}

async function fetchOrdersForDate(date: string): Promise<ProductionOrder[]> {
  const base = process.env.PRODUCTION_API_URL || 'http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST';
  const url = `${base}?hsMode=GET-PRODUCTION-ORDER-TRX&hxTrxDt=${date}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }
  const data = await response.json();
  if (Array.isArray(data)) {
    return data as ProductionOrder[];
  }
  if (data && typeof data === 'object' && data.status === 'ERROR') {
    console.log(`No data for ${date}: ${data.message}`);
    return [];
  }
  throw new Error('Invalid API response: expected array or {status,message} envelope');
}

function groupKey(order: NormalizedOrder): string {
  return getFertCategory(order.group_dsc) ?? '';
}

function startDateTime(order: NormalizedOrder): string | null {
  return getOrderTrxs(order)[0]?.start_dt_time ?? null;
}

interface OrderAgg {
  order: NormalizedOrder;
  groups: Map<string, number>;
  dates: Set<string>;
}

interface NoInsertRecord {
  orderNo: string;
  order: NormalizedOrder;
  groups: string[];
  dates: string[];
  reason: string;
}

interface Stats {
  inserted: number;
  dupBatch: number;
  dupDb: number;
  multiGroup: number;
  serialConflict: number;
  reports: NoInsertRecord[];
}

async function main() {
  const dates = lastNDates(DAYS);

  const byOrderNo = new Map<string, OrderAgg>();
  let totalFetched = 0;

  for (const date of dates) {
    let orders: ProductionOrder[];
    try {
      orders = await fetchOrdersForDate(date);
    } catch (error) {
      console.log(`Failed to fetch ${date}: ${error}`);
      continue;
    }
    console.log(`Fetched ${orders.length} orders for ${date}`);
    totalFetched += orders.length;

    for (const rawOrder of orders) {
      const order = normalizeOrder(rawOrder);
      // An order with no number cannot be keyed or de-duplicated, so skip it here
      // rather than letting it collide under an empty key.
      const orderNo = order.order_no;
      if (!orderNo) continue;

      const agg = byOrderNo.get(orderNo) ?? {
        order,
        groups: new Map<string, number>(),
        dates: new Set<string>()
      };
      const g = groupKey(order);
      agg.groups.set(g, (agg.groups.get(g) ?? 0) + 1);
      agg.dates.add(date);
      byOrderNo.set(orderNo, agg);
    }
  }

  const orderNos = [...byOrderNo.keys()];
  const existing = new Map<string, Map<string, string>>();
  const serialToOrderNo = new Map<string, string>();

  for (let i = 0; i < orderNos.length; i += 500) {
    const chunk = orderNos.slice(i, i + 500);
    const machines = await prisma.machine.findMany({ where: { orderNo: { in: chunk } } });
    for (const m of machines) {
      if (!m.orderNo) continue;
      if (!existing.has(m.orderNo)) existing.set(m.orderNo, new Map());
      existing.get(m.orderNo)!.set(m.fertCategory ?? '', m.serialNumber);
      serialToOrderNo.set(m.serialNumber, m.orderNo);
    }
  }

  const stats: Stats = { inserted: 0, dupBatch: 0, dupDb: 0, multiGroup: 0, serialConflict: 0, reports: [] };
  const batchInserted = new Set<string>();

  const sortedOrders = [...byOrderNo.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [orderNo, agg] of sortedOrders) {
    const groups = [...agg.groups.keys()];
    const datesSeen = [...agg.dates].sort();

    if (existing.has(orderNo)) {
      const byGroup = existing.get(orderNo)!;
      if (byGroup.has(groupKey(agg.order))) {
        stats.dupDb++;
      } else {
        stats.serialConflict++;
        stats.reports.push({
          orderNo,
          order: agg.order,
          groups,
          dates: datesSeen,
          reason: `already in DB with group_cd ${JSON.stringify([...byGroup.keys()])}`
        });
      }
      continue;
    }

    if (groups.length > 1) {
      stats.multiGroup++;
      stats.reports.push({
        orderNo,
        order: agg.order,
        groups,
        dates: datesSeen,
        reason: 'more than one group_cd in the 10-day window'
      });
      continue;
    }

    if (batchInserted.has(orderNo)) {
      stats.dupBatch++;
      continue;
    }

    const existingSerial = agg.order.item_serial_no ? serialToOrderNo.get(agg.order.item_serial_no) : undefined;
    if (existingSerial && existingSerial !== orderNo) {
      stats.serialConflict++;
      stats.reports.push({
        orderNo,
        order: agg.order,
        groups,
        dates: datesSeen,
        reason: `serial ${agg.order.item_serial_no} already used by order_no ${existingSerial}`
      });
      continue;
    }

    // serialNumber is the machine's primary identity and is non-nullable in the
    // schema, so an order without one cannot be stored at all.
    if (!agg.order.item_serial_no) {
      stats.serialConflict++;
      stats.reports.push({
        orderNo,
        order: agg.order,
        groups,
        dates: datesSeen,
        reason: 'plant order has no item_serial_no'
      });
      continue;
    }

    const highestStage = getHighestCompletedStage(getOrderTrxs(agg.order));
    const model = extractModelFromDescription(agg.order.item_dsc);
    const fertCategory = getFertCategory(agg.order.group_dsc);
    const start = startDateTime(agg.order);
    const productionDate = start
      ? new Date(start)
      : new Date(`${datesSeen[0]}T00:00:00`);

    try {
      await prisma.machine.create({
        data: {
          serialNumber: agg.order.item_serial_no,
          barcode: agg.order.barcode_val,
          model,
          productionDate,
          status: 'AVAILABLE',
          assemblyStage: highestStage,
          orderNo: agg.order.order_no,
          productionOrderId: agg.order.production_order_id,
          itemCode: agg.order.item_cd,
          itemDescription: agg.order.item_dsc,
          fertCategory,
          parkStatus: highestStage >= 18 ? 'READY_TO_MOVE' : 'PLANNED',
          lastSyncAt: new Date()
        }
      });
      batchInserted.add(orderNo);
      serialToOrderNo.set(agg.order.item_serial_no, orderNo);
      stats.inserted++;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        stats.serialConflict++;
        stats.reports.push({
          orderNo,
          order: agg.order,
          groups,
          dates: datesSeen,
          reason: `unique constraint violation: ${JSON.stringify(error.meta?.target)}`
        });
      } else {
        throw error;
      }
    }
  }

  console.log('\n====================');
  console.log('BACKFILL SUMMARY (last 10 days)');
  console.log('====================');
  console.log(`Total order records fetched across 10 days: ${totalFetched}`);
  console.log(`Distinct order_no:                         ${byOrderNo.size}`);
  console.log(`Inserted into Machine table:               ${stats.inserted}`);
  console.log(`Skipped (duplicate in window):             ${stats.dupBatch}`);
  console.log(`Skipped (already in DB):                   ${stats.dupDb}`);
  console.log(`NOT inserted - multi group_cd:             ${stats.multiGroup}`);
  console.log(`NOT inserted - serial conflict:            ${stats.serialConflict}`);

  if (stats.reports.length > 0) {
    console.log('\n=== ORDERS NOT INSERTED (details) ===');
    for (const r of stats.reports) {
      const o = r.order;
      console.log('----------------------------------------');
      console.log(`order_no:            ${r.orderNo}`);
      console.log(`item_serial_no:      ${o.item_serial_no}`);
      console.log(`item_cd:             ${o.item_cd}`);
      console.log(`item_dsc:            ${o.item_dsc}`);
      console.log(`barcode_val:         ${o.barcode_val}`);
      console.log(`production_order_id: ${o.production_order_id}`);
      console.log(`group_cd(s) found:   ${JSON.stringify(r.groups)}`);
      console.log(`seen on dates:       ${r.dates.join(', ')}`);
      console.log(`reason:              ${r.reason}`);
    }
  }

  console.log('\nNote: order records seen under MORE THAN ONE group_cd were NOT inserted.');
  await prisma.$disconnect();
}

main().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});