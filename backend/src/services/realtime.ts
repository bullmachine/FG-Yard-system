import { WebSocketServer, WebSocket } from 'ws';
import { Server, STATUS_CODES } from 'http';
import { Duplex } from 'stream';
import { UserRole } from '@prisma/client';
import prisma from '../lib/prisma';
import { verifyToken } from '../lib/auth';

interface Client {
  socket: WebSocket;
  userId: string;
  isAlive: boolean;
}

interface SocketUser {
  id: string;
  role: string;
}

const clients = new Map<WebSocket, Client>();

const HEARTBEAT_INTERVAL_MS = 30000;

function send(socket: WebSocket, type: string, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload }));
}

/**
 * Refuse the upgrade itself so an unauthenticated client never receives a 101
 * handshake. Authenticating inside the `connection` handler would be too late:
 * by then the socket is already open and holding a slot.
 */
function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = message;
  socket.write(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] || 'Unauthorized'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body
  );
  socket.destroy();
}

export function attachRealtime(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      let url: URL | null = null;
      try {
        url = new URL(req.url || '/', 'http://localhost');
      } catch {
        url = null;
      }

      if (!url || url.pathname !== '/ws') {
        rejectUpgrade(socket, 404, 'Not Found');
        return;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        rejectUpgrade(socket, 401, 'Missing token');
        return;
      }

      const decoded = verifyToken(token);
      if (!decoded) {
        rejectUpgrade(socket, 401, 'Invalid token');
        return;
      }

      let user: (SocketUser & { isActive: boolean }) | null = null;
      try {
        user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, role: true, isActive: true }
        });
      } catch {
        rejectUpgrade(socket, 500, 'Authentication failed');
        return;
      }

      if (!user) {
        rejectUpgrade(socket, 401, 'Unknown user');
        return;
      }

      if (!user.isActive) {
        rejectUpgrade(socket, 403, 'Account inactive');
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { id: user!.id, role: user!.role });
      });
    })();
  });

  wss.on('connection', (socket: WebSocket, _req: unknown, user: SocketUser) => {
    clients.set(socket, { socket, userId: user.id, isAlive: true });
    send(socket, 'connected', { userId: user.id, role: user.role });

    socket.on('pong', () => {
      const client = clients.get(socket);
      if (client) client.isAlive = true;
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {
      socket.terminate();
      clients.delete(socket);
    });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, client] of clients) {
      if (!client.isAlive) {
        socket.terminate();
        clients.delete(socket);
        continue;
      }
      client.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

export function pushToUser(userId: string, type: string, payload: unknown): void {
  for (const client of clients.values()) {
    if (client.userId === userId) {
      send(client.socket, type, payload);
    }
  }
}

export async function pushToRoles(roles: UserRole[], type: string, payload: unknown): Promise<number> {
  if (roles.length === 0) return 0;

  // Re-check the database so a deactivated user or a changed role is never pushed to.
  const activeRecipients = await prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true }
  });

  if (activeRecipients.length === 0) return 0;

  const allowed = new Set(activeRecipients.map((user) => user.id));
  let sent = 0;

  for (const client of clients.values()) {
    if (allowed.has(client.userId)) {
      send(client.socket, type, payload);
      sent++;
    }
  }

  return sent;
}

export function connectedUserCount(): number {
  return new Set([...clients.values()].map((client) => client.userId)).size;
}
