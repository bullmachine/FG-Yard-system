import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { assignLocationAtStage13, assignSlotToMachine } from '../services/locationAssignmentService';
import { triggerManualSync, getSchedulerStatus } from '../services/scheduler';
import { getSyncStatus, getStageStats } from '../services/syncService';
import { notifyEvent, notifyDriverParking, pushSecurityQueueChanged, alertIfMissingBarcode } from '../services/notificationService';

/**
 * Manually advance machine assembly stage (for testing)
 */
export const advanceStage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { stage } = req.body;

    if (!stage || stage < 1 || stage > 18) {
      return res.status(400).json({ error: 'Invalid stage. Must be between 1 and 18' });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId }
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    // Update assembly stage
    const updatedMachine = await prisma.machine.update({
      where: { id: machineId },
      data: { assemblyStage: stage }
    });

    // Record the manual jump so the stage history stays complete. Keyed as
    // MANUAL so it never overwrites what the plant reports, and never
    // collides with a plant row for the same operation.
    await prisma.machineStageHistory.upsert({
      where: {
        machineId_operationSeqNo_source: {
          machineId: machineId,
          operationSeqNo: (stage * 10).toString(),
          source: 'MANUAL'
        }
      },
      create: {
        machineId: machineId,
        stage: stage,
        operationSeqNo: (stage * 10).toString(),
        workCenter: `STAGE-${stage}`,
        startedAt: new Date(),
        endedAt: new Date(),
        completedQty: '1.00',
        isCompleted: true,
        source: 'MANUAL',
        syncedAt: new Date()
      },
      update: {
        stage: stage,
        workCenter: `STAGE-${stage}`,
        endedAt: new Date(),
        isCompleted: true,
        syncedAt: new Date()
      }
    });

    // A manual jump to ready-to-move age with no barcode must alert the same way the
    // sync path does, so the problem is visible even when the plant feed has
    // not run yet.
    if (stage >= 18 && (!updatedMachine.barcode || !updatedMachine.barcode.trim())) {
      await alertIfMissingBarcode({
        serialNumber: updatedMachine.serialNumber,
        model: updatedMachine.model,
        assemblyStage: stage,
        barcode: updatedMachine.barcode
      });
    }

    // If stage 13, auto-assign location
    if (stage >= 13 && !machine.plannedSlotId) {
      const assignmentResult = await assignLocationAtStage13(machineId);
      if (!assignmentResult.success) {
        return res.json({
          machine: updatedMachine,
          warning: assignmentResult.error
        });
      }
    }

    // If stage 18 and the machine has a barcode, set park status to
    // READY_TO_MOVE. Without a barcode the machine stays PLANNED: it must not be
    // offered as ready-to-move at the gate until the barcode arrives.
    const hasBarcode = !!updatedMachine.barcode && updatedMachine.barcode.trim() !== '';
    if (stage >= 18 && machine.parkStatus === 'PLANNED' && hasBarcode) {
      await prisma.machine.update({
        where: { id: machineId },
        data: { parkStatus: 'READY_TO_MOVE' }
      });
    }

    res.json(updatedMachine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to advance stage' });
  }
};

/**
 * Manual location assignment
 */
export const assignLocation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { slotId } = req.body;

    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }

    const result = await assignSlotToMachine(machineId, slotId, req.body.userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        plannedSlot: {
          include: { yard: true }
        }
      }
    });

    res.json(machine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign location' });
  }
};

/**
 * Assign driver to machine (Stage 18)
 */
export const assignDriver = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: 'driverId is required' });
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId }
    });

    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    if (machine.assemblyStage < 18) {
      return res.status(400).json({ error: 'Machine must be at stage 18 to assign driver' });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId }
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

  // Assigning a driver makes the machine ready to move, but only while it is
  // still at the pre-gate stage. Rewriting the parking state of a machine that
  // is already IN_TRANSIT (or parked) would silently rewind it and strand it:
  // the driver would have no legal way to confirm parking, because the confirm
  // endpoint only accepts IN_TRANSIT or PARKED_REJECTED. A barcode is also
  // required: without one the machine must stay PLANNED until the feed delivers
  // a barcode, so it is never offered as ready-to-move at the gate.
  const shouldSetReadyToMove =
    ['PLANNED', 'READY_TO_MOVE'].includes(machine.parkStatus) &&
    !!machine.barcode &&
    machine.barcode.trim() !== '';

  const updatedMachine = await prisma.machine.update({
    where: { id: machineId },
    data: {
      driverId,
      ...(shouldSetReadyToMove ? { parkStatus: 'READY_TO_MOVE' as const } : {})
    },
    include: {
      driver: true
    }
  });

    res.json(updatedMachine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign driver' });
  }
};

/**
 * Security verify parking (GREEN/RED)
 */
export const verifyParking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const machineId = Array.isArray(id) ? id[0] : id;
    const { status, comments } = req.body;

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
    }

    // auth middleware resolves the guard to a real User row. Never fall back to a
    // placeholder id: SecurityVerification.securityUserId is a foreign key, so a
    // non-existent id fails the insert and the whole action 500s.
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

    if (!machine.currentSlotId) {
      return res.status(400).json({ error: 'Machine is not in any slot' });
    }

    // A machine that is only IN_TRANSIT has not been parked yet, so there is
    // nothing to verify. Without this the security queue would be skippable.
    if (!['PARKED_PENDING', 'PARKED_REJECTED'].includes(machine.parkStatus)) {
      return res.status(400).json({ error: `Machine is not awaiting verification (park status is ${machine.parkStatus})` });
    }

    // Create security verification record
    await prisma.securityVerification.create({
      data: {
        machineId,
        slotId: machine.currentSlotId,
        securityUserId: actorId,
        status,
        comments
      }
    });

    // Only parkStatus changes here. The commercial MachineStatus (SOLD, RESERVED,
    // ...) is deliberately left alone: overwriting it with AVAILABLE would
    // silently un-sell a machine the moment a guard approves its parking.
    const parkStatus = status === 'APPROVED' ? 'PARKED_VERIFIED' : 'PARKED_REJECTED';

    const updatedMachine = await prisma.machine.update({
      where: { id: machineId },
      data: { parkStatus: parkStatus as any }
    });

    const slotText = machine.currentSlot
      ? `slot ${machine.currentSlot.row}-${machine.currentSlot.col}`
      : 'its slot';

    if (status === 'APPROVED') {
      await notifyEvent({
        type: 'PARKING_VERIFIED',
        severity: 'INFO',
        title: 'Parking verified',
        message: `${machine.serialNumber} was verified as parked in ${slotText}.`,
        link: 'security'
      });
      await notifyDriverParking(machine.driverId, {
        type: 'PARKING_VERIFIED',
        severity: 'INFO',
        title: 'Parking verified',
        message: `${machine.serialNumber} was verified as parked in ${slotText}.`,
        link: 'parked'
      });
    } else {
      await notifyEvent({
        type: 'PARKING_REJECTED',
        severity: 'WARNING',
        title: 'Parking rejected',
        message: `${machine.serialNumber} was rejected in ${slotText}.${comments ? ` Reason: ${comments}` : ''} Re-park it in the same slot and confirm again.`,
        link: 'security'
      });
      await notifyDriverParking(machine.driverId, {
        type: 'PARKING_REJECTED',
        severity: 'WARNING',
        title: 'Parking rejected',
        message: `${machine.serialNumber} was rejected in ${slotText}.${comments ? ` Reason: ${comments}` : ''} Re-park it in the same slot and confirm again.`,
        link: 'parked'
      });
    }

    await pushSecurityQueueChanged(status === 'APPROVED' ? 'verified' : 'rejected', {
      machineId: machine.id,
      serialNumber: machine.serialNumber,
      slotLabel: slotText
    });

    res.json(updatedMachine);
  } catch (error) {
    console.error('Failed to verify parking:', error);
    res.status(500).json({ error: 'Failed to verify parking' });
  }
};

/**
 * Trigger manual sync
 */
export const triggerSync = async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    const result = await triggerManualSync(date);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
};

/**
 * Get sync status
 */
export const getSyncStatusEndpoint = async (req: Request, res: Response) => {
  try {
    const syncStatus = await getSyncStatus();
    const schedulerStatus = getSchedulerStatus();
    res.json({
      ...syncStatus,
      scheduler: schedulerStatus
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
};

/**
 * Per-stage assembly counts, including how many stages started today.
 * Available to every signed-in role because the assembly page itself is.
 */
export const getStageStatsEndpoint = async (req: Request, res: Response) => {
  try {
    const includeDemo = req.query.includeDemo === 'true';
    res.json(await getStageStats(includeDemo));
  } catch (error) {
    console.error('getStageStatsEndpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch stage statistics' });
  }
};
