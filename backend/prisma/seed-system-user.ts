/**
 * Ensures the "System" service account exists.
 *
 * Auto-generated movements (stage-13 slot assignment, reservation release) write
 * userId 'system', but Movement.user is a required foreign key and a plain string
 * like that would fail the insert. Every historical auto-assignment therefore threw
 * on its movement write and silently skipped the audit trail.
 *
 * The account is deliberately inactive so it can never be logged into: login rejects
 * isActive false, and notifyRoles skips inactive users, so it collects no
 * notifications either. It exists purely to satisfy the movement foreign key and to
 * give reports a stable actor name.
 *
 *   npm run users:system
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const SYSTEM_USER = {
  // The id is the literal string 'system' on purpose: movement writers save
  // `userId: ... || 'system'` as the actor. Movement.user is a foreign key on
  // User.id, so this account's id must BE that string or every system-generated
  // row fails. It is not a UUID.
  id: 'system',
  email: 'system@yard.local',
  name: 'System',
  role: UserRole.VIEW_ONLY,
  isActive: false,
};

async function main() {
  let password: string = process.env.SYSTEM_USER_PASSWORD || `!SYSTEM-${randomBytes(24).toString('hex')}`;

  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_USER.email } });
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_USER.email },
    update: {
      id: SYSTEM_USER.id,
      name: SYSTEM_USER.name,
      role: SYSTEM_USER.role,
      isActive: SYSTEM_USER.isActive,
    },
    create: {
      id: SYSTEM_USER.id,
      email: SYSTEM_USER.email,
      name: SYSTEM_USER.name,
      role: SYSTEM_USER.role,
      isActive: SYSTEM_USER.isActive,
      password,
    },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  if (existing) {
    console.log('System service account already existed; updated in place:');
  } else {
    console.log('System service account created:');
  }
  console.table([user]);
  console.log('This account cannot be logged into (isActive = false).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });