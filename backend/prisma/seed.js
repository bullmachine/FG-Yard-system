let prisma;

async function main() {
  const [{ PrismaClient }, { hash }] = await Promise.all([
    import('@prisma/client'),
    import('bcryptjs'),
  ]);

  prisma = new PrismaClient();
  console.log('Starting seed...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Administrator';

  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || !adminPassword || adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (minimum 8 characters) are required');
  }

  // Clean existing data
  await prisma.movement.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.yard.deleteMany();
  console.log('Cleared existing data');

  // Create sample yards
  const yards = await Promise.all([
    prisma.yard.create({
      data: {
        name: 'Production Yard A',
        description: 'Main production yard for finished vehicles',
        rows: 5,
        cols: 8,
      },
    }),
    prisma.yard.create({
      data: {
        name: 'Dispatch Yard B',
        description: 'Dispatch ready vehicles yard',
        rows: 4,
        cols: 6,
      },
    }),
    prisma.yard.create({
      data: {
        name: 'Inspection Yard C',
        description: 'Quality inspection area',
        rows: 3,
        cols: 5,
      },
    }),
  ]);

  console.log(`Created ${yards.length} yards`);

  // Create slots for each yard
  const slotStatuses = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'];
  const machinePrefixes = ['BH', 'BL', 'BR', 'BM'];

  for (const yard of yards) {
    const slots = [];
    for (let row = 0; row < yard.rows; row++) {
      for (let col = 0; col < yard.cols; col++) {
        const status = slotStatuses[Math.floor(Math.random() * slotStatuses.length)];
        const zone = String.fromCharCode(65 + row); // A, B, C, etc.
        
        const slot = await prisma.slot.create({
          data: {
            yardId: yard.id,
            row: row + 1,
            col: col + 1,
            zone,
            status,
          },
        });
        slots.push(slot);
      }
    }
    console.log(`Created ${slots.length} slots for ${yard.name}`);
  }

  // Create sample machines
  const machines = [];
  const allSlots = await prisma.slot.findMany({
    where: {
      status: {
        in: ['OCCUPIED'],
      },
    },
  });

  for (let i = 0; i < allSlots.length; i++) {
    const slot = allSlots[i];
    const prefix = machinePrefixes[Math.floor(Math.random() * machinePrefixes.length)];
    const serialNumber = `${prefix}-${1000 + i}`;
    const model = ['SD76', 'SD80', 'SD90', 'SD100'][Math.floor(Math.random() * 4)];

    const machine = await prisma.machine.create({
      data: {
        serialNumber,
        model,
        productionDate: new Date('2024-01-01'),
        status: 'AVAILABLE',
        currentSlotId: slot.id,
      },
    });
    machines.push(machine);
  }

  console.log(`Created ${machines.length} machines`);

  // Create a demo admin user for movements
  const hashedPassword = await hash(adminPassword, 10);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email: adminEmail,
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
    },
  });

  console.log('Ensured admin user');

  // Create some movement history
  const movements = [];
  for (let i = 0; i < 20; i++) {
    const machine = machines[Math.floor(Math.random() * machines.length)];
    const fromSlot = await prisma.slot.findFirst({
      where: { yardId: yards[0].id },
    });
    const toSlot = await prisma.slot.findFirst({
      where: { yardId: yards[Math.floor(Math.random() * yards.length)].id },
    });

    if (fromSlot && toSlot && fromSlot.id !== toSlot.id) {
      const movement = await prisma.movement.create({
        data: {
          machineId: machine.id,
          yardId: yards[0].id,
          fromSlotId: fromSlot.id,
          toSlotId: toSlot.id,
          userId: user.id,
          reason: 'RELOCATION',
          notes: `Sample movement ${i + 1}`,
        },
      });
      movements.push(movement);
    }
  }

  console.log(`Created ${movements.length} movement records`);
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
