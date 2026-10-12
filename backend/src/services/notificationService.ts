import prisma from '../lib/prisma';
import { UserRole, NotificationSeverity } from '@prisma/client';
import { pushToUser, pushToRoles } from './realtime';

export type NotificationEventType =
  | 'YARD_FULL'
  | 'SYNC_FAILED'
  | 'GATE_REJECTED'
  | 'NEW_REGISTRATION'
  | 'READY_TO_MOVE'
  | 'SECURITY_REVIEW'
  | 'PARKING_VERIFIED'
  | 'PARKING_REJECTED'
  | 'SLOT_RELEASED'
  | 'SLOT_REASSIGNED'
  | 'BARCODE_MISSING'
  | 'EXIT_REQUEST'
  | 'EXIT_APPROVED'
  | 'EXIT_REJECTED'
  | 'RETURN_SLOT_RESERVED';;;

export interface NotificationEvent {
  type: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link?: string;
}

/**
 * Which roles receive each event. Recipients are roles, not individuals, so a new
 * YARD_MANAGER automatically starts receiving yard alerts without anyone editing a list.
 */
export const NOTIFICATION_RECIPIENTS: Record<NotificationEventType, UserRole[]> = {
  YARD_FULL: ['YARD_MANAGER', 'ADMIN'],
  SYNC_FAILED: ['ADMIN'],
  GATE_REJECTED: ['SECURITY', 'YARD_MANAGER'],
  NEW_REGISTRATION: ['ADMIN'],
  READY_TO_MOVE: ['YARD_MANAGER'],
  SECURITY_REVIEW: ['SECURITY'],
  // The driver is notified separately via notifyDriverParking, because a driver
  // is a single person rather than every holder of a role.
  PARKING_VERIFIED: ['YARD_MANAGER'],
  PARKING_REJECTED: ['YARD_MANAGER', 'ADMIN'],
  // A release is a deliberate capacity decision, so the managers who can make it are
  // the ones who need the record that it happened.
  SLOT_RELEASED: ['YARD_MANAGER', 'ADMIN'],
  SLOT_REASSIGNED: ['YARD_MANAGER', 'ADMIN'],
  // Barcode is part of gate identification, so a machine that reaches yard age without
  // one is a yard-manager problem, not just a data-entry one.
  BARCODE_MISSING: ['YARD_MANAGER', 'ADMIN'],
  // A staff exit request lands here so a manager knows to review it.
  EXIT_REQUEST: ['YARD_MANAGER', 'ADMIN'],
  // The requester is notified directly (single user), so the role list stays empty.
  EXIT_APPROVED: [],
  EXIT_REJECTED: [],
  // A slot was promised to a returning machine; the gate and the yard should know
  // it is expected so it is not parked twice or refused at the checkpoint.
  RETURN_SLOT_RESERVED: ['SECURITY', 'YARD_MANAGER', 'ADMIN'],
};

const DEDUPE_WINDOW_MINUTES = 15;
const RETENTION_DAYS = 30;

/**
 * Deduplicate per user, per event, and not merely per type.
 *
 * Matching on type alone looks like the cheap option but silently drops a genuinely
 * different alert: the window is 15 minutes, and a full yard refuses every machine it
 * sees, so the second and third machines to be turned away within the window produced
 * no notification at all and simply vanished. Keying on the message keeps the flood
 * protection for a cron that re-reports the same machine while letting each distinct
 * machine speak for itself.
 */
function sameEventWithinWindow(userId: string, event: NotificationEvent) {
  return prisma.notification.findFirst({
    where: {
      userId,
      type: event.type,
      message: event.message,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000) },
    },
    select: { id: true },
  });
}

const notificationSelect = {
  id: true,
  type: true,
  severity: true,
  title: true,
  message: true,
  link: true,
  readAt: true,
  createdAt: true
} as const;

export type NotificationPayload = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Persist a notification for every active user holding a recipient role, then push it
 * to that user's live socket. Deduplicated per user within a short window so a 2-hourly
 * cron cannot flood the bell with identical alerts.
 */
export async function notifyRoles(roles: UserRole[], event: NotificationEvent): Promise<number> {
  const recipients = Array.from(new Set(roles));
  if (recipients.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { role: { in: recipients }, isActive: true },
    select: { id: true }
  });

  if (users.length === 0) return 0;

  let created = 0;

  for (const user of users) {
    const recent = await sameEventWithinWindow(user.id, event);

    if (recent) continue;

    try {
      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type: event.type,
          severity: event.severity,
          title: event.title,
          message: event.message,
          link: event.link
        },
        select: notificationSelect
      });

      pushToUser(user.id, 'notification', { notification });
      created++;
    } catch (error) {
      console.error(`Failed to create ${event.type} notification:`, error);
    }
  }

  return created;
}

/**
 * Convenience wrapper so callers pass an event type and get the role list from the map.
 */
export async function notifyEvent(event: NotificationEvent): Promise<number> {
  const roles = NOTIFICATION_RECIPIENTS[event.type];
  if (!roles) {
    console.error(`No recipients configured for notification type ${event.type}`);
    return 0;
  }
  return notifyRoles(roles, event);
}

/**
 * Notify a single user (by id) - used for the requester of an exit request, who is
 * a specific person rather than every holder of a role. No dedupe on purpose: an
 * approval or rejection is a discrete event that must always be seen.
 */
export async function notifyUser(userId: string, event: NotificationEvent): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true }
  });
  if (!user?.isActive) return false;

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: event.type,
        severity: event.severity,
        title: event.title,
        message: event.message,
        link: event.link
      },
      select: notificationSelect
    });
    pushToUser(user.id, 'notification', { notification });
    return true;
  } catch (error) {
    console.error(`Failed to create user ${userId} ${event.type} notification:`, error);
    return false;
  }
}

/**
 * Alert that a machine at ready-to-move age (stage 18+) still has no barcode. The
 * machine number is part of the message, so the per-user dedupe still lets every
 * distinct machine speak while a still-empty barcode re-alerts on each sync until
 * fixed.
 */
export async function alertIfMissingBarcode(machine: {
  serialNumber: string;
  model: string | null;
  assemblyStage: number;
  barcode: string | null;
}): Promise<number> {
  if (machine.barcode && machine.barcode.trim() !== '') return 0;
  if (machine.assemblyStage < 18) return 0;

  return notifyEvent({
    type: 'BARCODE_MISSING',
    severity: 'CRITICAL',
    title: `Missing barcode - ${machine.serialNumber}`,
    message: `${machine.serialNumber} (${machine.model || 'unknown model'}) is at stage ${machine.assemblyStage} but has no barcode. Set it from Machine Tracking or the plant so the machine can be identified at the gate.`,
    link: 'assembly',
  });
}

export async function listNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    select: notificationSelect,
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null }
  });
}

export async function markRead(userId: string, ids: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() }
  });
  return result.count;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() }
  });
  return result.count;
}

/**
 * Drop read notifications older than the retention window. Unread rows are always kept.
 */
export async function pruneReadNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.notification.deleteMany({
    where: { readAt: { not: null, lt: cutoff } }
  });
  return result.count;
}

/**
 * Notify the driver who physically moved the machine, if their Driver record is
 * linked to a login. Dedupe is skipped on purpose: a machine that security
 * rejects and the driver re-parks, only to be rejected again, must produce an
 * alert every time rather than being swallowed by the shared 15 minute window.
 * Returns false when the driver has no linked account, so callers can log it.
 */
export async function notifyDriverParking(
  driverId: string | null | undefined,
  event: NotificationEvent
): Promise<boolean> {
  if (!driverId) return false;

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { userId: true }
  });
  if (!driver?.userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: driver.userId },
    select: { id: true, isActive: true }
  });
  if (!user?.isActive) return false;

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: event.type,
        severity: event.severity,
        title: event.title,
        message: event.message,
        link: event.link
      },
      select: notificationSelect
    });
    pushToUser(user.id, 'notification', { notification });
    return true;
  } catch (error) {
    console.error(`Failed to create driver ${event.type} notification:`, error);
    return false;
  }
}

/**
 * Tell every live Security session that its queue changed, so the verification
 * screen can refresh without a page reload. This carries no stored notification
 * row: SECURITY_REVIEW already produces the persistent alert.
 */
export async function pushSecurityQueueChanged(
  reason: 'parked' | 'verified' | 'rejected' | 'reparked',
  detail: { machineId: string; serialNumber: string; slotLabel?: string }
): Promise<number> {
  return pushToRoles(['SECURITY'], 'security-queue', {
    reason,
    machineId: detail.machineId,
    serialNumber: detail.serialNumber,
    slotLabel: detail.slotLabel,
    at: new Date().toISOString()
  });
}

/**
 * Tell every live Security session that an exit request was approved or completed,
 * so the Authorized Exits panel can refresh without a reload. This mirrors
 * pushSecurityQueueChanged: a transient realtime signal, not a stored notification.
 */
export async function pushExitRequestsChanged(
  reason: 'approved' | 'rejected' | 'completed',
  detail: { machineId: string; serialNumber: string; reason?: string }
): Promise<number> {
  return pushToRoles(['SECURITY'], 'exit-request', {
    reason,
    machineId: detail.machineId,
    serialNumber: detail.serialNumber,
    requestReason: detail.reason,
    at: new Date().toISOString()
  });
}
