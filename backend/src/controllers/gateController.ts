import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { notifyEvent, pushExitRequestsChanged } from '../services/notificationService';
import { getSettings } from '../services/settingsService';
import {
  assignAvailableSlot,
  assignSlotToMachine,
  findSlotForMachine,
  listAvailableSlots
} from '../services/locationAssignmentService';

async function rejectGate(reason: string, context: { driverId?: string; barcode?: string }) {
  await notifyEvent({
    type: 'GATE_REJECTED',
    severity: 'CRITICAL',
    title: 'Gate authentication rejected',
    message: `${reason}${context.barcode ? ` (barcode ${context.barcode})` : ''}`,
    link: 'gate'
  });
  return { result: 'REJECTED' as const, reason };
}

export const authenticateGate = async (req: Request, res: Response) => {
  try {
    const { driverId, driverBarcode, barcode, machineId, direction: directionInput } = req.body;

    // The driver badge holds the employee code. Scanning it is the primary path; the
    // id is still accepted so an API caller can pass both and prove they agree.
    const badge = typeof driverBarcode === 'string' ? driverBarcode.trim() : '';
    const id = typeof driverId === 'string' ? driverId.trim() : '';

    if (!badge && !id) {
      return res.json(await rejectGate('Driver badge not scanned', { barcode }));
    }

    const driver = badge
      // MySQL stores these columns with a case-insensitive collation, so `equals`
      // already matches BIO-001, bio-001 and Bio-001. Prisma's `mode` is not
      // available on nullable string fields, hence the plain equality here.
      ? await prisma.driver.findFirst({
          where: { employeeCode: { equals: badge } }
        })
      : await prisma.driver.findUnique({ where: { id } });

    if (!driver) {
      return res.json(await rejectGate('Unknown driver badge', { barcode }));
    }

    // Same reasoning as the machine/barcode agreement check below: a badge must not
    // be accepted on the strength of some other driver already being selected.
    if (id && driver.id !== id) {
      return res.json(await rejectGate('Driver badge does not match the selected driver', { barcode }));
    }

    // Without this guard, Prisma drops both undefined OR branches and the query
    // degenerates into "find any machine".
    if (!machineId && !barcode) {
      return res.json(await rejectGate('Machine not scanned', { barcode }));
    }

    const machine = await prisma.machine.findFirst({
      where: { OR: [{ id: machineId }, { barcode }] }
    });
    if (!machine) return res.json(await rejectGate('Machine not found', { barcode }));

    // If the operator both picked a machine and scanned a barcode, they must
    // agree. Catching this here stops a scan of some other machine being
    // silently accepted on the strength of a dropdown selection.
    if (machineId && barcode && machine.barcode !== barcode) {
      return res.json(await rejectGate('Barcode does not match the selected machine', { barcode }));
    }

    const actorId = (req as Request & { user?: { id: string } }).user?.id || 'system';

    // If the same machine is re-authenticated while its previous barrier is still
    // open (e.g. wrong driver at first scan), close the dangling barrier first so
    // no log stays "OPEN" forever and the operator cannot accumulate open entries.
    await prisma.gateLog.updateMany({
      where: { machineId: machine.id, barrierOpenedAt: { not: null }, barrierClosedAt: null },
      data: { barrierClosedAt: new Date() }
    });

    const direction = directionInput === 'OUT' ? 'OUT' : 'IN';

    if (direction === 'OUT') {
      // Gate OUT - a machine leaving the yard. It must have been released for exit
      // (an approved exit request, or the manager's quick release) which set it to
      // AT_GATE. Any valid driver badge is accepted: the request governs the exit.
      if (machine.parkStatus !== 'AT_GATE') {
        return res.json(await rejectGate('Machine is not released for exit. Request and approval required.', { barcode }));
      }

      const log = await prisma.gateLog.create({
        data: {
          machineId: machine.id,
          driverId: driver.id,
          authMethod: 'BARCODE',
          barcode: barcode || machine.barcode || '',
          result: 'AUTHORIZED',
          direction: 'OUT',
          barrierOpenedAt: new Date(),
          userId: actorId
        }
      });

      // Machine physically left the yard: parking lifecycle ends and driver custody
      // is handed back. An approved exit request, if any, is now completed.
      await prisma.machine.update({
        where: { id: machine.id },
        data: { parkStatus: 'EXITED', driverId: null }
      });
      await prisma.machineExitRequest.updateMany({
        where: { machineId: machine.id, status: 'APPROVED' },
        data: { status: 'COMPLETED' }
      });
      await pushExitRequestsChanged('completed', {
        machineId: machine.id,
        serialNumber: machine.serialNumber
      });

      return res.json({
        result: 'AUTHORIZED',
        gateLogId: log.id,
        direction: 'OUT',
        barrier: 'OPEN',
        driver: {
          id: driver.id,
          name: driver.name,
          employeeCode: driver.employeeCode,
          photoUrl: driver.photoUrl
        },
        machine: {
          id: machine.id,
          serialNumber: machine.serialNumber,
          model: machine.model,
          assemblyStage: machine.assemblyStage,
          parkStatus: machine.parkStatus
        }
      });
    }

    // The gate is the ready-to-move checkpoint: only stage-18 machines with a
    // barcode may enter. This makes scan-only identification safe to rely on,
    // identical to what the dropdown pre-filters. Rejects go through rejectGate
    // so the operator gets a visible reason and a CRITICAL is raised.
    if (machine.assemblyStage < 18) {
      return res.json(await rejectGate('Machine is not ready to move (stage 18+ required)', { barcode }));
    }
    if (!machine.barcode || machine.barcode.trim() === '') {
      return res.json(await rejectGate('Machine has no barcode. Cannot be checked in at the gate.', { barcode }));
    }

    // The gate is where a slot is assigned. A machine either carries a live
    // reservation (an admin pre-assigned it, or it was re-queued after a release),
    // or it is assigned one right now from the available pool. The operator may pass
    // slotId to override the automatic pick. If nothing is free the machine is
    // turned away with a visible reason rather than being let in without a slot.
    const requestedSlotId = typeof req.body.slotId === 'string' ? req.body.slotId.trim() : '';

    let slot = null;
    if (machine.plannedSlotId) {
      const planned = await prisma.slot.findUnique({
        where: { id: machine.plannedSlotId },
        include: { yard: true }
      });
      if (planned && planned.status === 'RESERVED') {
        slot = planned;
      } else {
        // Stale plan left behind by a previous visit (its slot is AVAILABLE again).
        // Clear it so a fresh assignment can take its place.
        await prisma.machine.update({
          where: { id: machine.id },
          data: { plannedSlotId: null }
        });
      }
    }

    // How the slot was decided, returned so the gate screen can say so: an existing
    // reservation, the automatic pick, the operator's choice, or the automatic pick
    // because the operator's choice was taken in the meantime.
    let slotSource: 'RESERVED' | 'AUTO' | 'MANUAL' | 'AUTO_FALLBACK' = slot ? 'RESERVED' : 'AUTO';
    let slotNotice: string | undefined;

    if (!slot) {
      let assignment = requestedSlotId
        ? await assignSlotToMachine(machine.id, requestedSlotId, actorId, 'Assigned at gate IN (operator selected)')
        : await assignAvailableSlot(machine.id, { userId: actorId, notes: 'Assigned at gate IN' });
      if (requestedSlotId) slotSource = 'MANUAL';

      // The operator's slot was free when the picker loaded but another machine took
      // it first. Fall back to the automatic pick rather than turning the driver away.
      if (requestedSlotId && !assignment.success &&
          (assignment.errorCode === 'SLOT_NOT_AVAILABLE' || assignment.errorCode === 'SLOT_NOT_FOUND')) {
        assignment = await assignAvailableSlot(machine.id, { userId: actorId, notes: 'Assigned at gate IN (selected slot was taken)' });
        slotSource = 'AUTO_FALLBACK';
        slotNotice = 'The selected slot was no longer free, so the next available slot was assigned.';
      }

      if (!assignment.success || !assignment.slotId) {
        const reason = assignment.errorCode === 'NO_SLOT_ANYWHERE'
          ? 'No available slot in any yard'
          : (assignment.error || 'Could not assign a slot');
        return res.json(await rejectGate(reason, { barcode }));
      }

      slot = await prisma.slot.findUnique({
        where: { id: assignment.slotId },
        include: { yard: true }
      });
    }

    if (!slot) {
      return res.json(await rejectGate('Could not assign a slot', { barcode }));
    }

    const log = await prisma.gateLog.create({
      data: {
        machineId: machine.id,
        driverId: driver.id,
        // The driver was identified by their employee-code badge, not by a
        // fingerprint or a face. Recording FINGERPRINT here would assert a
        // biometric check that this system has never performed.
        authMethod: 'BARCODE',
        barcode: barcode || machine.barcode || '',
        result: 'AUTHORIZED',
        direction: 'IN',
        barrierOpenedAt: new Date(),
        userId: actorId
      }
    });

    // Taking custody at the gate is the moment this driver becomes responsible
    // for the machine, so driverId is bound here. Without it the machine has no
    // owner for the rest of the lifecycle: the driver's parking confirmation
    // would be rejected as an unassigned machine, and the movement history could
    // not say who actually drove the load.
    await prisma.machine.update({
      where: { id: machine.id },
      data: { parkStatus: 'IN_TRANSIT', driverId: driver.id }
    });

    res.json({
      result: 'AUTHORIZED',
      gateLogId: log.id,
      barrier: 'OPEN',
      driver: {
        id: driver.id,
        name: driver.name,
        employeeCode: driver.employeeCode,
        photoUrl: driver.photoUrl
      },
      machine: {
        id: machine.id,
        serialNumber: machine.serialNumber,
        model: machine.model,
        assemblyStage: machine.assemblyStage,
        parkStatus: machine.parkStatus,
        assignedSlot: slot
      },
      slotSource,
      ...(slotNotice ? { slotNotice } : {})
    });
  } catch (error) {
    res.status(500).json({ error: 'Gate authentication failed' });
  }
};

export const closeBarrier = async (req: Request, res: Response) => {
  try {
    const { gateLogId } = req.body;
    if (gateLogId) {
      await prisma.gateLog.update({
        where: { id: gateLogId },
        data: { barrierClosedAt: new Date() }
      });
    }
    res.json({ barrier: 'CLOSED' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close barrier' });
  }
};

export const getGateLogs = async (req: Request, res: Response) => {
  try {
    const logs = await prisma.gateLog.findMany({
      include: { machine: true, driver: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch gate logs' });
  }
};

/**
 * Barrier endpoints the gate tab should call when it authorizes a driver. The
 * boom barrier controller sits on the tab's WiFi and does not talk to this server,
 * so the server only relays the configured URLs; the browser fires them directly.
 */
export const getBarrierConfig = async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    res.json({
      openUrl: settings.barrierOpenUrl,
      closeUrl: settings.barrierCloseUrl,
      autoCloseSeconds: settings.barrierAutoCloseSeconds,
      manualOpenEnabled: settings.barrierManualOpenEnabled
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load barrier config' });
  }
};

/**
 * Slots the gate operator can choose from for an incoming machine, plus the slot the
 * server would auto-pick. Read-only: nothing is reserved until authenticate runs, so
 * an operator who changes their mind leaks no reservation.
 */
export const getGateSlots = async (req: Request, res: Response) => {
  try {
    const machineId = typeof req.query.machineId === 'string' ? req.query.machineId : '';
    const slots = await listAvailableSlots();
    const suggested = machineId ? await findSlotForMachine(machineId) : null;

    res.json({
      suggested: suggested
        ? { id: suggested.id, yardId: suggested.yardId, row: suggested.row, col: suggested.col }
        : null,
      slots: slots.map((s) => ({
        id: s.id,
        yardId: s.yardId,
        row: s.row,
        col: s.col,
        yardName: s.yard?.name ?? ''
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load gate slots' });
  }
};
