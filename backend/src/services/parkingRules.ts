import prisma from '../lib/prisma';
import { getSettings } from './settingsService';

export const AUTO_VERIFY_NOTE = 'Auto-verified: security check is switched off in Settings';

/**
 * Two-person rule for parking: whoever confirmed a machine into its slot (driver,
 * yard office or security) cannot also approve that parking. Rejecting is still
 * allowed, because a reject only sends the machine back to be re-parked.
 */
export function blocksOwnApproval(ruleOn: boolean, parkedById: string | null | undefined, actorId: string, status: string): boolean {
  return ruleOn && status === 'APPROVED' && !!parkedById && parkedById === actorId;
}

/** Who put the machine into its current slot: the latest movement into that slot. */
export async function parkedBy(machineId: string, slotId: string) {
  const m = await prisma.movement.findFirst({
    where: { machineId, toSlotId: slotId },
    orderBy: { timestamp: 'desc' },
    select: { userId: true, user: { select: { name: true } } }
  });
  return m ? { id: m.userId, name: m.user?.name ?? '' } : null;
}

/**
 * With the security check switched off in Settings, a park is verified on the spot.
 * A SecurityVerification row is still written, marked as automatic, so the audit trail
 * shows the check was skipped rather than passed. Returns true when auto-verified.
 */
export async function autoVerifyIfCheckOff(machineId: string, slotId: string, actorId: string): Promise<boolean> {
  const { securityVerifyRequired } = await getSettings();
  if (securityVerifyRequired) return false;

  await prisma.$transaction([
    prisma.securityVerification.create({
      data: { machineId, slotId, securityUserId: actorId, status: 'APPROVED', comments: AUTO_VERIFY_NOTE }
    }),
    prisma.machine.update({ where: { id: machineId }, data: { parkStatus: 'PARKED_VERIFIED' } })
  ]);
  return true;
}
