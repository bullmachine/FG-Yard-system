import 'dotenv/config';
import { ProductionOrder, toNullableString } from '../src/services/productionApiService';

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

interface DupRecord {
  order: ProductionOrder;
  count: number;
  dates: Set<string>;
}

async function fetchOrdersForDate(date: string): Promise<ProductionOrder[]> {
  const url = `${process.env.PRODUCTION_API_URL || 'http://192.168.1.102/bdf/apps/bafrestapi.php/PRODUCTION_API/REST'}?hsMode=GET-PRODUCTION-ORDER-TRX&hxTrxDt=${date}`;
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

async function main() {
  const dates = lastNDates(7);
  const byOrderNo = new Map<string, DupRecord>();

  for (const date of dates) {
    let orders: ProductionOrder[];
    try {
      orders = await fetchOrdersForDate(date);
    } catch (error) {
      console.log(`Failed to fetch ${date}: ${error}`);
      continue;
    }

    console.log(`Fetched ${orders.length} orders for ${date}`);

    for (const order of orders) {
      // Plant text fields can arrive as a one-element array, so normalise before
      // using the order number as a map key or sorting on it.
      const orderNo = toNullableString(order.order_no);
      if (!orderNo) continue;

      const existing = byOrderNo.get(orderNo);
      if (existing) {
        existing.count++;
        existing.dates.add(date);
      } else {
        byOrderNo.set(orderNo, { order, count: 1, dates: new Set([date]) });
      }
    }
  }

  const duplicates = [...byOrderNo.values()].filter(d => d.count > 1);

  console.log('\n====================');
  console.log(`Duplicate order_no count: ${duplicates.length}`);
  console.log('====================');

  if (duplicates.length === 0) {
    console.log('No duplicate order numbers found in the last 7 days.');
    return;
  }

  for (const dup of duplicates.sort((a, b) => toNullableString(a.order.order_no)!.localeCompare(toNullableString(b.order.order_no)!))) {
    const o = dup.order;
    console.log('\n----------------------------------------');
    console.log(`order_no:            ${o.order_no}`);
    console.log(`item_serial_no:      ${o.item_serial_no}`);
    console.log(`item_cd:             ${o.item_cd}`);
    console.log(`item_dsc:            ${o.item_dsc}`);
    console.log(`barcode_val:         ${o.barcode_val}`);
    console.log(`production_order_id: ${o.production_order_id}`);
    console.log(`group_dsc:           ${JSON.stringify(o.group_dsc)}`);
    console.log(`occurrences:         ${dup.count}`);
    console.log(`seen on dates:       ${[...dup.dates].sort().join(', ')}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});