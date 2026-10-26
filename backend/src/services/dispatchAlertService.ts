import prisma from '../lib/prisma';
import { getSettings } from './settingsService';
import { sendMail } from './mailService';
import { notifyEvent } from './notificationService';

/**
 * Overdue dispatch alert. A machine that went out of the FG gate more than
 * dispatchAlertHours ago and has no main gate-out yet is overdue.
 *
 * One e-mail lists every overdue machine, so the production manager is not flooded.
 * It is sent when a machine first becomes overdue, then again every
 * dispatchReminderHours while any machine is still overdue (0 = no reminders).
 */

const HOUR_MS = 3_600_000;
let running = false;

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function fmt(d: Date) {
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function checkOverdueDispatch(): Promise<{ overdue: number; emailed: boolean; reason?: string }> {
  if (running) return { overdue: 0, emailed: false, reason: 'already running' };
  running = true;
  try {
    const s = await getSettings();
    if (!s.dispatchAlertEnabled) return { overdue: 0, emailed: false, reason: 'alerts switched off' };

    const now = Date.now();
    const overdue = await prisma.dispatchItem.findMany({
      where: { status: 'OUT_OF_YARD', gateOutAt: { lte: new Date(now - s.dispatchAlertHours * HOUR_MS) } },
      include: {
        plan: { select: { planNo: true } },
        line: { select: { modelType: true } },
        driver: { select: { name: true } },
        machine: { select: { serialNumber: true, model: true } }
      },
      orderBy: { gateOutAt: 'asc' }
    });
    if (overdue.length === 0) return { overdue: 0, emailed: false };

    // Due when a machine was never alerted, or the last alert is older than the reminder gap.
    const due = overdue.some((i) => !i.overdueAlertAt ||
      (s.dispatchReminderHours > 0 && i.overdueAlertAt.getTime() <= now - s.dispatchReminderHours * HOUR_MS));
    if (!due) return { overdue: overdue.length, emailed: false, reason: 'already alerted' };

    const newOnes = overdue.filter((i) => !i.overdueAlertAt).length;
    const rows = overdue.map((i) => {
      const hours = Math.floor((now - i.gateOutAt!.getTime()) / HOUR_MS);
      return `<tr>
        <td>${esc(i.machine.serialNumber)}</td>
        <td>${esc(i.line.modelType)}<br><small>${esc(i.machine.model)}</small></td>
        <td>${esc(i.plan.planNo)}</td>
        <td>${esc(fmt(i.gateOutAt!))}</td>
        <td style="color:#b91c1c;font-weight:bold">${hours} h</td>
        <td>${esc(i.driver?.name ?? '-')}</td>
      </tr>`;
    }).join('');

    const html = `
      <p>Dear Sir/Madam,</p>
      <p>The following ${overdue.length} machine${overdue.length === 1 ? ' has' : 's have'} gone out of the FG yard more than
      <b>${s.dispatchAlertHours} hours</b> ago and ${overdue.length === 1 ? 'has' : 'have'} not yet gone out of the main gate.</p>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
        <tr style="background:#f1f5f9"><th>Serial Number</th><th>Model-type</th><th>Plan</th><th>FG gate-out</th><th>Waiting</th><th>Driver</th></tr>
        ${rows}
      </table>
      <p style="font-size:12px;color:#555">${s.dispatchReminderHours > 0 ? `A reminder is sent every ${s.dispatchReminderHours} hours while any machine is still waiting.` : 'No further reminders will be sent for these machines.'}</p>
      <p style="font-size:12px;color:#555">This is an automatic message from the FG Yard System.</p>`;

    const to = s.dispatchAlertEmails.split(/[,;\s]+/).filter(Boolean);
    let emailed = false;
    let reason: string | undefined;
    if (to.length === 0) {
      reason = 'no recipient e-mail set';
    } else {
      try {
        await sendMail({
          to,
          subject: `FG Yard: ${overdue.length} dispatched machine${overdue.length === 1 ? '' : 's'} not out of main gate after ${s.dispatchAlertHours} h`,
          html
        });
        emailed = true;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
        console.error('Overdue dispatch e-mail failed:', reason);
      }
    }

    // The in-app alert always goes out, so a mail problem never hides an overdue machine.
    await notifyEvent({
      type: 'DISPATCH_OVERDUE',
      severity: 'WARNING',
      title: 'Dispatch overdue at main gate',
      message: `${overdue.length} machine${overdue.length === 1 ? '' : 's'} out of the FG yard over ${s.dispatchAlertHours} h without main gate-out${newOnes ? ` (${newOnes} new)` : ''}.${emailed ? '' : ` E-mail not sent: ${reason}.`}`,
      link: 'pdi'
    });

    await prisma.dispatchItem.updateMany({ where: { id: { in: overdue.map((i) => i.id) } }, data: { overdueAlertAt: new Date(now) } });
    console.log(`Overdue dispatch alert: ${overdue.length} machine(s), e-mail ${emailed ? 'sent' : `not sent (${reason})`}`);
    return { overdue: overdue.length, emailed, reason };
  } finally {
    running = false;
  }
}
