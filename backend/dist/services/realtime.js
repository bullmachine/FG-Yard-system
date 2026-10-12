"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRealtime = attachRealtime;
exports.pushToUser = pushToUser;
exports.pushToRoles = pushToRoles;
exports.connectedUserCount = connectedUserCount;
const ws_1 = require("ws");
const http_1 = require("http");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const clients = new Map();
const HEARTBEAT_INTERVAL_MS = 30000;
function send(socket, type, payload) {
    if (socket.readyState !== ws_1.WebSocket.OPEN)
        return;
    socket.send(JSON.stringify({ type, payload }));
}
/**
 * Refuse the upgrade itself so an unauthenticated client never receives a 101
 * handshake. Authenticating inside the `connection` handler would be too late:
 * by then the socket is already open and holding a slot.
 */
function rejectUpgrade(socket, status, message) {
    const body = message;
    socket.write(`HTTP/1.1 ${status} ${http_1.STATUS_CODES[status] || 'Unauthorized'}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
        body);
    socket.destroy();
}
function attachRealtime(server) {
    const wss = new ws_1.WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        void (async () => {
            let url = null;
            try {
                url = new URL(req.url || '/', 'http://localhost');
            }
            catch {
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
            const decoded = (0, auth_1.verifyToken)(token);
            if (!decoded) {
                rejectUpgrade(socket, 401, 'Invalid token');
                return;
            }
            let user = null;
            try {
                user = await prisma_1.default.user.findUnique({
                    where: { id: decoded.userId },
                    select: { id: true, role: true, isActive: true }
                });
            }
            catch {
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
                wss.emit('connection', ws, req, { id: user.id, role: user.role });
            });
        })();
    });
    wss.on('connection', (socket, _req, user) => {
        clients.set(socket, { socket, userId: user.id, isAlive: true });
        send(socket, 'connected', { userId: user.id, role: user.role });
        socket.on('pong', () => {
            const client = clients.get(socket);
            if (client)
                client.isAlive = true;
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
function pushToUser(userId, type, payload) {
    for (const client of clients.values()) {
        if (client.userId === userId) {
            send(client.socket, type, payload);
        }
    }
}
async function pushToRoles(roles, type, payload) {
    if (roles.length === 0)
        return 0;
    // Re-check the database so a deactivated user or a changed role is never pushed to.
    const activeRecipients = await prisma_1.default.user.findMany({
        where: { role: { in: roles }, isActive: true },
        select: { id: true }
    });
    if (activeRecipients.length === 0)
        return 0;
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
function connectedUserCount() {
    return new Set([...clients.values()].map((client) => client.userId)).size;
}
