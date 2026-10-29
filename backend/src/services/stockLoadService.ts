import prisma from '../lib/prisma';
import { autoVerifyIfCheckOff } from './parkingRules';

/**
 * Bulk initial stock load: an Excel / CSV list of machines already standing in the
 * yard before go-live, each with its yard and slot. The same rules as Allocate apply
 * (Stage 18, barcode, slot free, Initial stock load on). The page checks the file
 * first (preview), then places only the rows that passed.
 */

export const MAX_ROWS = 500;

export interface StockRowInput {
  serial: string;
  yard: string;
  slot: string;
  inwardDate?: string;
  remark?: string;
}

export interface StockRowResult extends StockRowInput {
  line: number;
  ok: boolean;
  error?: string;
  machineId?: string;
  slotId?: string;
}

/** "B7" (row letter + column, as on the yard map) or "2-7" -> { row: 2, col: 7 }. */
export function parseSlotLabel(raw: string): { row: number; col: number } | null {
  const s = raw.trim().toUpperCase();
  let m = /^([A-Z])\s*-?\s*(\d{1,3})$/.exec(s);
  if (m) return { row: m[1].charCodeAt(0) - 64, col: Number(m[2]) };
  m = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(s);
  if (m) return { row: Number(m[1]), col: Number(m[2]) };
  return null;
}

/** YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY (Indian order). Empty -> null, bad -> undefined. */
export function parseInwardDate(raw: string | undefined, today = new Date()): Date | null | undefined {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return undefined;
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined;
  if (date.getTime() > today.getTime()) return undefined;
  return date;
}

/** Same machine or same slot twice in one file: every later copy is an error. */
export function findDuplicates(rows: StockRowInput[]): Map<number, string> {
  const errors = new Map<number, string>();
  const serials = new Map<string, number>();
  const slots = new Map<string, number>();
  rows.forEach((r, i) => {
    const sk = r.serial.trim().toUpperCase();
    const lk = `${r.yard.trim().toUpperCase()}|${r.slot.trim().toUpperCase()}`;
    if (sk && serials.has(sk)) errors.set(i, `Same machine as line ${serials.get(sk)! + 2}`);
    else if (r.slot.trim() && slots.has(lk)) errors.set(i, `Same slot as line ${slots.get(lk)! + 2}`);
    if (sk && !serials.has(sk)) serials.set(sk, i);
    if (r.slot.trim() && !slots.has(lk)) slots.set(lk, i);
  });
  return errors;
}

/** Check every row against the database. Line numbers count the header as line 1. */
export async function checkRows(rows: StockRowInput[]): Promise<StockRowResult[]> {
  const dup = findDuplicates(rows);
  const yards = await prisma.yard.findMany({ select: { id: true, name: true } });
  const yardByName = new Map(yards.map((y) => [y.name.trim().toUpperCase(), y.id]));
  const out: StockRowResult[] = [];
  // The same machine can appear once by serial and once by barcode.
  const machineLine = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res: StockRowResult = { ...r, line: i + 2, ok: false };
    out.push(res);
    const fail = (error: string) => { res.error = error; };

    if (!r.serial.trim() || !r.yard.trim() || !r.slot.trim()) { fail('Serial number, yard and slot are required'); continue; }
    if (dup.has(i)) { fail(dup.get(i)!); continue; }
    if (parseInwardDate(r.inwardDate) === undefined) { fail('Inward date must be a past date, e.g. 2026-08-15 or 15-08-2026'); continue; }

    const key = r.serial.trim();
    const machine = await prisma.machine.findFirst({
      where: { OR: [{ serialNumber: key }, { barcode: key }] },
      select: { id: true, currentSlotId: true, parkStatus: true, assemblyStage: true, barcode: true }
    });
    if (!machine) { fail('Machine not found (serial number or barcode)'); continue; }
    if (machineLine.has(machine.id)) { fail(`Same machine as line ${machineLine.get(machine.id)}`); continue; }
    machineLine.set(machine.id, res.line);
    if (machine.currentSlotId) { fail('Already in a slot'); continue; }
    if (['IN_TRANSIT', 'AT_GATE'].includes(machine.parkStatus)) { fail('In the gate process; finish it through Gate Control'); continue; }
    if (machine.parkStatus === 'EXITED') { fail('Has left the yard; it must come in through Gate Control'); continue; }
    if (machine.assemblyStage < 18 || !machine.barcode?.trim()) { fail('Needs Stage 18 cleared and a barcode label'); continue; }

    const yardId = yardByName.get(r.yard.trim().toUpperCase());
    if (!yardId) { fail(`Yard "${r.yard.trim()}" not found`); continue; }
    const pos = parseSlotLabel(r.slot);
    if (!pos) { fail('Slot must look like B7 (row letter and column)'); continue; }
    const slot = await prisma.slot.findFirst({
      where: { yardId, row: pos.row, col: pos.col },
      select: { id: true, status: true, machine: { select: { id: true } } }
    });
    if (!slot) { fail(`Slot ${r.slot.trim().toUpperCase()} does not exist in this yard`); continue; }
    if (slot.status !== 'AVAILABLE' || slot.machine) { fail(`Slot is not free (${slot.status.toLowerCase().replace(/_/g, ' ')})`); continue; }

    res.ok = true;
    res.machineId = machine.id;
    res.slotId = slot.id;
  }
  return out;
}

/** Place the rows that pass the check (checked again here). Returns all results. */
export async function placeRows(rows: StockRowInput[], actorId: string): Promise<{ results: StockRowResult[]; placed: number; pending: number }> {
  const results = await checkRows(rows);
  let placed = 0;
  let pending = 0;
  for (const r of results) {
    if (!r.ok || !r.machineId || !r.slotId) continue;
    const inward = parseInwardDate(r.inwardDate);
    const remark = (r.remark ?? '').trim().slice(0, 400) || 'bulk upload';
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: another user may have taken the slot.
        const slot = await tx.slot.findUnique({ where: { id: r.slotId }, select: { yardId: true, status: true, machine: { select: { id: true } } } });
        if (!slot || slot.status !== 'AVAILABLE' || slot.machine) throw new Error('Slot was taken meanwhile');
        const m = await tx.machine.findUnique({ where: { id: r.machineId }, select: { currentSlotId: true } });
        if (!m || m.currentSlotId) throw new Error('Machine was placed meanwhile');
        await tx.movement.create({
          data: { machineId: r.machineId!, yardId: slot.yardId, fromSlotId: null, toSlotId: r.slotId!, userId: actorId, reason: 'YARD_ENTRY', notes: `Initial stock load: ${remark}` }
        });
        await tx.machine.update({
          where: { id: r.machineId },
          data: { currentSlotId: r.slotId, parkStatus: 'PARKED_PENDING', ...(inward && { yardInwardAt: inward }) }
        });
        await tx.slot.update({ where: { id: r.slotId }, data: { status: 'OCCUPIED' } });
      });
      if (!(await autoVerifyIfCheckOff(r.machineId, r.slotId, actorId))) pending++;
      placed++;
    } catch (error) {
      r.ok = false;
      r.error = error instanceof Error ? error.message : 'Could not place';
    }
  }
  return { results, placed, pending };
}
