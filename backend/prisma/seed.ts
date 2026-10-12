import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Administrator';

  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || !adminPassword || adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (minimum 8 characters) are required');
  }

  // Clean existing data
  await prisma.securityVerification.deleteMany();
  await prisma.gateLog.deleteMany();
  await prisma.movement.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.yard.deleteMany();
  await prisma.fertCategory.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();
  console.log('Cleared existing data');

  // Create admin user
  const hashedPassword = await hash(adminPassword, 10);
  const adminUser = await prisma.user.create({
    data: {
      email: adminEmail,
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
    },
  });
  console.log('Created admin user');

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
  for (const yard of yards) {
    const slots = [];
    for (let row = 0; row < yard.rows; row++) {
      for (let col = 0; col < yard.cols; col++) {
        const zone = String.fromCharCode(65 + row); // A, B, C, etc.
        
        const slot = await prisma.slot.create({
          data: {
            yardId: yard.id,
            row: row + 1,
            col: col + 1,
            zone,
            status: 'AVAILABLE',
          },
        });
        slots.push(slot);
      }
    }
    console.log(`Created ${slots.length} slots for ${yard.name}`);
  }

  // Create FERT categories
  const fertCategories = await Promise.all([
    prisma.fertCategory.create({
      data: {
        code: 'SKID',
        name: 'SKID Type',
        priority: 1,
        preferredYardId: yards[0].id,
      },
    }),
    prisma.fertCategory.create({
      data: {
        code: 'SUPER SMART 76',
        name: 'Super Smart 76',
        priority: 2,
        preferredYardId: yards[0].id,
      },
    }),
    prisma.fertCategory.create({
      data: {
        code: 'STANDARD',
        name: 'Standard',
        priority: 3,
        preferredYardId: yards[1].id,
      },
    }),
  ]);

  console.log(`Created ${fertCategories.length} FERT categories`);

  // Create drivers
  const drivers = await Promise.all([
    prisma.driver.create({
      data: {
        name: 'Ahmed Mohammed',
        phone: '+966501234567',
        licenseNo: 'DL-001',
        employeeCode: 'BIO-001',
        status: 'AVAILABLE',
      },
    }),
    prisma.driver.create({
      data: {
        name: 'Ali Hassan',
        phone: '+966502345678',
        licenseNo: 'DL-002',
        employeeCode: 'BIO-002',
        status: 'AVAILABLE',
      },
    }),
    prisma.driver.create({
      data: {
        name: 'Omar Khan',
        phone: '+966503456789',
        licenseNo: 'DL-003',
        employeeCode: 'BIO-003',
        status: 'ON_TRIP',
      },
    }),
  ]);

  console.log(`Created ${drivers.length} drivers`);

  // Create machines at various assembly stages
  const machineData = [
    // Stage 1 - Just started
    {
      serialNumber: 'HDSS7243',
      barcode: '28002951',
      model: 'SS76',
      orderNo: '000012739824',
      productionOrderId: '2762228',
      itemCode: '8004645',
      itemDescription: 'SS76-BHL-4WD-FC-BS5-3SPL-IND-6IN1-0.33',
      assemblyStage: 1,
      parkStatus: 'PLANNED' as const,
    },
    // Stage 5 - In progress
    {
      serialNumber: 'SSL1573',
      barcode: '28032728',
      model: 'BULL',
      orderNo: '000012754928',
      productionOrderId: '2776367',
      itemCode: '8004006',
      itemDescription: 'BULL SKID AV 490 NAC STD BKT SAUDI',
      fertCategory: 'SKID',
      assemblyStage: 5,
      parkStatus: 'PLANNED' as const,
    },
    // Stage 13 - Ready for location assignment
    {
      serialNumber: 'SSL1575',
      barcode: '28032726',
      model: 'BULL',
      orderNo: '000012754932',
      productionOrderId: '2776371',
      itemCode: '8004006',
      itemDescription: 'BULL SKID AV 490 NAC STD BKT SAUDI',
      fertCategory: 'SKID',
      assemblyStage: 13,
      parkStatus: 'PLANNED' as const,
    },
    // Stage 18 - Completed, ready for driver
    {
      serialNumber: 'SSL1576',
      barcode: '28032725',
      model: 'BULL',
      orderNo: '000012754933',
      productionOrderId: '2776372',
      itemCode: '8004006',
      itemDescription: 'BULL SKID AV 490 NAC STD BKT SAUDI',
      fertCategory: 'SKID',
      assemblyStage: 18,
      parkStatus: 'READY_TO_MOVE' as const,
    },
    // Stage 18 - Ready to move
    {
      serialNumber: 'HD7220',
      barcode: '28032700',
      model: 'SD76',
      orderNo: '000012821905',
      productionOrderId: '2841978',
      itemCode: '8004758',
      itemDescription: 'SD76-FEL-4WD-IND-HC-RCS-STD BKT',
      fertCategory: 'SUPER SMART 76',
      assemblyStage: 18,
      parkStatus: 'READY_TO_MOVE' as const,
    },
  ];

  const machines = [];
  for (const data of machineData) {
    const machine = await prisma.machine.create({
      data: {
        ...data,
        productionDate: new Date('2026-05-14'),
        status: 'AVAILABLE',
      },
    });
    machines.push(machine);
  }

  console.log(`Created ${machines.length} machines`);

  // Create some sample movements
  const allSlots = await prisma.slot.findMany({
    take: 5,
    orderBy: { row: 'asc' },
  });

  for (let i = 0; i < Math.min(3, machines.length); i++) {
    if (allSlots[i]) {
      // Assign first 3 machines to slots
      await prisma.machine.update({
        where: { id: machines[i].id },
        data: { currentSlotId: allSlots[i].id },
      });

      await prisma.slot.update({
        where: { id: allSlots[i].id },
        data: { status: 'OCCUPIED' },
      });

      await prisma.movement.create({
        data: {
          machineId: machines[i].id,
          yardId: yards[0].id,
          toSlotId: allSlots[i].id,
          userId: adminUser.id,
          reason: 'PRODUCTION',
          notes: 'Initial allocation',
        },
      });
    }
  }

  console.log('Created sample movements');
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
