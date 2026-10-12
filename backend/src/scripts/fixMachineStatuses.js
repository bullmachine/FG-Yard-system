const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixMachineStatuses() {
  try {
    console.log('Finding machines with empty status...');
    
    // Update machines with empty status to AVAILABLE using raw SQL
    const result = await prisma.$executeRaw`
      UPDATE Machine 
      SET status = 'AVAILABLE' 
      WHERE status = '' OR status IS NULL
    `;
    
    console.log(`Updated ${result} machines with empty/null status to AVAILABLE`);
    console.log('Machine status fix completed successfully');
  } catch (error) {
    console.error('Error fixing machine statuses:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixMachineStatuses();
