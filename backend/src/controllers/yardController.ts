import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getYardAvailability as getAvailabilitySummary, getWaitingMachines } from '../services/locationAssignmentService';
import { releaseSlotReservation as releaseReservation } from '../services/locationAssignmentService';
import { notifyEvent } from '../services/notificationService';

const plannedForSelect = {
  serialNumber: true,
  model: true,
  parkStatus: true,
  assemblyStage: true,
  driverId: true,
  slotWaitingSince: true,
} as const;

const DEFAULT_YARD_DIMENSION = 10;
const MAX_YARD_DIMENSION = 100;
// A yard is a physical grid of numbered slots, so an unbounded rows*cols would let one
// request attempt a million-row insert. Real yards here run 3x5 to 5x8.
const MAX_YARD_SLOTS = 2000;

/** Read the Prisma error code (P2002 unique, P2003 FK, P2014 required relation) safely. */
function prismaCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Parse a rows/cols field.
 *
 * Returns the number, or an error string. `undefined` means the caller omitted the
 * field entirely, which on update means "keep the current value" - distinct from an
 * invalid value, which is a 400.
 */
function parseDimension(
  value: unknown,
  field: string
): { value: number } | { error: string } | undefined {
  if (value === undefined) return undefined;

  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;

  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { error: `${field} must be a whole number` };
  }
  if (raw < 1) return { error: `${field} must be at least 1` };
  if (raw > MAX_YARD_DIMENSION) return { error: `${field} cannot exceed ${MAX_YARD_DIMENSION}` };
  return { value: raw };
}

/**
 * Normalise a latitude/longitude.
 *
 * The form initialises both to 0 and neither field is required, so 0 is treated as "not
 * set" rather than a real coordinate - otherwise saving a yard untouched would write
 * Null Island into it. Out-of-range values are rejected rather than clamped, since a
 * silently adjusted coordinate is worse than an error.
 */
function normalizeCoordinate(
  value: unknown,
  field: string,
  limit: number
): { value: number | null } | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return { value: null };

  const raw = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(raw)) return { error: `${field} must be a number` };
  if (raw === 0) return { value: null };
  if (Math.abs(raw) > limit) return { error: `${field} must be between -${limit} and ${limit}` };
  return { value: raw };
}

function normalizeAddress(value: unknown): { value: string | null } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { value: null };
  const text = typeof value === 'string' ? value.trim() : '';
  return { value: text === '' ? null : text };
}

export const getAllYards = async (req: Request, res: Response) => {
  try {
    const yards = await prisma.yard.findMany({
      include: {
        _count: {
          select: { slots: true }
        },
        // Full status breakdown happens on the client; _count above is kept for
        // callers that only ever cared about the total.
        slots: {
          select: { status: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(
      yards.map(({ slots, _count, ...yard }) => {
        const counts = slots.reduce<Record<string, number>>((acc, slot) => {
          acc[slot.status] = (acc[slot.status] ?? 0) + 1;
          return acc;
        }, {});
        return { ...yard, totalSlots: _count.slots, slotCounts: counts };
      })
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch yards' });
  }
};

export const getYardById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const yardId = Array.isArray(id) ? id[0] : id;

    console.log('Fetching yard with ID:', yardId);

    const yard = await prisma.yard.findUnique({
      where: { id: yardId },
      include: {
        slots: {
          include: {
            // machine is the machine actually parked here (CurrentSlot).
            // The full row plus its driver so the yard detail panel can show
            // barcode/order/park info and who is assigned to it.
            // Plus why it is not free stock: its latest dispatch (planned, or the trip it
            // came back from), an open exit request and the last security decision.
            machine: {
              include: {
                driver: true,
                dispatchItems: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { status: true, gateOutAt: true, mainGateOutAt: true, returnedAt: true, plan: { select: { planNo: true, soNumber: true } } }
                },
                exitRequests: {
                  where: { status: { in: ['PENDING', 'APPROVED'] } },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { reason: true, status: true, notes: true, createdAt: true, requestedBy: { select: { name: true } } }
                },
                securityVerifications: {
                  orderBy: { verifiedAt: 'desc' },
                  take: 1,
                  select: { status: true, comments: true, verifiedAt: true, user: { select: { name: true } } }
                }
              }
            },
            // plannedFor is the machine that holds this slot as a promise (PlannedSlot).
            // Without it a RESERVED slot is indistinguishable from an empty one.
            plannedFor: { select: plannedForSelect },
            blockedBy: { select: { name: true } },
            // History counts let the client tell the user whether removing this slot
            // would delete it or mark it out of service, instead of guessing.
            _count: {
              select: { movementsFrom: true, movementsTo: true, securityVerifications: true }
            },
            // Latest movement into this slot = when the machine was parked/placed here.
            // The performing user lets the yard detail panel show who parked it.
            movementsTo: {
              orderBy: { timestamp: 'desc' },
              take: 1,
              select: {
                timestamp: true,
                reason: true,
                user: { select: { name: true } }
              }
            }
          },
          orderBy: [{ row: 'asc' }, { col: 'asc' }]
        }
      }
    });

    if (!yard) {
      console.log('Yard not found with ID:', yardId);
      return res.status(404).json({ error: 'Yard not found' });
    }

    console.log('Yard fetched successfully:', yard.name);
    res.json(yard);
  } catch (error) {
    console.error('Error fetching yard:', error);
    res.status(500).json({ error: 'Failed to fetch yard' });
  }
};

export const createYard = async (req: Request, res: Response) => {
  try {
    const { name, description, rows, cols, latitude, longitude, address } = req.body;

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Yard name is required' });
    }

    const parsedRows = parseDimension(rows, 'Rows');
    if (parsedRows && 'error' in parsedRows) return res.status(400).json({ error: parsedRows.error });
    const parsedCols = parseDimension(cols, 'Columns');
    if (parsedCols && 'error' in parsedCols) return res.status(400).json({ error: parsedCols.error });

    const rowCount = parsedRows && 'value' in parsedRows ? parsedRows.value : DEFAULT_YARD_DIMENSION;
    const colCount = parsedCols && 'value' in parsedCols ? parsedCols.value : DEFAULT_YARD_DIMENSION;

    if (rowCount * colCount > MAX_YARD_SLOTS) {
      return res.status(400).json({ error: `A yard cannot have more than ${MAX_YARD_SLOTS} slots` });
    }

    const parsedLat = normalizeCoordinate(latitude, 'Latitude', 90);
    if (parsedLat && 'error' in parsedLat) return res.status(400).json({ error: parsedLat.error });
    const parsedLng = normalizeCoordinate(longitude, 'Longitude', 180);
    if (parsedLng && 'error' in parsedLng) return res.status(400).json({ error: parsedLng.error });
    const parsedAddress = normalizeAddress(address);

    // The yard and its slots go in together. Without the transaction a failed slot
    // insert would leave a yard row whose rows*cols promises slots that do not exist.
    const yard = await prisma.$transaction(async (tx) => {
      const created = await tx.yard.create({
        data: {
          name: name.trim(),
          description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null,
          rows: rowCount,
          cols: colCount,
          latitude: parsedLat && 'value' in parsedLat ? parsedLat.value : null,
          longitude: parsedLng && 'value' in parsedLng ? parsedLng.value : null,
          address: parsedAddress ? parsedAddress.value : null
        }
      });

      const slots = [];
      for (let row = 1; row <= created.rows; row++) {
        for (let col = 1; col <= created.cols; col++) {
          slots.push({ yardId: created.id, row, col, status: 'AVAILABLE' as const });
        }
      }
      await tx.slot.createMany({ data: slots });

      return created;
    });

    res.status(201).json(yard);
  } catch (error) {
    if (prismaCode(error) === 'P2002') {
      return res.status(400).json({ error: 'A yard with that name already exists' });
    }
    res.status(500).json({ error: 'Failed to create yard' });
  }
};

/**
 * Resize an existing yard. GROW ONLY.
 *
 * Growing adds the missing cells; reducing is refused outright. A slot is not a plain
 * row: it can hold a machine (CurrentSlot), a live reservation (PlannedSlot), movement
 * history and security verifications, and every one of those FKs is nullable with no
 * onDelete, so deleting a slot to shrink a grid would silently un-park a machine or
 * null an audit link. MySQL would refuse only the mandatory SecurityVerification.slotId
 * case, so the rest has to be refused here.
 *
 * The insert and the metadata write share a transaction, otherwise a failed insert
 * would leave rows/cols promising slots that were never created - which is exactly the
 * broken state this endpoint used to be able to produce.
 */
export const updateYard = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const yardId = Array.isArray(id) ? id[0] : id;
    const { name, description, rows, cols, latitude, longitude, address } = req.body;

    const existing = await prisma.yard.findUnique({ where: { id: yardId } });
    if (!existing) return res.status(404).json({ error: 'Yard not found' });

    const parsedRows = parseDimension(rows, 'Rows');
    if (parsedRows && 'error' in parsedRows) return res.status(400).json({ error: parsedRows.error });
    const parsedCols = parseDimension(cols, 'Columns');
    if (parsedCols && 'error' in parsedCols) return res.status(400).json({ error: parsedCols.error });

    const rowCount = parsedRows && 'value' in parsedRows ? parsedRows.value : existing.rows;
    const colCount = parsedCols && 'value' in parsedCols ? parsedCols.value : existing.cols;

    if (rowCount < existing.rows || colCount < existing.cols) {
      return res.status(400).json({
        error: `${existing.name} is ${existing.rows} x ${existing.cols} and cannot be made smaller. ` +
          'Removing individual slots from the yard view is the supported way to retire capacity.'
      });
    }

    if (rowCount * colCount > MAX_YARD_SLOTS) {
      return res.status(400).json({ error: `A yard cannot have more than ${MAX_YARD_SLOTS} slots` });
    }

    const parsedLat = normalizeCoordinate(latitude, 'Latitude', 90);
    if (parsedLat && 'error' in parsedLat) return res.status(400).json({ error: parsedLat.error });
    const parsedLng = normalizeCoordinate(longitude, 'Longitude', 180);
    if (parsedLng && 'error' in parsedLng) return res.status(400).json({ error: parsedLng.error });
    const parsedAddress = normalizeAddress(address);

    // Only the rectangle cells with no slot yet. Reading the existing pairs rather than
    // trusting rows*cols also self-heals a yard whose metadata and slots disagree.
    const existingSlots = await prisma.slot.findMany({
      where: { yardId },
      select: { row: true, col: true }
    });
    const taken = new Set(existingSlots.map((s) => `${s.row}:${s.col}`));

    const missing: Array<{ yardId: string; row: number; col: number; status: 'AVAILABLE' }> = [];
    for (let row = 1; row <= rowCount; row++) {
      for (let col = 1; col <= colCount; col++) {
        if (!taken.has(`${row}:${col}`)) missing.push({ yardId, row, col, status: 'AVAILABLE' as const });
      }
    }

    const yard = await prisma.$transaction(async (tx) => {
      // skipDuplicates guards the unique (yardId,row,col) index if two admins save at once.
      if (missing.length > 0) await tx.slot.createMany({ data: missing, skipDuplicates: true });

      return tx.yard.update({
        where: { id: yardId },
        data: {
          ...(name !== undefined ? { name: typeof name === 'string' && name.trim() !== '' ? name.trim() : existing.name } : {}),
          ...(description !== undefined ? { description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null } : {}),
          rows: rowCount,
          cols: colCount,
          ...(parsedLat && 'value' in parsedLat ? { latitude: parsedLat.value } : {}),
          ...(parsedLng && 'value' in parsedLng ? { longitude: parsedLng.value } : {}),
          ...(parsedAddress ? { address: parsedAddress.value } : {})
        }
      });
    });

    res.json({ ...yard, slotsCreated: missing.length });
  } catch (error) {
    if (prismaCode(error) === 'P2002') {
      return res.status(400).json({ error: 'A yard with that name already exists' });
    }
    console.error('Error updating yard:', error);
    res.status(500).json({ error: 'Failed to update yard' });
  }
};

export const deleteYard = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const yardId = Array.isArray(id) ? id[0] : id;
    
    await prisma.yard.delete({
      where: { id: yardId }
    });
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete yard' });
  }
};

export const getYardAvailability = async (_req: Request, res: Response) => {
  try {
    const availability = await getAvailabilitySummary();
    const totalAvailable = availability.reduce((acc, y) => acc + y.available, 0);
    const waiting = await getWaitingMachines(50);
    res.json({ availability, totalAvailable, waiting });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch yard availability' });
  }
};

/**
 * Retire a single slot. One slot at a time - there is no rectangle shrink.
 *
 * The outcome depends on whether the slot has a history, because the FKs do not all
 * fail the same way. Machine.currentSlotId, Machine.plannedSlotId, Movement.fromSlotId
 * and Movement.toSlotId are all nullable with no onDelete, so Prisma defaults them to
 * SetNull: a hard delete would silently un-park a machine, orphan a live reservation, or
 * strip the slot reference out of movement history. Only SecurityVerification.slotId is
 * mandatory, so MySQL itself refuses that one case. Anything with history is therefore
 * marked BLOCKED instead of deleted, which keeps every audit link intact while still
 * removing the slot from allocation (allocation only ever selects AVAILABLE).
 */
export const removeSlot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const slotId = Array.isArray(id) ? id[0] : id;
    const { reason } = req.body;
    const userRole = (req as Request & { userRole?: string }).userRole;

    if (typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A reason of at least 5 characters is required to remove a slot' });
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: {
        machine: { select: { serialNumber: true } },
        plannedFor: { select: { serialNumber: true } },
        _count: { select: { movementsFrom: true, movementsTo: true, securityVerifications: true } }
      }
    });

    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    if (slot.machine) {
      return res.status(409).json({
        code: 'SLOT_OCCUPIED',
        error: `Slot ${slot.row}-${slot.col} is occupied by ${slot.machine.serialNumber}. Dispatch or move it first.`
      });
    }

    if (slot.plannedFor) {
      return res.status(409).json({
        code: 'SLOT_RESERVED',
        error: `Slot ${slot.row}-${slot.col} is reserved for ${slot.plannedFor.serialNumber}. Release the reservation first.`
      });
    }

    const historyCount =
      slot._count.movementsFrom + slot._count.movementsTo + slot._count.securityVerifications;

    // Pristine slot: nothing references it, so it can genuinely go.
    if (historyCount === 0) {
      if (userRole !== 'ADMIN') {
        return res.status(403).json({
          code: 'REQUIRES_ADMIN',
          error: 'Deleting a slot that has no history requires an ADMIN. Mark it out of service instead.'
        });
      }
      await prisma.slot.delete({ where: { id: slotId } });
      return res.json({
        outcome: 'DELETED' as const,
        row: slot.row,
        col: slot.col,
        reason: reason.trim()
      });
    }

    // Has history: keep the row so the audit trail survives, take it out of service.
    await prisma.slot.update({ where: { id: slotId }, data: { status: 'BLOCKED' } });

    return res.json({
      outcome: 'BLOCKED' as const,
      row: slot.row,
      col: slot.col,
      preservedRecords: historyCount,
      alreadyBlocked: slot.status === 'BLOCKED',
      reason: reason.trim()
    });
  } catch (error) {
    // Belt and braces: if a future FK is added without a guard, MySQL refuses rather
    // than silently nulling the reference.
    if (prismaCode(error) === 'P2003' || prismaCode(error) === 'P2014') {
      return res.status(409).json({
        code: 'SLOT_IN_USE',
        error: 'This slot is referenced by records that must be kept, so it was marked out of service instead of deleted.'
      });
    }
    console.error('Error removing slot:', error);
    res.status(500).json({ error: 'Failed to remove slot' });
  }
};

export const releaseSlotReservation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const slotId = Array.isArray(id) ? id[0] : id;
    const { reason } = req.body;
    const userId = (req as Request & { user?: { id: string } }).user?.id || 'system';

    if (typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A reason of at least 5 characters is required to release a slot' });
    }

    const result = await releaseReservation(slotId, reason.trim(), userId);

    if (!result.success) {
      return res.status(409).json({ error: result.error, code: result.releaseBlockedReason });
    }

    res.json(result);
  } catch (error) {
    console.error('Error releasing slot reservation:', error);
    res.status(500).json({ error: 'Failed to release slot' });
  }
};

const BLOCK_REASONS = ['Ground damage', 'Waterlogging', 'Maintenance work', 'Used for other purpose', 'Other'];

/**
 * Take a free slot out of use for now. Body: { reason (one of BLOCK_REASONS), note }.
 * Allocation only ever picks AVAILABLE slots, so nothing is placed here until it is
 * unblocked. An occupied or reserved slot cannot be blocked.
 */
export const blockSlot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const slotId = Array.isArray(id) ? id[0] : id;
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!BLOCK_REASONS.includes(reason)) return res.status(400).json({ error: 'Choose why the slot is blocked' });
    if (reason === 'Other' && note.length < 3) return res.status(400).json({ error: 'Describe the reason (at least 3 characters)' });

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: { yard: { select: { name: true } }, machine: { select: { serialNumber: true } }, plannedFor: { select: { serialNumber: true } } }
    });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.machine) return res.status(409).json({ error: `Slot ${slot.row}-${slot.col} has ${slot.machine.serialNumber} in it. Move the machine first.` });
    if (slot.plannedFor) return res.status(409).json({ error: `Slot ${slot.row}-${slot.col} is reserved for ${slot.plannedFor.serialNumber}. Release the reservation first.` });
    if (slot.status !== 'AVAILABLE') return res.status(400).json({ error: `Slot ${slot.row}-${slot.col} is ${slot.status.toLowerCase()}; only a free slot can be blocked` });

    const text = (note ? `${reason}: ${note}` : reason).slice(0, 300);
    const saved = await prisma.slot.update({
      where: { id: slot.id },
      data: { status: 'BLOCKED', blockReason: text, blockedAt: new Date(), blockedById: userId },
      include: { blockedBy: { select: { name: true } } }
    });
    await notifyEvent({
      type: 'SLOT_BLOCKED',
      severity: 'INFO',
      title: `Slot ${slot.row}-${slot.col} blocked - ${slot.yard.name}`,
      message: `${saved.blockedBy?.name ?? 'A manager'} blocked slot ${slot.row}-${slot.col} in ${slot.yard.name}: ${text}`,
      link: 'yards'
    });
    res.json(saved);
  } catch (error) {
    console.error('blockSlot error:', error);
    res.status(500).json({ error: 'Failed to block the slot' });
  }
};

/** Put a blocked slot back into use. */
export const unblockSlot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const slotId = Array.isArray(id) ? id[0] : id;
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const slot = await prisma.slot.findUnique({ where: { id: slotId }, include: { yard: { select: { name: true } } } });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.status !== 'BLOCKED') return res.status(400).json({ error: `Slot ${slot.row}-${slot.col} is not blocked` });

    const saved = await prisma.slot.update({
      where: { id: slot.id },
      data: { status: 'AVAILABLE', blockReason: null, blockedAt: null, blockedById: null }
    });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notifyEvent({
      type: 'SLOT_UNBLOCKED',
      severity: 'INFO',
      title: `Slot ${slot.row}-${slot.col} unblocked - ${slot.yard.name}`,
      message: `${user?.name ?? 'A manager'} put slot ${slot.row}-${slot.col} in ${slot.yard.name} back into use${slot.blockReason ? ` (was blocked: ${slot.blockReason})` : ''}.`,
      link: 'yards'
    });
    res.json({ ...saved, blockedBy: null });
  } catch (error) {
    console.error('unblockSlot error:', error);
    res.status(500).json({ error: 'Failed to unblock the slot' });
  }
};
