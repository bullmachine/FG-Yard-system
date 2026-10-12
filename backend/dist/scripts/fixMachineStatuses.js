"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../lib/prisma"));
async function fixMachineStatuses() {
    try {
        console.log('Finding machines with empty status...');
        // Update machines with empty status to AVAILABLE using raw SQL
        const result = await prisma_1.default.$executeRaw `
      UPDATE Machine 
      SET status = 'AVAILABLE' 
      WHERE status = '' OR status IS NULL
    `;
        console.log(`Updated ${result} machines with empty/null status to AVAILABLE`);
        console.log('Machine status fix completed successfully');
    }
    catch (error) {
        console.error('Error fixing machine statuses:', error);
        process.exit(1);
    }
    finally {
        await prisma_1.default.$disconnect();
    }
}
fixMachineStatuses();
