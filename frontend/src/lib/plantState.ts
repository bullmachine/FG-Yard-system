import type { BadgeProps } from '@/components/ui/Badge';

/**
 * Labels for the plant's operation state (`end_state_cd`). Only
 * INSPECTION-COMPLETED counts a stage as done; an unknown code is shown as sent.
 */
const PLANT_STATES: Record<string, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  'INSPECTION-COMPLETED': { label: 'Inspection completed', variant: 'green' },
  'IN-INSPECTION': { label: 'In inspection', variant: 'purple' },
  RUN: { label: 'Running', variant: 'blue' }
};

export function plantStateMeta(state: string | null | undefined) {
  if (!state) return null;
  return PLANT_STATES[state] ?? { label: state, variant: 'gray' as const };
}
