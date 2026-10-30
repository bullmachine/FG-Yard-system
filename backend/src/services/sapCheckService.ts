import prisma from '../lib/prisma';
import { sapRequest } from './sapClient';
import { notifyEvent } from './notificationService';

/**
 * SAP check: compares SAP's FG stock (FG_API) and delivery / invoice documents (UM_API)
 * with what FG Yard records, and lists the machines where the two disagree. It only
 * reports; nothing here blocks the gate or changes a machine.
 */

interface SapStockRow {
  MATERIAL: string;
  DESCRIPTION?: string;
  SERIALNUM: string;
  CONF_DATE?: string;
  STORAGE_LOC?: string;
  EXT_MAT_GRP?: string;
}

interface SapDeliveryRow {
  INVOICE: string;
  FERT: string;
  DESCRIPTION?: string;
  MSNO: string;
  DELIVERY_DATE: string;
}

/** SAP cuts MSNO at this length, so the last serial of such a line may be half a serial. */
export const MSNO_CUT_LENGTH = 132;
/** Days allowed between invoice and FG gate out, or main gate out and invoice, before a machine is listed. */
export const GRACE_DAYS = 2;
/** Each run re-reads this many days before the last covered day, to pick up late postings. */
const OVERLAP_DAYS = 3;
/** After a long stop, catch up at most this far back in one run. */
const MAX_CATCH_UP_DAYS = 120;
/** An empty delivery range has taken over 20 s to answer, so allow more than the material default. */
const SAP_TIMEOUT_MS = 120000;

const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function sapCheckCron(): string {
  return process.env.SAP_CHECK_CRON || '20 */2 * * *';
}

export function serialKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** SAP date "YYYYMMDD" as a local date; "00000000" or anything invalid is null. */
export function parseSapDate(value: unknown): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

export function formatSapDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

/** 1 April of the financial year that `now` falls in. */
export function fyStart(now: Date): Date {
  return new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
}

/**
 * Serials in one MSNO. SAP sends a single serial ("HDSS8546"), or line items with a
 * number prefix, serials split by "/" and items by "," ("10.HN2392/HN2393,20.HN2399").
 * A value at the cut length lost its end, so its last serial is dropped as unreliable.
 */
export function splitMsno(value: unknown): { serials: string[]; cut: boolean } {
  const text = String(value ?? '').trim();
  const cut = text.length >= MSNO_CUT_LENGTH;
  const serials: string[] = [];
  for (const item of text.split(',')) {
    for (const part of item.trim().replace(/^\d+\./, '').split('/')) {
      const key = serialKey(part);
      if (key) serials.push(key);
    }
  }
  if (cut && !/[/,]$/.test(text)) serials.pop();
  return { serials: [...new Set(serials)], cut };
}

// ---------------------------------------------------------------------------
// Reconciliation (pure, unit tested)
// ---------------------------------------------------------------------------

export type SapGroupKey =
  | 'invoicedNotClosed'
  | 'leftNoInvoice'
  | 'yardNotInStock'
  | 'stockInAssembly'
  | 'stockNoRecord'
  | 'stockAwaitingGate';

/** Groups that count as a mismatch. stockAwaitingGate is the normal queue to the gate. */
export const MISMATCH_GROUPS: SapGroupKey[] = ['invoicedNotClosed', 'leftNoInvoice', 'yardNotInStock', 'stockInAssembly', 'stockNoRecord'];

export interface ReconMachine {
  id: string;
  serialNumber: string;
  model: string | null;
  itemCode: string | null;
  parkStatus: string;
  location: string | null;
}
export interface ReconStock {
  serialNumber: string;
  material: string;
  description: string | null;
  storageLoc: string | null;
  matGroup: string | null;
  confDate: Date | null;
}
export interface ReconDelivery {
  invoice: string;
  serialNumber: string;
  material: string;
  deliveryDate: Date;
  cutRow: boolean;
}
export interface ReconGateOut {
  machineId: string;
  mainGateOutAt: Date;
}
export interface ReconRow {
  serialNumber: string;
  model: string | null;
  material: string | null;
  fgStatus: string | null;
  location: string | null;
  storageLoc: string | null;
  matGroup: string | null;
  confDate: Date | null;
  invoice: string | null;
  deliveryDate: Date | null;
  mainGateOutAt: Date | null;
  note: string | null;
}

const IN_YARD = new Set(['IN_TRANSIT', 'AT_GATE', 'PARKED_PENDING', 'PARKED_REJECTED', 'PARKED_VERIFIED']);

export function reconcile(input: {
  machines: ReconMachine[];
  stock: ReconStock[];
  deliveries: ReconDelivery[];
  gateOuts: ReconGateOut[];
  coverageFrom: Date | null;
  now: Date;
}): Record<SapGroupKey, ReconRow[]> {
  const groups: Record<SapGroupKey, ReconRow[]> = {
    invoicedNotClosed: [], leftNoInvoice: [], yardNotInStock: [], stockInAssembly: [], stockNoRecord: [], stockAwaitingGate: []
  };
  const graceCutoff = new Date(input.now.getTime() - GRACE_DAYS * DAY);

  const machines = new Map(input.machines.map((m) => [serialKey(m.serialNumber), m]));
  const machineById = new Map(input.machines.map((m) => [m.id, m]));
  const stock = new Map(input.stock.map((s) => [serialKey(s.serialNumber), s]));
  const docs = new Map<string, ReconDelivery[]>();
  for (const d of input.deliveries) {
    const key = serialKey(d.serialNumber);
    docs.set(key, [...(docs.get(key) ?? []), d]);
  }
  const latestDoc = (key: string) =>
    (docs.get(key) ?? []).reduce<ReconDelivery | null>((best, d) => (!best || d.deliveryDate > best.deliveryDate ? d : best), null);
  // Cut-off invoice lines by material: a machine missing from SAP's documents may be on one of them.
  const cutByMaterial = new Map<string, Set<string>>();
  for (const d of input.deliveries) {
    if (!d.cutRow) continue;
    cutByMaterial.set(d.material, (cutByMaterial.get(d.material) ?? new Set<string>()).add(d.invoice));
  }

  const row = (key: string, m: ReconMachine | undefined, extra: Partial<ReconRow> = {}): ReconRow => {
    const s = stock.get(key);
    return {
      serialNumber: m?.serialNumber ?? s?.serialNumber ?? key,
      model: m?.model ?? s?.description ?? null,
      material: m?.itemCode ?? s?.material ?? null,
      fgStatus: m?.parkStatus ?? null,
      location: m?.location ?? null,
      storageLoc: s?.storageLoc ?? null,
      matGroup: s?.matGroup ?? null,
      confDate: s?.confDate ?? null,
      invoice: null,
      deliveryDate: null,
      mainGateOutAt: null,
      note: null,
      ...extra
    };
  };

  // SAP still holds it as FG stock: where is it in FG Yard?
  for (const key of stock.keys()) {
    const m = machines.get(key);
    if (!m) groups.stockNoRecord.push(row(key, m));
    else if (m.parkStatus === 'PLANNED') groups.stockInAssembly.push(row(key, m));
    else if (m.parkStatus === 'READY_TO_MOVE') groups.stockAwaitingGate.push(row(key, m));
  }

  for (const [key, m] of machines) {
    if (stock.has(key)) continue;
    const doc = latestDoc(key);
    if (doc && m.parkStatus !== 'EXITED') {
      // Out of SAP stock and invoiced, but FG Yard still shows it here.
      if (doc.deliveryDate <= graceCutoff) {
        groups.invoicedNotClosed.push(row(key, m, { invoice: doc.invoice, deliveryDate: doc.deliveryDate }));
      }
    } else if (!doc && IN_YARD.has(m.parkStatus)) {
      groups.yardNotInStock.push(row(key, m));
    }
  }

  // Through the main gate, but no SAP document. Only inside the delivery dates covered.
  if (input.coverageFrom) {
    const latestOut = new Map<string, Date>();
    for (const g of input.gateOuts) {
      const seen = latestOut.get(g.machineId);
      if (!seen || g.mainGateOutAt > seen) latestOut.set(g.machineId, g.mainGateOutAt);
    }
    for (const [machineId, outAt] of latestOut) {
      if (outAt > graceCutoff || outAt < input.coverageFrom) continue;
      const m = machineById.get(machineId);
      if (!m) continue;
      const key = serialKey(m.serialNumber);
      const windowStart = new Date(outAt.getTime() - 30 * DAY);
      if ((docs.get(key) ?? []).some((d) => d.deliveryDate >= windowStart)) continue;
      const cut = m.itemCode ? cutByMaterial.get(m.itemCode) : undefined;
      groups.leftNoInvoice.push(row(key, m, {
        mainGateOutAt: outAt,
        note: cut ? `May be on a cut-off SAP invoice: ${[...cut].slice(0, 3).join(', ')}` : null
      }));
    }
  }

  const byDate = (a: Date | null, b: Date | null) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
  groups.invoicedNotClosed.sort((a, b) => byDate(a.deliveryDate, b.deliveryDate));
  groups.leftNoInvoice.sort((a, b) => byDate(a.mainGateOutAt, b.mainGateOutAt));
  for (const k of ['yardNotInStock', 'stockInAssembly', 'stockNoRecord', 'stockAwaitingGate'] as const) {
    groups[k].sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

let running = false;
let summaryCache: { at: number; value: { total: number; lastOkAt: Date } | null } | null = null;

export interface SapCheckRunResult {
  ok: boolean;
  error?: string;
  stockRows?: number;
  deliveryRows?: number;
  deliveryFrom?: string;
  deliveryTo?: string;
}

/**
 * Pull SAP stock and deliveries. The stock list is replaced as a whole; deliveries are
 * added (never removed). The first run reads from 1 April of the financial year; later
 * runs from a few days before the last covered day, so a stopped server catches up.
 */
export async function runSapCheck(trigger: string, now = new Date()): Promise<SapCheckRunResult> {
  if (running) return { ok: false, error: 'An SAP check is already running' };
  running = true;
  const run = await prisma.sapSyncRun.create({ data: { trigger, startedAt: new Date() } });

  try {
    const stockRaw = await sapRequest<SapStockRow>({ API_TYP: 'FG_API' }, 'SAP FG stock', SAP_TIMEOUT_MS);
    const syncedAt = new Date();
    const stock = new Map<string, ReconStock & { syncedAt: Date }>();
    for (const r of stockRaw) {
      const key = serialKey(r.SERIALNUM);
      if (!key || stock.has(key)) continue;
      stock.set(key, {
        serialNumber: key,
        material: String(r.MATERIAL ?? '').trim(),
        description: String(r.DESCRIPTION ?? '').trim() || null,
        storageLoc: String(r.STORAGE_LOC ?? '').trim() || null,
        matGroup: String(r.EXT_MAT_GRP ?? '').trim() || null,
        confDate: parseSapDate(r.CONF_DATE),
        syncedAt
      });
    }
    if (stock.size === 0) throw new Error('SAP returned an empty FG stock list; the previous list is kept');

    const lastOk = await prisma.sapSyncRun.findFirst({
      where: { ok: true, deliveryTo: { not: null } },
      orderBy: { startedAt: 'desc' }
    });
    const to = addDays(now, 0);
    let from = fyStart(now);
    if (lastOk?.deliveryTo) {
      from = addDays(lastOk.deliveryTo, -OVERLAP_DAYS);
      const floor = addDays(to, -MAX_CATCH_UP_DAYS);
      if (from < floor) from = floor;
    }

    const deliveryRaw = await sapRequest<SapDeliveryRow>(
      { API_TYP: 'UM_API', FROM_DT: formatSapDate(from), TO_DT: formatSapDate(to) },
      'SAP delivery',
      SAP_TIMEOUT_MS
    );
    const deliveries: Array<ReconDelivery & { description: string | null; syncedAt: Date }> = [];
    for (const r of deliveryRaw) {
      const invoice = String(r.INVOICE ?? '').trim();
      const deliveryDate = parseSapDate(r.DELIVERY_DATE);
      if (!invoice || !deliveryDate) continue;
      const { serials, cut } = splitMsno(r.MSNO);
      for (const serialNumber of serials) {
        deliveries.push({
          invoice,
          serialNumber,
          material: String(r.FERT ?? '').trim(),
          description: String(r.DESCRIPTION ?? '').trim() || null,
          deliveryDate,
          cutRow: cut,
          syncedAt
        });
      }
    }

    await prisma.$transaction([
      prisma.sapStockItem.deleteMany({}),
      prisma.sapStockItem.createMany({ data: [...stock.values()] }),
      prisma.sapDelivery.createMany({ data: deliveries, skipDuplicates: true })
    ]);

    await prisma.sapSyncRun.update({
      where: { id: run.id },
      data: { ok: true, finishedAt: new Date(), stockRows: stock.size, deliveryRows: deliveries.length, deliveryFrom: from, deliveryTo: to }
    });
    summaryCache = null;
    return {
      ok: true,
      stockRows: stock.size,
      deliveryRows: deliveries.length,
      deliveryFrom: formatSapDate(from),
      deliveryTo: formatSapDate(to)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('SAP check failed:', message);
    await prisma.sapSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: message.slice(0, 1000) } });
    await notifyEvent({
      type: 'SYNC_FAILED',
      severity: 'CRITICAL',
      title: 'SAP check failed',
      message,
      link: 'sap'
    }).catch(() => undefined);
    return { ok: false, error: message };
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export async function sapCheckStatus() {
  const [last, lastOk, coverage, stockCount, deliveryCount, cutInvoices] = await Promise.all([
    prisma.sapSyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.sapSyncRun.findFirst({ where: { ok: true }, orderBy: { startedAt: 'desc' } }),
    prisma.sapSyncRun.aggregate({ where: { ok: true }, _min: { deliveryFrom: true } }),
    prisma.sapStockItem.count(),
    prisma.sapDelivery.count(),
    prisma.sapDelivery.groupBy({ by: ['invoice'], where: { cutRow: true } })
  ]);
  return {
    running,
    cron: sapCheckCron(),
    graceDays: GRACE_DAYS,
    last: last && { ok: last.ok, startedAt: last.startedAt, finishedAt: last.finishedAt, trigger: last.trigger, error: last.error },
    lastOkAt: lastOk?.finishedAt ?? null,
    coverageFrom: coverage._min.deliveryFrom,
    stockCount,
    deliveryCount,
    cutInvoices: cutInvoices.length
  };
}

const slotText = (s: { row: number; col: number; yard: { name: string } } | null) =>
  s ? `${s.yard.name} ${String.fromCharCode(64 + s.row)}${s.col}` : null;

async function loadGroups(now: Date, coverageFrom: Date | null) {
  const slot = { select: { row: true, col: true, yard: { select: { name: true } } } };
  const [machines, stock, deliveries, gateOuts] = await Promise.all([
    prisma.machine.findMany({
      where: { isDemo: false },
      select: { id: true, serialNumber: true, model: true, itemCode: true, parkStatus: true, currentSlot: slot }
    }),
    prisma.sapStockItem.findMany(),
    prisma.sapDelivery.findMany({ select: { invoice: true, serialNumber: true, material: true, deliveryDate: true, cutRow: true } }),
    prisma.dispatchItem.findMany({
      where: { status: 'MAIN_GATE_OUT', mainGateOutAt: { not: null } },
      select: { machineId: true, mainGateOutAt: true }
    })
  ]);
  return reconcile({
    machines: machines.map((m) => ({ ...m, location: slotText(m.currentSlot) })),
    stock,
    deliveries,
    gateOuts: gateOuts.map((g) => ({ machineId: g.machineId, mainGateOutAt: g.mainGateOutAt as Date })),
    coverageFrom,
    now
  });
}

export async function sapCheckReport(now = new Date()) {
  const status = await sapCheckStatus();
  if (!status.lastOkAt) return { status, groups: null };
  return { status, groups: await loadGroups(now, status.coverageFrom) };
}

/** Mismatch count for the dashboard; cached for a minute because the dashboard refreshes often. */
export async function sapMismatchSummary(): Promise<{ total: number; lastOkAt: Date } | null> {
  if (summaryCache && Date.now() - summaryCache.at < 60000) return summaryCache.value;
  const status = await sapCheckStatus();
  let value: { total: number; lastOkAt: Date } | null = null;
  if (status.lastOkAt) {
    const groups = await loadGroups(new Date(), status.coverageFrom);
    value = { total: MISMATCH_GROUPS.reduce((n, k) => n + groups[k].length, 0), lastOkAt: status.lastOkAt };
  }
  summaryCache = { at: Date.now(), value };
  return value;
}

/** SAP stock entry and documents for one machine (machine history › SAP). */
export async function machineSapInfo(serialNumber: string) {
  const key = serialKey(serialNumber);
  const [stock, documents, lastOk] = await Promise.all([
    prisma.sapStockItem.findUnique({ where: { serialNumber: key } }),
    prisma.sapDelivery.findMany({ where: { serialNumber: key }, orderBy: { deliveryDate: 'desc' } }),
    prisma.sapSyncRun.findFirst({ where: { ok: true }, orderBy: { startedAt: 'desc' } })
  ]);
  return {
    checkedAt: lastOk?.finishedAt ?? null,
    stock,
    documents: documents.map((d) => ({
      invoice: d.invoice,
      deliveryDate: d.deliveryDate,
      material: d.material,
      description: d.description,
      cutRow: d.cutRow
    }))
  };
}
