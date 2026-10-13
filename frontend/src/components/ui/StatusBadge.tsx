import Badge, { type BadgeProps } from './Badge';

type MachineStatus = 'AVAILABLE' | 'SOLD' | 'RESERVED' | 'UNDER_INSPECTION' | 'IN_REPAIR' | 'DISPATCHED';
type SlotStatus = 'AVAILABLE' | 'OCCUPIED' | 'DISPATCH_READY' | 'INSPECTION' | 'BLOCKED' | 'RESERVED' | 'MAINTENANCE';
type ParkStatus = 'PLANNED' | 'READY_TO_MOVE' | 'IN_TRANSIT' | 'AT_GATE' | 'PARKED_PENDING' | 'PARKED_VERIFIED' | 'PARKED_REJECTED' | 'EXITED';
type ModelStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

const machineStatusConfig: Record<MachineStatus, { variant: BadgeProps['variant']; label: string }> = {
  AVAILABLE: { variant: 'green', label: 'Available' },
  SOLD: { variant: 'red', label: 'Sold' },
  RESERVED: { variant: 'amber', label: 'Reserved' },
  UNDER_INSPECTION: { variant: 'blue', label: 'Under Inspection' },
  IN_REPAIR: { variant: 'orange', label: 'In Repair' },
  DISPATCHED: { variant: 'gray', label: 'Dispatched' },
};

const slotStatusConfig: Record<SlotStatus, { variant: BadgeProps['variant']; label: string }> = {
  AVAILABLE: { variant: 'green', label: 'Available' },
  OCCUPIED: { variant: 'red', label: 'Occupied' },
  DISPATCH_READY: { variant: 'blue', label: 'Dispatch Ready' },
  INSPECTION: { variant: 'amber', label: 'Inspection' },
  BLOCKED: { variant: 'gray', label: 'Blocked' },
  RESERVED: { variant: 'amber', label: 'Reserved' },
  MAINTENANCE: { variant: 'orange', label: 'Maintenance' },
};

const parkStatusConfig: Record<ParkStatus, { variant: BadgeProps['variant']; label: string }> = {
  PLANNED: { variant: 'gray', label: 'Planned' },
  READY_TO_MOVE: { variant: 'indigo', label: 'Ready to Move' },
  IN_TRANSIT: { variant: 'blue', label: 'In Transit' },
  AT_GATE: { variant: 'purple', label: 'At Gate' },
  PARKED_PENDING: { variant: 'amber', label: 'Pending Verify' },
  PARKED_VERIFIED: { variant: 'green', label: 'Parked' },
  PARKED_REJECTED: { variant: 'red', label: 'Rejected' },
  EXITED: { variant: 'gray', label: 'Exited' },
};


const modelStatusConfig: Record<ModelStatus, { variant: BadgeProps['variant']; label: string }> = {
  PENDING: { variant: 'amber', label: 'Pending' },
  ACTIVE: { variant: 'green', label: 'Active' },
  INACTIVE: { variant: 'gray', label: 'Inactive' }
};

export function MachineStatusBadge({ status }: { status: string }) {
  const config = machineStatusConfig[status as MachineStatus] || { variant: 'gray' as const, label: status };
  return <Badge variant={config.variant} dot>{config.label}</Badge>;
}

export function SlotStatusBadge({ status }: { status: string }) {
  const config = slotStatusConfig[status as SlotStatus] || { variant: 'gray' as const, label: status };
  return <Badge variant={config.variant} dot>{config.label}</Badge>;
}

export function ParkStatusBadge({ status }: { status: string }) {
  const config = parkStatusConfig[status as ParkStatus] || { variant: 'gray' as const, label: status };
  return <Badge variant={config.variant} dot>{config.label}</Badge>;
}

export function AssemblyStageBadge({ stage }: { stage: number }) {
  if (stage === 0) return <Badge variant="gray">Not Started</Badge>;
  if (stage >= 18) return <Badge variant="green" dot>Complete</Badge>;
  return <Badge variant="blue">Stage {stage}/18</Badge>;
}

// Review state of a Vehicle Model Master row. Purely a label: no routing or assignment
// decision reads it, so it cannot change where a machine goes.
export function ModelStatusBadge({ status }: { status: string }) {
  const config = modelStatusConfig[status as ModelStatus] || { variant: 'gray' as const, label: status };
  return <Badge variant={config.variant} dot>{config.label}</Badge>;
}
