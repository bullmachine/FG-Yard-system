'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck, Wifi, WifiOff, X, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { useNotifications, AppNotification } from '@/contexts/NotificationContext';
import { formatDateTime } from '@/lib/format';
import { SectionCard } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';

const severityStyles: Record<AppNotification['severity'], { icon: React.ReactNode; row: string; badge: 'red' | 'amber' | 'blue' }> = {
  CRITICAL: { icon: <AlertTriangle className="h-4 w-4 text-red-600" />, row: 'bg-red-50/60', badge: 'red' },
  WARNING: { icon: <AlertCircle className="h-4 w-4 text-amber-600" />, row: 'bg-amber-50/50', badge: 'amber' },
  INFO: { icon: <Info className="h-4 w-4 text-blue-600" />, row: '', badge: 'blue' }
};

function ConnectionPill({ state }: { state: 'connecting' | 'live' | 'offline' }) {
  if (state === 'live') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
        <Wifi className="h-3 w-3" /> Live
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
        <Wifi className="h-3 w-3 animate-pulse" /> Connecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
      <WifiOff className="h-3 w-3" /> Offline
    </span>
  );
}

function CriticalToasts() {
  const { criticalAlerts, dismissCritical, markRead } = useNotifications();

  useEffect(() => {
    if (criticalAlerts.length === 0) return;
    const timers = criticalAlerts.map((alert) =>
      setTimeout(() => {
        dismissCritical(alert.id);
        markRead([alert.id]);
      }, 12000)
    );
    return () => timers.forEach(clearTimeout);
  }, [criticalAlerts, dismissCritical, markRead]);

  if (criticalAlerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {criticalAlerts.map((alert) => (
        <div key={alert.id} className="rounded-lg border border-red-200 bg-white p-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-900">{alert.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{alert.message}</p>
            </div>
            <button
              onClick={() => {
                dismissCritical(alert.id);
                markRead([alert.id]);
              }}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationBell() {
  const { notifications, unreadCount, connectionState, refresh, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const recent = notifications.slice(0, 8);

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => {
            setOpen((value) => !value);
            if (!open) refresh();
          }}
          className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100"
          title="Notifications"
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-slate-900">Notifications</p>
                <ConnectionPill state={connectionState} />
              </div>
              <button
                onClick={() => markAllRead()}
                disabled={unreadCount === 0}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {recent.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-500">No notifications yet</p>
              ) : (
                recent.map((notification) => {
                  const style = severityStyles[notification.severity];
                  const unread = notification.readAt === null;
                  return (
                    <button
                      key={notification.id}
                      onClick={() => unread && markRead([notification.id])}
                      className={`flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${style.row}`}
                    >
                      <span className="mt-0.5 shrink-0">{style.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={`truncate text-xs font-semibold ${unread ? 'text-slate-900' : 'text-slate-500'}`}>
                            {notification.title}
                          </span>
                          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-600">{notification.message}</span>
                        <span className="mt-1 block text-[10px] text-slate-400">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {notifications.length > recent.length && (
              <p className="px-3 py-2 text-center text-[11px] text-slate-500">
                {notifications.length - recent.length} older notification(s) — see the Notifications page
              </p>
            )}
          </div>
        )}
      </div>
      <CriticalToasts />
    </>
  );
}

export default function NotificationCenter() {
  const { notifications, unreadCount, connectionState, refresh, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <SectionCard
        title={`Notifications (${notifications.length})`}
        description="Role-based alerts raised by the yard automation"
        action={
          <div className="flex items-center gap-3">
            <ConnectionPill state={connectionState} />
            <button
              onClick={() => refresh()}
              className="text-[11px] font-medium text-blue-700 hover:underline"
            >
              Refresh
            </button>
            <button
              onClick={() => markAllRead()}
              disabled={unreadCount === 0}
              className="text-[11px] font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Mark all read
            </button>
          </div>
        }
        noPadding
      >
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nothing yet. Alerts appear here when a sync fails, a yard fills up, a gate check is
            rejected, or a machine needs review.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Alert</TableHeaderCell>
              <TableHeaderCell>Severity</TableHeaderCell>
              <TableHeaderCell>Raised</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {notifications.map((notification) => {
                const style = severityStyles[notification.severity];
                const unread = notification.readAt === null;
                return (
                  <TableRow key={notification.id} className={style.row}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0">{style.icon}</span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900">{notification.title}</p>
                          <p className="text-xs text-slate-600">{notification.message}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={style.badge}>{notification.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500">{formatDateTime(notification.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      {unread ? (
                        <button
                          onClick={() => markRead([notification.id])}
                          className="text-[11px] font-medium text-blue-700 hover:underline"
                        >
                          Mark read
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Read</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
