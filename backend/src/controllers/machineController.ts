import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { hasPermission } from '../services/roleAccessService';
import { notifyEvent, pushSecurityQueueChanged, pushExitRequestsChanged } from '../services/notificationService';
import { EXIT_REASONS, releaseMachine } from './exitRequestController';
import { getSettings } from '../services/settingsService';
import { autoVerifyIfCheckOff } from '../services/parkingRules';
import { placeRows, checkRows, MAX_ROWS, StockRowInput } from '../services/stockLoadService';

export { AUTO_VERIFY_NOTE } from '../services/parkingRules';

export const getAllMachines = async (req: Request, res: Response) => {
  try {
    const { search, status, parkStatus, includeDemo, mine } = req.query;
    
    const where: any = {};

    // Demo rows are hidden unless explicitly requested, so the assembly views
    // show real plant data by default.
    if (includeDemo !== 'true') {
      where.isDemo = false;
    }
    
    if (search && String(search).trim()) {
      // Match the identifiers an operator would read off a machine tag or scan:
      // serial number, production order number, and barcode. Model is kept so
      // the existing model search keeps working. Order numbers have leading
      // zeros, so these must stay string comparisons.
      const term = String(search).trim();
      where.OR = [
        { serialNumber: { contains: term } },
        { orderNo: { contains: term } },
        { barcode: { contains: term } },
        { model: { contains: term } }
      ];
    }
    
    if (status) {
      where.status = status as string;
    }

    // parkStatus is the parking lifecycle, separate from the commercial status
    // above. The security queue and the driver screen filter on this so they
    // never have to download every machine to find the handful they care about.
    if (parkStatus) {
      const values = String(parkStatus)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 1) {
        where.parkStatus = values[0] as any;
      } else if (values.length > 1) {
        where.parkStatus = { in: values } as any;
      }
    }

    // mine=true resolves the caller's own Driver record from the token, so the
    // driver's list cannot be widened by editing the query string. Only the
    // DRIVER role is scoped this way: the yard office (ADMIN / YARD_MANAGER /
    // OPERATOR) uses the same screen to list every in-flight machine and record
    // parking on a driver's behalf. A driver with no linked record gets nothing
    // rather than the whole plant.
    if (mine === 'true') {
      const actorId = (req as Request & { user?: { id: string } }).user?.id;
      if (!actorId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const actor = await prisma.user.findUnique({
        where: { id: actorId },
        select: { role: true }
      });
      if (!actor) return res.status(401).json({ error: 'Authentication required' });
      if (actor.role === 'DRIVER') {
        const driver = await prisma.driver.findUnique({
          where: { userId: actorId },
          select: { id: true }
        });
        if (!driver) return res.json([]);
        where.driverId = driver.id;
      }
    }
    
    const machines = await prisma.machine.findMany({
      where,
      include: {
        currentSlot: {
          include: {
            yard: true
          }
        },
        // The slot promised to a machine that has not arrived yet. currentSlot is
        // still null while it is READY_TO_MOVE, so screens that need to tell the
        // operator where a machine is headed (the gate) must read this one.
        plannedSlot: {
          include: {
            yard: true
          }
        },
        // Name only, so the dashboard can say who has a machine on the road.
        driver: {
          select: { id: true, name: true }
        },
        movements: {
          include: {
            machine: true,
            // The slot's own yard, not just the movement's, so a relocation
            // between yards still labels its origin correctly.
            fromSlot: { include: { yard: { select: { name: true } } } },
            toSlot: { include: { yard: { select: { name: true } } } },
            yard: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                // Lets a movement show whether the driver self-confirmed or the
                // yard office recorded it on the driver's behalf.
                role: true
              }
            }
          },
          orderBy: { timestamp: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Opt-in for the Assembly Line page, which lists a machine under stage 18 only
    // while that stage is still being worked on and moves it to Completed once it
    // is done. Other callers skip the extra query.
    if (req.query.withAssemblyCompletion === 'true') {
      const atFinalStage = machines.filter((m) => m.assemblyStage >= 18);
      const finalRows = await prisma.machineStageHistory.findMany({
        where: { machineId: { in: atFinalStage.map((m) => m.id) }, stage: 18 },
        select: { machineId: true, isCompleted: true }
      });
      // Stage 18 can have several operations, so it is done only when every
      // recorded operation is. A machine that has left PLANNED is past assembly
      // whatever the history says.
      const rowsByMachine = new Map<string, boolean[]>();
      for (const row of finalRows) {
        const list = rowsByMachine.get(row.machineId) ?? [];
        list.push(row.isCompleted);
        rowsByMachine.set(row.machineId, list);
      }
      // The plant's state for the latest operation of each machine still in assembly,
      // so the list can show "S18 In inspection" rather than only a stage number.
      const inAssembly = machines.filter((m) => m.parkStatus === 'PLANNED' || m.parkStatus === 'READY_TO_MOVE');
      const plantRows = await prisma.machineStageHistory.findMany({
        where: { machineId: { in: inAssembly.map((m) => m.id) }, source: 'PLANT_SYNC' },
        select: { machineId: true, stage: true, endState: true }
      });
      const latestByMachine = new Map<string, { stage: number; state: string | null }>();
      for (const row of plantRows) {
        const seen = latestByMachine.get(row.machineId);
        if (!seen || row.stage > seen.stage) latestByMachine.set(row.machineId, { stage: row.stage, state: row.endState });
      }
      return res.json(machines.map((m) => {
        const rows = rowsByMachine.get(m.id) ?? [];
        const assemblyCompleted = m.assemblyStage >= 18 && (
          m.parkStatus !== 'PLANNED' || (rows.length > 0 && rows.every(Boolean))
        );
        return { ...m, assemblyCompleted, plantStatus: latestByMachine.get(m.id) ?? null };
      }));
    }

    res.json(machines);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch machines' });
  }
};

export const getMachineById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        currentSlot: {
          include: {
            yard: true
          }
        },
        // Included so the details view can name the slot a machine is reserved
        // for while currentSlot is still null, instead of calling it unallocated.
        plannedSlot: {
          include: {
            yard: true
          }
        },
        movements: {
          include: {
            machine: true,
            // The slot's own yard, not just the movement's, so a relocation
            // between yards still labels its origin correctly.
            fromSlot: { include: { yard: { select: { name: true } } } },
            toSlot: { include: { yard: { select: { name: true } } } },
            yard: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                // Lets a movement show whether the driver self-confirmed or the
                // yard office recorded it on the driver's behalf.
                role: true
              }
            }
          },
          orderBy: { timestamp: 'desc' }
        }
      }
    });
    
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    
    res.json(machine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch machine' });
  }
};

export const createMachine = async (req: Request, res: Response) => {
  try {
    const { serialNumber, model, productionDate, status } = req.body;
    
    const machine = await prisma.machine.create({
      data: {
        serialNumber,
        model,
        productionDate: new Date(productionDate),
        status: status || 'AVAILABLE'
      }
    });
    
    res.status(201).json(machine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create machine' });
  }
};

export const updateMachine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { serialNumber, model, productionDate, status } = req.body;
    
    const machine = await prisma.machine.update({
      where: { id: machineId },
      data: {
        serialNumber,
        model,
        productionDate: productionDate ? new Date(productionDate) : undefined,
        status
      }
    });
    
    res.json(machine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update machine' });
  }
};

export const deleteMachine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    
    await prisma.machine.delete({
      where: { id: machineId }
    });
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete machine' });
  }
};

export const allocateMachine = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { slotId, reason, notes } = req.body;
    const actorRole = (req as Request & { user?: { role?: string } }).user?.role;
    // The actor comes from the verified token, never from the request body, so a
    // movement cannot be attributed to another user.
    const actorId = (req as Request & { user?: { id: string } }).user?.id;
    if (!actorId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: { machine: true }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    if (slot.machine) {
      return res.status(400).json({ error: 'Slot is already occupied' });
    }
    
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      include: { currentSlot: true }
    });
    
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    
    // A machine not yet in a slot enters the yard only through Gate Control (barcode
    // scan and the dress code check). Placing one by hand is allowed only for the stock
    // already parked before go-live, while an Admin has Initial stock load switched on.
    // Moving a machine between slots inside the yard is not affected.
    let entryNote: string | null = null;
    if (!machine.currentSlotId) {
      const { initialStockLoad } = await getSettings();
      if (!initialStockLoad) {
        return res.status(403).json({ error: 'Machines enter the yard only through Gate Control (Inward). An Admin can switch on Initial stock load in Settings to place machines already parked before go-live.' });
      }
      if (!(await hasPermission(actorRole, 'machines.allocate'))) {
        return res.status(403).json({ error: 'You do not have access to place a machine during the initial stock load' });
      }
      if (['IN_TRANSIT', 'AT_GATE'].includes(machine.parkStatus)) {
        return res.status(400).json({ error: 'This machine is in the gate process; finish it through Gate Control and Confirm Parking' });
      }
      if (machine.parkStatus === 'EXITED') {
        return res.status(400).json({ error: 'This machine has left the yard; it must come back in through Gate Control (Inward)' });
      }
      if (machine.assemblyStage < 18 || !machine.barcode?.trim()) {
        return res.status(400).json({ error: 'Only a machine with Stage 18 cleared and a barcode label can be placed in the yard' });
      }
      const remark = typeof notes === 'string' ? notes.trim() : '';
      if (remark.length < 3) {
        return res.status(400).json({ error: 'Write a remark (at least 3 characters), e.g. where the machine was found' });
      }
      entryNote = `Initial stock load: ${remark.slice(0, 480)}`;
    } else if (!(await hasPermission(actorRole, 'yards.move'))) {
      return res.status(403).json({ error: 'You do not have access to move machines between slots' });
    }

    if (slot.status !== 'AVAILABLE' && machine.currentSlotId !== slotId) {
      return res.status(400).json({ error: `Slot ${slot.row}-${slot.col} is not free (${slot.status.toLowerCase().replace(/_/g, ' ')}). Choose a free slot.` });
    }

    // Check if machine is already in the target slot. A machine that security
    // rejected is allowed to be re-parked where it already is, otherwise it can
    // never be re-verified without being moved to a different slot first.
    if (machine.currentSlotId === slotId && machine.parkStatus !== 'PARKED_REJECTED') {
      return res.status(400).json({ error: 'Machine is already in this slot' });
    }
    
    // Create movement record only if moving to a different slot
    await prisma.movement.create({
      data: {
        machineId,
        yardId: slot.yardId,
        fromSlotId: machine.currentSlotId,
        toSlotId: slotId,
        userId: actorId,
        reason: entryNote ? 'YARD_ENTRY' : reason || 'RELOCATION',
        notes: entryNote ?? notes
      }
    });
    
    // Update machine's current slot and send it to the security review queue.
    // PARKED_PENDING is what SecurityVerification filters on, so without this write
    // the security queue is always empty.
    const updatedMachine = await prisma.machine.update({
      where: { id: machineId },
      data: { currentSlotId: slotId, parkStatus: 'PARKED_PENDING' },
      include: {
        currentSlot: {
          include: {
            yard: true
          }
        }
      }
    });

    if (await autoVerifyIfCheckOff(machineId, slotId, actorId)) {
      updatedMachine.parkStatus = 'PARKED_VERIFIED';
    } else {
      await notifyEvent({
        type: 'SECURITY_REVIEW',
        severity: 'WARNING',
        title: 'Security review needed',
        message: `${machine.serialNumber} (${machine.model}) was parked in ${slot.row}-${slot.col} and is awaiting verification.`,
        link: 'security'
      });
    }

    // Update slot status
    await prisma.slot.update({
      where: { id: slotId },
      data: { status: 'OCCUPIED' }
    });
    
    if (machine.currentSlotId) {
      await prisma.slot.update({
        where: { id: machine.currentSlotId },
        data: { status: 'AVAILABLE' }
      });
    }
    
    res.json(updatedMachine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to allocate machine' });
  }
};

/**
 * Step 5 of the lifecycle: the driver confirms the machine is physically parked in
 * its assigned slot. This is the transition the gate deliberately stops short of,
 * and the only thing that puts a machine into the security verification queue.
 *
 * Guards are strict on purpose. Confirming a machine that is not IN_TRANSIT, or
 * confirming the same machine twice, would either fabricate a parked machine or
 * let one driver vouch for another driver's load.
 */
export const confirmMachineParked = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { slotId, notes } = req.body;

    const actorId = (req as Request & { user?: { id: string } }).user?.id;
    if (!actorId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      include: { currentSlot: true, driver: true }
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    // Only the driver who was actually assigned the machine may confirm it is
    // parked. Without this, any stranger could vouch for another driver's load and
    // the security walk-down would verify a claim that was never made by the
    // person who drove the machine. The yard office (ADMIN / YARD_MANAGER /
    // OPERATOR / SECURITY - the same roles allowed to run the gate) is the override, for the
    // case where a driver forgot to tap and the yard has to record it; that
    // override is visible in the movement notes.
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true }
    });
    const actorDriver = await prisma.driver.findUnique({
      where: { userId: actorId },
      select: { id: true, name: true }
    });

    // Staff given "Confirm for a driver" on the Role Access page (default: yard office
    // and Security) may record it on the driver's behalf.
    const isOperatorOverride = actor?.role !== 'DRIVER' && (await hasPermission(actor?.role, 'parked.confirmOthers'));
    if (!isOperatorOverride) {
      if (!actorDriver) {
        return res.status(403).json({
          error: 'Your login is not linked to a driver record, so you cannot confirm parking'
        });
      }
      if (!machine.driverId) {
        return res.status(409).json({
          error: 'No driver is assigned to this machine. Ask the yard office to assign one first.'
        });
      }
      if (machine.driverId !== actorDriver.id) {
        return res.status(403).json({
          error: `This machine is assigned to ${machine.driver?.name ?? 'another driver'}, not to you`
        });
      }
    }

    // IN_TRANSIT is the first time a machine may be confirmed parked.
    // PARKED_REJECTED is the re-park after security bounced it.
    if (!['IN_TRANSIT', 'PARKED_REJECTED'].includes(machine.parkStatus)) {
      return res.status(400).json({
        error: `Machine cannot be confirmed parked from status ${machine.parkStatus}. It must be IN_TRANSIT, or PARKED_REJECTED to re-park.`
      });
    }

    const targetSlotId = slotId || machine.plannedSlotId || machine.currentSlotId;
    if (!targetSlotId) {
      return res.status(400).json({ error: 'Machine has no assigned slot to park in' });
    }

    const slot = await prisma.slot.findUnique({
      where: { id: targetSlotId },
      include: { machine: true, yard: true }
    });

    if (!slot) {
      return res.status(404).json({ error: 'Assigned slot not found' });
    }

    // Someone else may have taken the slot while this machine was in transit.
    if (slot.machine && slot.machine.id !== machine.id) {
      return res.status(409).json({
        error: `ASSIGNED SLOT UNAVAILABLE — ${slot.row}-${slot.col} is now occupied by ${slot.machine.serialNumber}`
      });
    }

    const isRepark = machine.parkStatus === 'PARKED_REJECTED';

    // An override by the yard office is recorded explicitly, so a later audit can
    // tell a self-confirmed park from one recorded by the office.
    const overrideNote = isOperatorOverride
      ? ` [recorded by yard office on behalf of ${machine.driver?.name ?? 'unassigned driver'}]`
      : '';

    // A re-park is the machine moving back into the slot it already occupies, so
    // there is nothing to record as a movement. The first park is a real move.
    if (!isRepark && machine.currentSlotId !== slot.id) {
      await prisma.movement.create({
        data: {
          machineId,
          yardId: slot.yardId,
          fromSlotId: machine.currentSlotId,
          toSlotId: slot.id,
          userId: actorId,
          reason: 'YARD_ENTRY',
          notes: notes ? `${notes}${overrideNote}` : (overrideNote.trim() || null)
        }
      });
    } else if (isRepark) {
      await prisma.movement.create({
        data: {
          machineId,
          yardId: slot.yardId,
          fromSlotId: slot.id,
          toSlotId: slot.id,
          userId: actorId,
          reason: 'YARD_ENTRY',
          notes: `${notes || 'Re-parked after rejection'}${overrideNote}`
        }
      });
    }

    const updatedMachine = await prisma.machine.update({
      where: { id: machineId },
      data: { currentSlotId: slot.id, parkStatus: 'PARKED_PENDING' }
    });

    await prisma.slot.update({
      where: { id: slot.id },
      data: { status: 'OCCUPIED' }
    });

    // Free the slot the machine came from, if it was not the one it just parked in.
    if (machine.currentSlotId && machine.currentSlotId !== slot.id) {
      await prisma.slot.update({
        where: { id: machine.currentSlotId },
        data: { status: 'AVAILABLE' }
      });
    }

    const autoVerified = await autoVerifyIfCheckOff(machineId, slot.id, actorId);
    if (!autoVerified) {
      await notifyEvent({
        type: 'SECURITY_REVIEW',
        severity: 'WARNING',
        title: isRepark ? 'Security re-review needed' : 'Security review needed',
        message: `${machine.serialNumber} (${machine.model}) was ${isRepark ? 're-parked' : 'parked'} in ${slot.row}-${slot.col} and is awaiting verification.`,
        link: 'security'
      });

      await pushSecurityQueueChanged(isRepark ? 'reparked' : 'parked', {
        machineId: machine.id,
        serialNumber: machine.serialNumber,
        slotLabel: `${slot.row}-${slot.col}`
      });
    }

    res.json({
      ...updatedMachine,
      ...(autoVerified ? { parkStatus: 'PARKED_VERIFIED' } : {}),
      slotLabel: `${slot.row}-${slot.col}`,
      isRepark,
      autoVerified,
      adminOverride: isOperatorOverride
    });
  } catch (error) {
    console.error('Failed to confirm machine parked:', error);
    res.status(500).json({ error: 'Failed to confirm machine parked' });
  }
};

export const removeMachineFromSlot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { reason, notes } = req.body;
    const actorId = (req as Request & { user?: { id: string } }).user?.id;
    if (!actorId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Dispatch is not a manual exit: it goes through Dispatch Planning (FIFO, PDI check).
    const exitReason = typeof reason === 'string' ? reason : '';
    if (!(EXIT_REASONS as readonly string[]).includes(exitReason) || exitReason === 'DISPATCH') {
      return res.status(400).json({ error: 'Dispatch goes through Dispatch Planning (FIFO and PDI check). Use exit only for testing, repair, relocation or maintenance.' });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, serialNumber: true, currentSlotId: true, parkStatus: true }
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    if (!machine.currentSlotId) {
      return res.status(400).json({ error: 'Machine is not in any slot' });
    }

    const planned = await prisma.dispatchItem.findFirst({
      where: { machineId, status: { in: ['PLANNED', 'DRIVER_ASSIGNED'] } },
      select: { plan: { select: { planNo: true } } }
    });
    if (planned) {
      return res.status(400).json({ error: `This machine is planned for dispatch (${planned.plan.planNo}). Cancel it from Dispatch Planning first.` });
    }

    // Manager quick-release: stamp an auto-approved exit ticket (so the audit trail
    // and Security's Authorized Exits list both stay complete), then release the slot,
    // park the machine AT_GATE and record the dispatch movement - the same outcome an
    // approve button produces for a staff request.
    await prisma.machineExitRequest.create({
      data: {
        machineId,
        requestedById: actorId,
        reason: exitReason,
        notes: typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : null,
        status: 'APPROVED',
        approvedById: actorId,
        approvedAt: new Date()
      }
    });

    const released = await releaseMachine(machineId, exitReason, actorId, null);
    if (!released) {
      return res.status(400).json({ error: 'Machine is not in any slot' });
    }

    await pushExitRequestsChanged('approved', {
      machineId,
      serialNumber: released.serialNumber,
      reason: exitReason
    });

    const updatedMachine = await prisma.machine.findUnique({
      where: { id: machineId }
    });

    res.json(updatedMachine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove machine from slot' });
  }
};

const DEFAULT_TOTAL_STAGES = 18;

/**
 * Full assembly stage history for one machine.
 *
 * The plant only reports the operations it has seen, so this merges the stored
 * rows with a placeholder for every stage. That way the caller always receives
 * a complete timeline and can distinguish "completed", "in progress" and "not
 * started" without doing the arithmetic client-side.
 */
export const getMachineStageHistory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: {
        id: true,
        serialNumber: true,
        model: true,
        modelType: true,
        barcode: true,
        orderNo: true,
        productionOrderId: true,
        itemCode: true,
        itemDescription: true,
        assemblyStage: true,
        parkStatus: true,
        status: true,
        productionDate: true,
        lastSyncAt: true,
        isDemo: true,
        currentSlot: { select: { row: true, col: true, yard: { select: { name: true } } } }
      }
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    const rows = await prisma.machineStageHistory.findMany({
      where: { machineId: machineId },
      orderBy: [{ stage: 'asc' }, { syncedAt: 'desc' }]
    });

    // The unique key allows one PLANT_SYNC and one MANUAL row for the same
    // operation. Prefer what the plant reported, and only fall back to a
    // manual entry for stages the plant has never mentioned.
    const plantByStage = new Map<number, (typeof rows)[number]>();
    const manualByStage = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const target = row.source === 'PLANT_SYNC' ? plantByStage : manualByStage;
      if (!target.has(row.stage)) {
        target.set(row.stage, row);
      }
    }

    // The plant currently numbers operations 1-18, but grow the timeline if it
    // ever reports a higher stage so a new operation is never silently hidden.
    const totalStages = Math.max(
      DEFAULT_TOTAL_STAGES,
      machine.assemblyStage,
      ...rows.map((row) => row.stage)
    );

    const stages = Array.from({ length: totalStages }, (_, index) => {
      const stage = index + 1;
      const row = plantByStage.get(stage) ?? manualByStage.get(stage);

      let status: 'COMPLETED' | 'IN_INSPECTION' | 'IN_PROGRESS' | 'NOT_STARTED';
      if (!row) {
        status = 'NOT_STARTED';
      } else if (row.isCompleted) {
        status = 'COMPLETED';
      } else if (row.endState === 'IN-INSPECTION') {
        status = 'IN_INSPECTION';
      } else {
        status = 'IN_PROGRESS';
      }

      return {
        stage: stage,
        status: status,
        workCenter: row?.workCenter ?? null,
        startedAt: row?.startedAt ?? null,
        endedAt: row?.endedAt ?? null,
        completedQty: row?.completedQty ?? null,
        endState: row?.endState ?? null,
        source: row?.source ?? null,
        syncedAt: row?.syncedAt ?? null,
        durationMinutes:
          row?.startedAt && row?.endedAt
            ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60000))
            : null
      };
    });

    const completedCount = stages.filter((s) => s.status === 'COMPLETED').length;
    const inProgress = stages.find((s) => s.status === 'IN_PROGRESS') ?? null;
    const recordedCount = stages.filter((s) => s.status !== 'NOT_STARTED').length;

    res.json({
      machine: machine,
      summary: {
        totalStages: totalStages,
        completedCount: completedCount,
        recordedCount: recordedCount,
        currentStage: machine.assemblyStage,
        inProgressStage: inProgress ? inProgress.stage : null,
        inInspectionStages: stages.filter((s) => s.status === 'IN_INSPECTION').map((s) => s.stage),
        hasHistory: recordedCount > 0,
        lastRecordedAt: rows.reduce<Date | null>(
          (latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest),
          null
        )
      },
      stages: stages
    });
  } catch (error) {
    console.error('getMachineStageHistory error:', error);
    res.status(500).json({ error: 'Failed to fetch machine stage history' });
  }
};

/**
 * Machines that left the yard and are expected back.
 *
 * Only machines with parkStatus EXITED are candidates. Whether one is "expected
 * back" is decided by its most recent exit ticket: a DISPATCH never returns, every
 * other reason (inspection/testing, repair, maintenance, relocation) does. Machines
 * whose exit predates the ticket flow are treated as returns too, so nothing that
 * ever left is silently stranded.
 */
export const getReturnMachines = async (req: Request, res: Response) => {
  try {
    const machines = await prisma.machine.findMany({
      where: { parkStatus: 'EXITED' },
      include: {
        plannedSlot: { include: { yard: true } },
        exitRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            requestedBy: { select: { id: true, name: true, email: true, role: true } },
            approvedBy: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const returns = machines
      .map((machine) => {
        const ticket = machine.exitRequests[0] ?? null;
        return {
          ...machine,
          exitRequest: ticket,
          isReturnExpected: ticket ? ticket.reason !== 'DISPATCH' : true
        };
      })
      .filter((machine) => machine.isReturnExpected);

    res.json(returns);
  } catch (error) {
    console.error('getReturnMachines error:', error);
    res.status(500).json({ error: 'Failed to fetch machines expected to return' });
  }
};

/**
 * Reserve a slot ahead of time for a machine that is coming back into the yard.
 *
 * This is now optional: the gate assigns a slot to any returning machine that does
 * not already hold one (see authenticateGate), so reserving here just plans where the
 * machine will park. It mirrors the gate assignment: machine points at the slot, the
 * slot is RESERVED, and a movement records who made the arrangement.
 */
export const reserveReturnSlot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { slotId } = req.body;
    const actorId = (req as Request & { user?: { id: string } }).user?.id;
    if (!actorId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (typeof slotId !== 'string' || slotId.trim() === '') {
      return res.status(400).json({ error: 'Slot is required' });
    }

    const machine = await prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    if (machine.parkStatus !== 'EXITED') {
      return res.status(400).json({ error: `Only EXITED machines can be scheduled to return (this one is ${machine.parkStatus})` });
    }

    // A machine normally keeps a stale plannedSlotId pointing at the slot it left
    // (now AVAILABLE again). Only an *active* reservation blocks a re-reservation;
    // a leftover plan is simply overwritten by the new one.
    if (machine.plannedSlotId) {
      const existingPlan = await prisma.slot.findUnique({
        where: { id: machine.plannedSlotId },
        select: { status: true }
      });
      if (existingPlan?.status === 'RESERVED') {
        return res.status(400).json({ error: 'A return slot is already reserved for this machine' });
      }
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: { machine: true, plannedFor: true }
    });
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (slot.status !== 'AVAILABLE' || slot.machine || slot.plannedFor) {
      return res.status(400).json({ error: `Slot ${slot.row}-${slot.col} is not available` });
    }

    await prisma.$transaction([
      prisma.machine.update({
        where: { id: machineId },
        // The machine stays EXITED until it actually passes the gate: reserving a
        // slot is a plan, not a re-entry. Gate IN flips the status to IN_TRANSIT,
        // which drops it off the returns board where it belongs.
        data: { plannedSlotId: slotId, slotWaitingSince: null }
      }),
      prisma.slot.update({
        where: { id: slotId },
        data: { status: 'RESERVED', reservedAt: new Date() }
      }),
      prisma.movement.create({
        data: {
          machineId,
          yardId: slot.yardId,
          toSlotId: slotId,
          userId: actorId,
          reason: 'RELOCATION',
          notes: 'Return slot reserved for re-entry'
        }
      })
    ]);

    const updated = await prisma.machine.findUnique({
      where: { id: machineId },
      include: { plannedSlot: { include: { yard: true } } }
    });

    await notifyEvent({
      type: 'RETURN_SLOT_RESERVED',
      severity: 'INFO',
      title: 'Return slot reserved',
      message: `${machine.serialNumber} has a reserved slot - it can check back in at the gate.`,
      link: 'gate'
    });

    res.json(updated);
  } catch (error) {
    console.error('reserveReturnSlot error:', error);
    res.status(500).json({ error: 'Failed to reserve return slot' });
  }
};

/**
 * Bulk initial stock load from an Excel / CSV file the page has read.
 * Body: { rows: [{ serial, yard, slot, inwardDate?, remark? }], commit?: boolean }.
 * Without commit only the check runs; with commit the rows that pass are placed.
 */
export const bulkAllocate = async (req: Request, res: Response) => {
  try {
    const actorId = (req as Request & { user?: { id: string } }).user?.id;
    if (!actorId) return res.status(401).json({ error: 'Authentication required' });
    const { initialStockLoad } = await getSettings();
    if (!initialStockLoad) {
      return res.status(403).json({ error: 'Initial stock load is off. An Admin can switch it on in Settings.' });
    }
    const raw: unknown = req.body?.rows;
    if (!Array.isArray(raw) || raw.length === 0) return res.status(400).json({ error: 'The file has no rows' });
    if (raw.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows per file. Split the file.` });
    const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 120) : '');
    const rows: StockRowInput[] = raw.map((r: Record<string, unknown>) => ({
      serial: text(r?.serial), yard: text(r?.yard), slot: text(r?.slot), inwardDate: text(r?.inwardDate), remark: text(r?.remark)
    }));

    if (req.body?.commit !== true) {
      const results = await checkRows(rows);
      return res.json({ results, ok: results.filter((r) => r.ok).length });
    }

    const { results, placed, pending } = await placeRows(rows, actorId);
    if (pending > 0) {
      await notifyEvent({
        type: 'SECURITY_REVIEW',
        severity: 'WARNING',
        title: 'Security review needed',
        message: `${pending} machine${pending === 1 ? '' : 's'} placed by the initial stock load (bulk) ${pending === 1 ? 'is' : 'are'} awaiting verification.`,
        link: 'security'
      });
      await pushSecurityQueueChanged('parked', { machineId: '', serialNumber: `${pending} machines` });
    }
    res.json({ results, placed, pending });
  } catch (error) {
    console.error('bulkAllocate error:', error);
    res.status(500).json({ error: 'Failed to load the stock file' });
  }
};
