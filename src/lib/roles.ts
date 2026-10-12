/**
 * Who may read the parking audit trail. The rules live here so the History tabs,
 * the inline log panels and the per-machine modal cannot drift apart from the
 * role gate on the server, which is the real boundary.
 */

/** Verification history: ADMIN and SECURITY act on the queue, YARD_MANAGER audits it. */
export function canViewSecurityHistory(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'SECURITY' || role === 'YARD_MANAGER';
}

/** Parking log: every role that can open the History screen. */
export function canViewParkingLog(role?: string | null): boolean {
  return (
    role === 'ADMIN' ||
    role === 'YARD_MANAGER' ||
    role === 'OPERATOR' ||
    role === 'SECURITY'
  );
}

/**
 * The yard office may record a park on a driver's behalf, so a movement's actor
 * alone does not say who drove the machine. Any staff role means the yard office
 * recorded it; DRIVER means the driver self-confirmed.
 */
export function isYardRecorder(role?: string | null): boolean {
  return !!role && role !== 'DRIVER';
}
