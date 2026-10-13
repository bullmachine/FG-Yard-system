'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { API_URL, getToken, buildSocketUrl } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export interface AppNotification {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  connectionState: 'connecting' | 'live' | 'offline';
  criticalAlerts: AppNotification[];
  dismissCritical: (id: string) => void;
  refresh: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  subscribe: (type: string, handler: (payload: unknown) => void) => () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [criticalAlerts, setCriticalAlerts] = useState<AppNotification[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnect = useRef(false);
  // Listeners for non-notification socket events, keyed by message type. The
  // context owns the only WebSocket, so screens that need a live signal (the
  // security queue) subscribe here rather than opening a second connection.
  const listeners = useRef(new Map<string, Set<(payload: unknown) => void>>());

  const subscribe = useCallback((type: string, handler: (payload: unknown) => void) => {
    const bucket = listeners.current.get(type) ?? new Set<(payload: unknown) => void>();
    bucket.add(handler);
    listeners.current.set(type, bucket);

    return () => {
      const current = listeners.current.get(type);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) listeners.current.delete(type);
    };
  }, []);

  const emit = useCallback((type: string, payload: unknown) => {
    const bucket = listeners.current.get(type);
    if (!bucket) return;
    for (const handler of [...bucket]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Listener for "${type}" threw:`, error);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch {
      // Leave the last known list in place; the socket or the next refresh will recover it.
    }
  }, []);

  const markRead = useCallback(async (ids: string[]) => {
    const token = getToken();
    if (!token || ids.length === 0) return;

    try {
      const res = await fetch(`${API_URL}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
      setNotifications((current) =>
        current.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt || new Date().toISOString() } : n))
      );
    } catch {
      // Ignore: the badge will resync on the next refresh.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({})
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
      setNotifications((current) => current.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    } catch {
      // Ignore.
    }
  }, []);

  const dismissCritical = useCallback((id: string) => {
    setCriticalAlerts((current) => current.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    shouldConnect.current = true;

    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed || !shouldConnect.current) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt.current, RECONNECT_MAX_MS);
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed || !shouldConnect.current) return;

      const token = getToken();
      if (!token) return;

      const socket = new WebSocket(`${buildSocketUrl('/ws')}?token=${encodeURIComponent(token)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttempt.current = 0;
        setConnected(true);
        setEverConnected(true);
        refresh();
      };

      socket.onmessage = (event) => {
        let message: { type?: string; payload?: { notification?: AppNotification } & Record<string, unknown> };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type !== 'notification') {
          // Live signals such as "security-queue" are transient and carry no
          // stored row, so they are forwarded to subscribers only.
          if (message.type) emit(message.type, message.payload);
          return;
        }

        if (!message.payload?.notification) return;

        const incoming = message.payload.notification;
        setNotifications((current) => {
          if (current.some((n) => n.id === incoming.id)) return current;
          return [incoming, ...current];
        });
        setUnreadCount((count) => count + 1);

        if (incoming.severity === 'CRITICAL') {
          setCriticalAlerts((current) => [...current.filter((n) => n.id !== incoming.id), incoming]);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        scheduleReconnect();
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      shouldConnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [isAuthenticated, refresh, emit]);

  const connectionState: 'connecting' | 'live' | 'offline' = !isAuthenticated
    ? 'offline'
    : connected
      ? 'live'
      : everConnected
        ? 'offline'
        : 'connecting';

  return (
    <NotificationContext.Provider
      value={{
        notifications: isAuthenticated ? notifications : [],
        unreadCount: isAuthenticated ? unreadCount : 0,
        connectionState,
        criticalAlerts,
        dismissCritical,
        refresh,
        markRead,
        markAllRead,
        subscribe
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used inside NotificationProvider');
  }
  return context;
}

/**
 * Run a callback whenever a transient socket event of the given type arrives.
 * The handler is kept in a ref so callers do not have to memoise it, which
 * otherwise turns every render into a resubscribe.
 */
export function useRealtimeEvent(
  type: string,
  handler: (payload: unknown) => void
): void {
  const { subscribe } = useNotifications();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => subscribe(type, (payload) => handlerRef.current(payload)), [subscribe, type]);
}
