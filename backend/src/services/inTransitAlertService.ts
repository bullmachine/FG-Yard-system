import prisma from '../lib/prisma';
import { getSettings } from './settingsService';
import { notifyEvent, notifyDriverParking } from './notificationService';

/**
 * Stuck-in-transit alert. A machine that passed gate IN more than inTransitAlertMinutes
 * ago and is still IN_TRANSIT has never had its parking confirmed, so security was never
 * asked to verify it. Each trip through the gate is alerted once: the alert stamp is
 * compared with the latest gate IN, so a later trip alerts again.
 */

const MINUTE_MS = 60_000;
let running = false;

export async function checkStuckInTransit(): Promise<{ stuck: number; alerted: number }> {
  if (running) return { stuck: 0, alerted: 0 };
  running = true;
  try {
    const { inTransitAlertMinutes } = await getSettings();
    if (inTransitAlertMinutes <= 0) return { stuck: 0, alerted: 0 };

    const cutoff = new Date(Date.now() - inTransitAlertMinutes * MINUTE_MS);
    const machines = await prisma.machine.findMany({
      where: { parkStatus: 'IN_TRANSIT', isDemo: false },
      select: {
        id: true,
        serialNumber: true,
        model: true,
        driverId: true,
        inTransitAlertAt: true,
        driver: { select: { name: true } },
        plannedSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
        gateLogs: {
          where: { direction: 'IN', result: 'AUTHORIZED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true }
        }
      }
    });

    const stuck = machines.filter((m) => {
      const gateInAt = m.gateLogs[0]?.createdAt;
      return gateInAt && gateInAt <= cutoff && (!m.inTransitAlertAt || m.inTransitAlertAt < gateInAt);
    });

    for (const m of stuck) {
      const minutes = Math.floor((Date.now() - m.gateLogs[0].createdAt.getTime()) / MINUTE_MS);
      const slot = m.plannedSlot ? `${m.plannedSlot.yard.name} ${m.plannedSlot.row}-${m.plannedSlot.col}` : 'its slot';
      await notifyEvent({
        type: 'IN_TRANSIT_STUCK',
        severity: 'WARNING',
        title: `${m.serialNumber} not confirmed parked`,
        message: `${m.serialNumber} (${m.model}) went through the gate ${minutes} min ago and parking in ${slot} is still not confirmed${m.driver ? ` by ${m.driver.name}` : ''}. Security cannot verify it until parking is confirmed.`,
        link: 'parked'
      });
      await notifyDriverParking(m.driverId, {
        type: 'IN_TRANSIT_STUCK',
        severity: 'WARNING',
        title: 'Confirm parking',
        message: `Please confirm that ${m.serialNumber} is parked in ${slot}.`,
        link: 'parked'
      });
      await prisma.machine.update({ where: { id: m.id }, data: { inTransitAlertAt: new Date() } });
    }

    if (stuck.length) console.log(`In-transit alert: ${stuck.length} machine(s) not confirmed parked`);
    return { stuck: stuck.length, alerted: stuck.length };
  } finally {
    running = false;
  }
}
