let prisma;

const ROLE_USERS = [
  { role: 'ADMIN', name: 'Admin User', emailLocal: 'admin' },
  { role: 'YARD_MANAGER', name: 'Yard Manager', emailLocal: 'yard.manager' },
  { role: 'OPERATOR', name: 'Operator', emailLocal: 'operator' },
  { role: 'SERVICE_TECHNICIAN', name: 'Service Technician', emailLocal: 'service.tech' },
  { role: 'SECURITY', name: 'Security', emailLocal: 'security' },
  { role: 'VIEW_ONLY', name: 'View Only', emailLocal: 'viewer' },
];

async function main() {
  const [{ PrismaClient }, { hash }, { default: dotenv }] = await Promise.all([
    import('@prisma/client'),
    import('bcryptjs'),
    import('dotenv'),
  ]);

  dotenv.config();

  prisma = new PrismaClient();
  console.log('Starting role user seed...');

  const password = process.env.SEED_USERS_PASSWORD;
  const domain = (process.env.SEED_USERS_DOMAIN?.trim() || 'example.com').toLowerCase();

  if (!password || password.length < 8) {
    throw new Error('SEED_USERS_PASSWORD (minimum 8 characters) is required');
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new Error(`SEED_USERS_DOMAIN is not a valid domain: ${domain}`);
  }

  const hashedPassword = await hash(password, 10);
  const results = [];

  for (const { role, name, emailLocal } of ROLE_USERS) {
    const email = `${emailLocal}@${domain}`;
    const existing = await prisma.user.findUnique({ where: { email } });
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name,
        role,
        isActive: true,
      },
      create: {
        email,
        password: hashedPassword,
        name,
        role,
        isActive: true,
      },
      select: { email: true, name: true, role: true, isActive: true },
    });

    results.push({ ...user, action: existing ? 'updated' : 'created' });
  }

  console.table(
    results.map(({ email, name, role, isActive, action }) => ({
      action,
      email,
      name,
      role,
      isActive,
    }))
  );

  const created = results.filter((r) => r.action === 'created').length;
  const updated = results.filter((r) => r.action === 'updated').length;
  console.log(`Created ${created} user(s), updated ${updated} user(s)`);
  console.log('Operational data was not modified.');
  console.log('Role user seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
