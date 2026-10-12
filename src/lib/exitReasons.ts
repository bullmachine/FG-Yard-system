export const EXIT_REASON_OPTIONS = [
  { value: 'DISPATCH', label: 'Dispatch' },
  { value: 'INSPECTION', label: 'Testing / Inspection' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'RELOCATION', label: 'Relocation' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
];

export function exitReasonLabel(reason: string): string {
  return EXIT_REASON_OPTIONS.find((o) => o.value === reason)?.label || reason.replace(/_/g, ' ');
}