import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import prisma from '../lib/prisma';

/**
 * Role access: which role may open each page and perform each action. An Admin edits
 * it on the Role Access page. The defaults below are the access the system shipped
 * with; the database only stores where an Admin has changed a default.
 *
 * ADMIN always has every permission. User Management, Settings and Role Access are
 * not in the catalog: they stay Admin-only in code. Help, Docs, SOP and Notifications
 * are open to every signed-in user.
 */

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  defaults: UserRole[];
}

export const EDITABLE_ROLES: UserRole[] = [
  'YARD_MANAGER', 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY', 'DRIVER', 'PLANNER', 'PDI', 'MAIN_GATE'
];

// A driver is not staff: only these can ever be given to the DRIVER role.
const DRIVER_ALLOWED = new Set(['page.dashboard', 'page.parked', 'page.requests']);

const YM: UserRole = 'YARD_MANAGER';

export const PERMISSIONS: PermissionDef[] = [
  { key: 'page.dashboard', group: 'Dashboard', label: 'Open page', defaults: [YM, 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY', 'DRIVER', 'PLANNER', 'PDI'] },

  { key: 'page.yards', group: 'FG Yard', label: 'Open page (view slots)', defaults: [YM, 'OPERATOR', 'VIEW_ONLY', 'SECURITY'] },
  { key: 'yards.move', group: 'FG Yard', label: 'Move machines between slots', defaults: [YM, 'OPERATOR'] },
  { key: 'yards.edit', group: 'FG Yard', label: 'Create / edit yards, block slots, release reservations', defaults: [YM] },
  { key: 'yards.releaseExit', group: 'FG Yard', label: 'Release a machine for exit', defaults: [YM] },
  { key: 'yards.delete', group: 'FG Yard', label: 'Delete a yard', defaults: [] },

  { key: 'page.stock', group: 'Yard Stock', label: 'Open page', defaults: [YM, 'OPERATOR', 'VIEW_ONLY', 'PLANNER'] },
  { key: 'stock.edit', group: 'Yard Stock', label: 'Set inward date, clear return hold', defaults: [YM] },

  { key: 'page.dispatch', group: 'Dispatch Planning', label: 'Open page', defaults: [YM, 'PLANNER'] },
  { key: 'dispatch.plan', group: 'Dispatch Planning', label: 'Create and cancel plans', defaults: [YM, 'PLANNER'] },

  { key: 'page.pdi', group: 'Dispatch Machine List', label: 'Open page', defaults: [YM, 'OPERATOR', 'VIEW_ONLY', 'PLANNER', 'PDI', 'MAIN_GATE'] },
  { key: 'pdi.assign', group: 'Dispatch Machine List', label: 'Assign driver', defaults: [YM, 'PDI'] },
  { key: 'pdi.check', group: 'Dispatch Machine List', label: 'PDI check (pass / hold)', defaults: [YM, 'PDI'] },
  { key: 'pdi.mainGate', group: 'Dispatch Machine List', label: 'Main gate out', defaults: [YM, 'MAIN_GATE'] },

  { key: 'page.machines', group: 'Machine Tracking', label: 'Open page', defaults: [YM, 'OPERATOR', 'SERVICE_TECHNICIAN', 'VIEW_ONLY'] },
  { key: 'machines.add', group: 'Machine Tracking', label: 'Add machine', defaults: [YM, 'OPERATOR'] },
  { key: 'machines.edit', group: 'Machine Tracking', label: 'Edit machine', defaults: [YM] },
  { key: 'machines.allocate', group: 'Machine Tracking', label: 'Place machine during initial stock load', defaults: [YM] },
  { key: 'machines.delete', group: 'Machine Tracking', label: 'Delete machine', defaults: [] },

  { key: 'page.assembly', group: 'Assembly Line', label: 'Open page', defaults: [YM, 'OPERATOR'] },
  { key: 'assembly.advance', group: 'Assembly Line', label: 'Advance stage', defaults: ['OPERATOR'] },
  { key: 'assembly.assign', group: 'Assembly Line', label: 'Assign location / driver', defaults: [YM] },
  { key: 'assembly.sync', group: 'Assembly Line', label: 'Sync with plant', defaults: [] },

  { key: 'page.fert', group: 'FERT Categories', label: 'Open page', defaults: [YM] },
  { key: 'fert.manage', group: 'FERT Categories', label: 'Add / edit / delete', defaults: [] },

  { key: 'page.models', group: 'Vehicle Models', label: 'Open page', defaults: [YM] },
  { key: 'models.manage', group: 'Vehicle Models', label: 'Add / edit / delete', defaults: [YM] },

  { key: 'page.materials', group: 'Material Master', label: 'Open page', defaults: [YM] },
  { key: 'materials.sync', group: 'Material Master', label: 'Sync and sync status', defaults: [YM] },

  { key: 'page.sap', group: 'SAP Check', label: 'Open page', defaults: [YM] },
  { key: 'sap.sync', group: 'SAP Check', label: 'Check SAP now', defaults: [YM] },

  { key: 'page.drivers', group: 'Drivers', label: 'Open page', defaults: [YM] },
  { key: 'drivers.manage', group: 'Drivers', label: 'Add / edit drivers and photos', defaults: [YM] },
  { key: 'drivers.admin', group: 'Drivers', label: 'Delete drivers, driver logins', defaults: [] },

  { key: 'page.gate', group: 'Gate Control', label: 'Open page (scan in / out)', defaults: [YM, 'OPERATOR', 'SECURITY'] },
  { key: 'gate.logs', group: 'Gate Control', label: 'Gate log', defaults: [YM, 'SECURITY'] },

  { key: 'page.parked', group: 'Confirm Parking', label: 'Open page', defaults: [YM, 'OPERATOR', 'SECURITY', 'DRIVER'] },
  { key: 'parked.confirmOthers', group: 'Confirm Parking', label: "Confirm for a driver", defaults: [YM, 'OPERATOR', 'SECURITY'] },

  { key: 'page.security', group: 'Security', label: 'Open page', defaults: ['SECURITY'] },
  { key: 'security.verify', group: 'Security', label: 'Approve / reject parking', defaults: ['SECURITY'] },

  { key: 'page.returns', group: 'Returns', label: 'Open page', defaults: [YM, 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY'] },
  { key: 'returns.reserve', group: 'Returns', label: 'Reserve return slot', defaults: [YM, 'OPERATOR'] },

  { key: 'page.requests', group: 'Exit Requests', label: 'Open page (raise requests)', defaults: [YM, 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY', 'DRIVER'] },
  { key: 'requests.approve', group: 'Exit Requests', label: 'See all requests, approve / reject', defaults: [YM] },

  { key: 'page.history', group: 'Movement History', label: 'Open page', defaults: [YM, 'OPERATOR', 'SECURITY'] },
  { key: 'history.verifications', group: 'Movement History', label: 'Security verification history', defaults: [YM, 'SECURITY'] },
];

const KEYS = new Set(PERMISSIONS.map((p) => p.key));

export function isLocked(role: UserRole, key: string): boolean {
  return role === 'DRIVER' && !DRIVER_ALLOWED.has(key);
}

function defaultAllowed(role: UserRole, key: string): boolean {
  if (isLocked(role, key)) return false;
  return PERMISSIONS.find((p) => p.key === key)?.defaults.includes(role) ?? false;
}

// One process serves the API, so an in-memory copy is safe; it is dropped on every save.
let cache: Map<UserRole, Set<string>> | null = null;

async function load(): Promise<Map<UserRole, Set<string>>> {
  if (cache) return cache;
  const rows = await prisma.roleAccess.findMany();
  const override = new Map(rows.map((r) => [`${r.role}:${r.permission}`, r.allowed]));
  const next = new Map<UserRole, Set<string>>();
  for (const role of EDITABLE_ROLES) {
    const set = new Set<string>();
    for (const p of PERMISSIONS) {
      const o = override.get(`${role}:${p.key}`);
      const allowed = isLocked(role, p.key) ? false : o ?? defaultAllowed(role, p.key);
      if (allowed) set.add(p.key);
    }
    next.set(role, set);
  }
  cache = next;
  return next;
}

export async function permissionsFor(role: string | undefined | null): Promise<string[]> {
  if (!role) return [];
  if (role === 'ADMIN') return PERMISSIONS.map((p) => p.key);
  return [...((await load()).get(role as UserRole) ?? [])];
}

export async function hasPermission(role: string | undefined | null, key: string): Promise<boolean> {
  if (!role) return false;
  if (role === 'ADMIN') return true;
  return (await load()).get(role as UserRole)?.has(key) ?? false;
}

/** Route guard: allowed when the signed-in role has any of the given permissions. */
export const requirePermission = (...keys: string[]) => {
  for (const k of keys) if (!KEYS.has(k)) throw new Error(`Unknown permission ${k}`);
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = (req as Request & { userRole?: string }).userRole;
      for (const k of keys) if (await hasPermission(role, k)) return next();
      return res.status(403).json({ error: 'Insufficient permissions' });
    } catch (error) {
      console.error('requirePermission error:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
    }
  };
};

export async function getMatrix() {
  const current = await load();
  const log = await prisma.roleAccessLog.findMany({
    orderBy: { changedAt: 'desc' },
    take: 30,
    select: { id: true, role: true, permission: true, allowed: true, changedAt: true, changedBy: { select: { name: true } } }
  });
  return {
    roles: EDITABLE_ROLES,
    permissions: PERMISSIONS.map(({ key, group, label }) => ({ key, group, label })),
    allowed: Object.fromEntries(EDITABLE_ROLES.map((r) => [r, [...(current.get(r) ?? [])]])),
    defaults: Object.fromEntries(EDITABLE_ROLES.map((r) => [r, PERMISSIONS.filter((p) => defaultAllowed(r, p.key)).map((p) => p.key)])),
    locked: Object.fromEntries(EDITABLE_ROLES.map((r) => [r, PERMISSIONS.filter((p) => isLocked(r, p.key)).map((p) => p.key)])),
    log
  };
}

export interface AccessChange { role: string; permission: string; allowed: boolean }

/** Apply changes; each real change is logged. Returns the number of changes made. */
export async function saveChanges(changes: AccessChange[], userId: string): Promise<number> {
  for (const c of changes) {
    if (!EDITABLE_ROLES.includes(c.role as UserRole)) throw new Error(`Role ${c.role} cannot be changed`);
    if (!KEYS.has(c.permission)) throw new Error(`Unknown permission ${c.permission}`);
    if (typeof c.allowed !== 'boolean') throw new Error('allowed must be true or false');
    if (isLocked(c.role as UserRole, c.permission) && c.allowed) throw new Error(`${c.permission} cannot be given to a driver`);
  }
  const current = await load();
  const real = changes.filter((c) => current.get(c.role as UserRole)?.has(c.permission) !== c.allowed);
  if (real.length === 0) return 0;
  await prisma.$transaction([
    ...real.map((c) => {
      const role = c.role as UserRole;
      // Back to the default: drop the override, so later default changes in code apply.
      return c.allowed === defaultAllowed(role, c.permission)
        ? prisma.roleAccess.deleteMany({ where: { role, permission: c.permission } })
        : prisma.roleAccess.upsert({
            where: { role_permission: { role, permission: c.permission } },
            create: { role, permission: c.permission, allowed: c.allowed, updatedById: userId },
            update: { allowed: c.allowed, updatedById: userId }
          });
    }),
    prisma.roleAccessLog.createMany({
      data: real.map((c) => ({ role: c.role as UserRole, permission: c.permission, allowed: c.allowed, changedById: userId }))
    })
  ]);
  cache = null;
  return real.length;
}

/** Put every role back to the default access. */
export async function resetToDefaults(userId: string): Promise<number> {
  const current = await load();
  const changes: AccessChange[] = [];
  for (const role of EDITABLE_ROLES) {
    for (const p of PERMISSIONS) {
      const def = defaultAllowed(role, p.key);
      if ((current.get(role)?.has(p.key) ?? false) !== def) changes.push({ role, permission: p.key, allowed: def });
    }
  }
  return saveChanges(changes, userId);
}
