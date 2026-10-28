import {
  AlertCircle,
  BookOpen,
  Factory,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SectionCard, StatCard } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';

interface FlowStep {
  title: string;
  actor: string;
  description: string;
  outcome: string;
}

interface Guardrail {
  title: string;
  description: string;
}

interface RoleRow {
  role: string;
  modules: string;
  permissions: string;
}

interface VisibilityRow {
  view: string;
  roles: string;
  detail: string;
}

const auditVisibility: VisibilityRow[] = [
  { view: 'Movements tab', roles: 'Admin, Yard Manager, Operator, Security', detail: 'Every recorded movement, including allocations, removals and gate entries' },
  { view: 'Parking tab', roles: 'Admin, Yard Manager, Operator, Security', detail: 'The same records narrowed to yard entries, badged as such' },
  { view: 'Verifications tab', roles: 'Admin, Yard Manager, Security', detail: 'Every approve or reject, with the guard, the slot and their comments' },
  { view: 'Recent Verifications panel', roles: 'Admin, Yard Manager, Security', detail: 'The last 8 decisions, shown under the security queue' },
  { view: 'Recent Parking Activity panel', roles: 'Everyone with Confirm Parking except Driver', detail: 'The last 8 parking records, hidden from drivers so they never see other drivers\u2019 activity' },
  { view: 'Machine history modal', roles: 'Follows the tabs above', detail: 'Stages, Movements and Parking per machine, plus Security for that one machine' },
];

interface NotificationRow {
  event: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  trigger: string;
  audience: string;
  opens: string;
}

const SEVERITY_VARIANT: Record<NotificationRow['severity'], 'red' | 'amber' | 'blue'> = {
  CRITICAL: 'red',
  WARNING: 'amber',
  INFO: 'blue',
};

const machineFlow: FlowStep[] = [
  {
    title: 'Production data sync',
    actor: 'Scheduler / Admin',
    description: 'Machine records are pulled from the material master on a schedule or on demand from the Assembly Line screen.',
    outcome: 'Records appear on the assembly board',
  },
  {
    title: 'Assembly stages 1 to 18',
    actor: 'Operator / Admin',
    description: 'Each machine is tracked through the numbered assembly stages until it reaches stage 18.',
    outcome: 'Machine is ready for location assignment',
  },
  {
    title: 'Slot assignment at gate (IN)',
    actor: 'Operator / Yard Manager / Admin',
    description: 'When the driver and machine reach the gate for inward entry, the gate assigns an available slot automatically. If all yards are full, entry is rejected with a visible reason. An operator may override by selecting a specific slot from the suggested list.',
    outcome: 'Machine has a yard slot for inward entry',
  },
  {
    title: 'Driver assignment',
    actor: 'Yard Manager / Admin',
    description: 'A driver is linked to the machine for dispatch and gate release.',
    outcome: 'Machine is ready to leave the yard',
  },
  {
    title: 'Barcode check',
    actor: 'System',
    description: 'Reaching stage 18 is not enough on its own. A machine is released to the yard only when it is at stage 18 or later and has a barcode, because the gate authenticates against that barcode.',
    outcome: 'Barcode-less machines stay Planned and raise a critical alert',
  },
  {
    title: 'Gate authentication',
    actor: 'Operator / Yard Manager / Admin',
    description: 'The driver is identified by scanning their employee-code badge, then the machine or barcode is verified before the barrier is opened. The screen is scan-first: a scanned barcode selects the machine and shows its stage and status; for inward, the gate proposes a slot and allows manual override. If no slot exists, entry is rejected. Camera scanning supports both fields.',
    outcome: 'Authorized requests open the barrier; every attempt is logged',
  },
  {
    title: 'Driver parking confirmation',
    actor: 'Driver, or yard staff on their behalf',
    description: 'The driver confirms the machine is physically standing in its assigned slot. A Yard Manager or Operator may record this for the driver, and the override is written into the movement notes.',
    outcome: 'Machine becomes Parked Pending and joins the security queue',
  },
  {
    title: 'Security verification',
    actor: 'Security / Admin',
    description: 'Parked machines are reviewed and either approved or rejected based on the parking check. If an Administrator switches the security check off in Settings, parking confirmation verifies the machine automatically and the auto-verification is recorded.',
    outcome: 'Machine becomes PARKED_VERIFIED or is returned to the yard',
  },
  {
    title: 'Dispatch planning',
    actor: 'Dispatch Planner / Yard Manager / Admin',
    description: 'The planner enters a quantity per model-type. The oldest free machines (FIFO by first inward date) are picked when the plan is saved; a plan larger than the free stock is refused. There is no approval step.',
    outcome: 'Machines appear on the Dispatch Machine List and stop counting as free stock',
  },
  {
    title: 'PDI and FG gate-out',
    actor: 'PDI Team / Operator',
    description: 'The PDI team may assign a driver and prints the slip. The driver takes the machine out through the FG gate with no exit request; the slot is freed on scan-out.',
    outcome: 'Machine is out of the FG yard and waiting for the main gate',
  },
  {
    title: 'Main gate out',
    actor: 'Main Gate (user, or the main gate system through the API)',
    description: 'The main gate marks the machine out of the plant. A machine still waiting after the set hours is alerted and e-mailed to the production manager.',
    outcome: 'Dispatch is complete',
  },
  {
    title: 'Movement history',
    actor: 'System',
    description: 'Allocations, movements, and gate events are recorded for audit and traceability.',
    outcome: 'History is available in Movement History',
  },
];

const userFlow: FlowStep[] = [
  {
    title: 'Self-registration',
    actor: 'Visitor',
    description: 'A name, email, and password of at least 8 characters are submitted from the public registration page.',
    outcome: 'An active account is created with View Only access',
  },
  {
    title: 'Sign in',
    actor: 'User',
    description: 'Email and password are verified and a session token is issued for the account.',
    outcome: 'Access to the modules allowed by the assigned role',
  },
  {
    title: 'Admin creates an account',
    actor: 'Administrator',
    description: 'An administrator creates a user and chooses the initial role from the supported roles.',
    outcome: 'The user appears in User Management',
  },
  {
    title: 'Role assignment',
    actor: 'Administrator',
    description: 'The role is changed to match the responsibilities of the user.',
    outcome: 'New permissions apply on the next authenticated request',
  },
  {
    title: 'Password reset',
    actor: 'Administrator',
    description: 'An administrator sets a new password of at least 8 characters without deleting the account or its history.',
    outcome: 'The next sign-in uses the new password',
  },
  {
    title: 'Activate or deactivate',
    actor: 'Administrator',
    description: 'An account is switched off without deleting it, so its history and references stay intact.',
    outcome: 'Inactive users are blocked from signing in and from existing sessions',
  },
];

const guardrails: Guardrail[] = [
  {
    title: 'Role changes are immediate',
    description: 'The role is read from the database on every authenticated request, so a change applies without waiting for a token to expire.',
  },
  {
    title: 'Inactive accounts are blocked',
    description: 'Deactivated users cannot sign in, and any existing session is rejected on its next request.',
  },
  {
    title: 'Self-protection',
    description: 'An administrator cannot change their own role or deactivate their own account.',
  },
  {
    title: 'Last admin protection',
    description: 'The system refuses to remove or demote the final active administrator.',
  },
  {
    title: 'Unique accounts',
    description: 'Email addresses are unique, and passwords must be at least 8 characters.',
  },
];

const yardGuardrails: Guardrail[] = [
  {
    title: 'Release needs a barcode',
    description: 'A machine is released to the yard only when it is at stage 18 or later and has a non-empty barcode. A barcode-less machine stays Planned and raises a critical alert, because the gate has nothing to authenticate it against.',
  },
  {
    title: 'Barcode and machine must agree',
    description: 'A scanned barcode that does not match the selected machine is refused, so a mis-scan cannot be forced through by picking the machine by hand.',
  },
  {
    title: 'Stage 18 is the floor',
    description: 'A machine below stage 18 is refused at the gate even if it already holds a slot, so a machine cannot be pulled out of assembly early.',
  },
  {
    title: 'The assigned slot must still be held',
    description: 'The gate requires an assigned slot and requires the reservation to still exist, so a machine is never sent to a slot that has since been freed or given to someone else.',
  },
  {
    title: 'Only the assigned driver confirms parking',
    description: 'Parking is confirmed by the driver linked to that machine. An Admin, Yard Manager or Operator may record it on the driver\u2019s behalf, and the override is written into the movement notes.',
  },
  {
    title: 'A rejection keeps the same slot',
    description: 'A rejected machine is re-parked in the same slot, so the slot it occupies never changes across a rejection.',
  },
  {
    title: 'Only parked machines can be verified',
    description: 'Security can act on a Pending or Rejected machine; an in-transit machine has nothing to verify. Approval changes only the park status and never the commercial status, so it cannot un-sell a machine.',
  },
  {
    title: 'A machine in the yard cannot come in again',
    description: 'Gate inward refuses a machine that is already parked (pending, rejected or verified) or released for exit. A machine still in transit keeps its slot when scanned again.',
  },
  {
    title: 'Only planned or approved machines go out',
    description: 'FG gate outward accepts only machines planned for dispatch (parked and verified in a slot) or machines with an approved exit request.',
  },
  {
    title: 'Returned after dispatch is held',
    description: 'A machine that comes back after dispatch is put on hold and is not free stock until an Administrator or Yard Manager clears it with a remark. Machines back from inspection or repair return to stock directly. FIFO age always counts from the first inward.',
  },
  {
    title: 'The recorder is the signed-in user',
    description: 'Movements and security decisions take their author from the authenticated session rather than from the form, so the audit trail always names a real person.',
  },
];

const roleRows: RoleRow[] = [
  { role: 'Administrator', modules: 'All modules, including User Management and Settings', permissions: 'Manages users, assigns roles, activates or deactivates accounts, and configures upstream endpoints and sync schedules' },
  { role: 'Yard Manager', modules: 'Yards, yard stock, dispatch, machines, assembly, masters, drivers, gate, confirm parking, history', permissions: 'Allocates locations and drivers, authenticates at the gate, records parking on a driver\u2019s behalf' },
  { role: 'Operator', modules: 'Dashboard, yards, machines, assembly, gate, confirm parking, history', permissions: 'Creates machines, advances assembly stages, records parking on a driver\u2019s behalf' },
  { role: 'Service Technician', modules: 'Dashboard, machines, history', permissions: 'Read-only machine tracking and history' },
  { role: 'Security', modules: 'Dashboard, security verification, history', permissions: 'Approves or rejects parked machines' },
  { role: 'View Only', modules: 'Dashboard, yards, machines', permissions: 'Read-only access' },
  { role: 'Driver', modules: 'Dashboard, confirm parking', permissions: 'Confirms that their own assigned machine is parked in its slot' },
  { role: 'Dispatch Planner', modules: 'Dashboard, yard stock, dispatch planning, dispatch machine list', permissions: 'Plans machines for dispatch by model-type and cancels them until they leave the FG yard' },
  { role: 'PDI Team', modules: 'Dashboard, dispatch machine list', permissions: 'Assigns drivers to planned machines and prints the slip' },
  { role: 'Main Gate', modules: 'Dispatch machine list', permissions: 'Marks machines out of the main gate, or undoes a wrong mark' },
];

const notificationRows: NotificationRow[] = [
  {
    event: 'Yard is full',
    severity: 'CRITICAL',
    trigger: 'Stage 13 auto-assignment finds no free slot in the preferred yard and none in any yard',
    audience: 'Yard Manager, Administrator',
    opens: 'FG Yard',
  },
  {
    event: 'Sync failed',
    severity: 'CRITICAL',
    trigger: 'A production or material master sync returns a real error, on the schedule or run manually',
    audience: 'Administrator',
    opens: 'Assembly Line / Material Master',
  },
  {
    event: 'Gate rejected',
    severity: 'CRITICAL',
    trigger: 'Driver not found, machine not found, barcode does not match the selected machine, machine is below stage 18, machine has no barcode, no assigned slot, or the assigned slot is no longer reserved',
    audience: 'Security, Yard Manager',
    opens: 'Gate Control',
  },
  {
    event: 'Barcode missing',
    severity: 'CRITICAL',
    trigger: 'A machine reaches stage 18 or later with an empty barcode, so it cannot be released to the yard',
    audience: 'Yard Manager, Administrator',
    opens: 'Assembly Line',
  },
  {
    event: 'New registration',
    severity: 'INFO',
    trigger: 'Someone self-registers and is active with View Only access',
    audience: 'Administrator',
    opens: 'User Management',
  },
  {
    event: 'Ready to move',
    severity: 'INFO',
    trigger: 'A sync sees a machine at stage 18 or later that is still Planned and has a barcode, and flags it ready. Fires once per machine',
    audience: 'Yard Manager',
    opens: 'Assembly Line',
  },
  {
    event: 'Security review needed',
    severity: 'WARNING',
    trigger: 'A machine is parked into a slot and is flagged Pending Verify',
    audience: 'Security',
    opens: 'Security Verification',
  },
  {
    event: 'Parking not confirmed',
    severity: 'WARNING',
    trigger: 'A machine is still In Transit longer than the set minutes after gate in (30 by default). Fires once per trip',
    audience: 'Yard Manager, Administrator, Operator, and the driver',
    opens: 'Confirm Parking',
  },
  {
    event: 'Returned after dispatch',
    severity: 'WARNING',
    trigger: 'A dispatched machine is checked in at the gate again and put on hold',
    audience: 'Yard Manager, Administrator, Dispatch Planner',
    opens: 'Yard Stock',
  },
  {
    event: 'Dispatch planned',
    severity: 'INFO',
    trigger: 'A dispatch plan is saved',
    audience: 'PDI Team, Yard Manager',
    opens: 'Dispatch Machine List',
  },
  {
    event: 'Dispatch overdue',
    severity: 'WARNING',
    trigger: 'A machine is out of the FG yard longer than the set hours without main gate out (8 by default). Also e-mailed to the production manager',
    audience: 'Yard Manager, Administrator, PDI Team, Main Gate',
    opens: 'Dispatch Machine List',
  },
];

function FlowList({ steps, accent }: { steps: FlowStep[]; accent: 'blue' | 'indigo' }) {
  const numberClass = accent === 'blue' ? 'bg-blue-600' : 'bg-indigo-600';

  return (
    <ol>
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${numberClass}`}>
              {index + 1}
            </span>
            {index < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
          </div>
          <div className="pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-slate-900">{step.title}</p>
              <Badge variant="gray">{step.actor}</Badge>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{step.description}</p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">Result: {step.outcome}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function GuardrailGrid({ items }: { items: Guardrail[] }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {items.map((guardrail) => (
        <div key={guardrail.title} className="flex gap-2.5 rounded-lg border border-slate-200 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{guardrail.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{guardrail.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProcessFlowDocument() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Process Flow"
        description="How machines and user accounts move through FG Yard"
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatCard label="Assembly stages" value={18} icon={<Factory className="w-4 h-4" />} color="indigo" hint="Machine lifecycle" />
        <StatCard label="Account roles" value={7} icon={<UserCog className="w-4 h-4" />} color="blue" hint="Least-privilege access" />
        <StatCard label="Docs audience" value="All signed-in" icon={<BookOpen className="w-4 h-4" />} color="slate" hint="Read-only reference" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Machine Lifecycle" description="From production sync to verified parking">
          <FlowList steps={machineFlow} accent="blue" />
        </SectionCard>
        <SectionCard title="User and Access Lifecycle" description="From registration to role and status management">
          <FlowList steps={userFlow} accent="indigo" />
        </SectionCard>
      </div>

      <SectionCard title="Access Guardrails" description="Rules the backend enforces on accounts automatically">
        <GuardrailGrid items={guardrails} />
      </SectionCard>

      <SectionCard title="Gate and Parking Guardrails" description="Rules that decide whether a machine can move">
        <GuardrailGrid items={yardGuardrails} />
      </SectionCard>

      <SectionCard title="Role Reference" description="What each role can reach in the sidebar">
        <Table>
          <TableHeader>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Modules</TableHeaderCell>
            <TableHeaderCell>Key capabilities</TableHeaderCell>
          </TableHeader>
          <TableBody>
            {roleRows.map((row) => (
              <TableRow key={row.role}>
                <TableCell>
                  <Badge variant={row.role === 'Administrator' ? 'indigo' : row.role === 'View Only' ? 'gray' : 'blue'}>
                    {row.role}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.modules}</TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.permissions}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard title="Notifications" description="Who is alerted, what causes the alert, and where it takes you">
        <Table>
          <TableHeader>
            <TableHeaderCell>Alert</TableHeaderCell>
            <TableHeaderCell>Severity</TableHeaderCell>
            <TableHeaderCell>Raised when</TableHeaderCell>
            <TableHeaderCell>Notified roles</TableHeaderCell>
            <TableHeaderCell>Opens</TableHeaderCell>
          </TableHeader>
          <TableBody>
            {notificationRows.map((row) => (
              <TableRow key={row.event}>
                <TableCell>
                  <Badge variant="indigo">{row.event}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={SEVERITY_VARIANT[row.severity]}>{row.severity}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.trigger}</TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.audience}</TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-500">{row.opens}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Recipients are chosen by role rather than by named person, so a new Yard Manager starts
          receiving yard alerts automatically. Every active user in a listed role gets their own
          alert. The same alert repeats at most once per 15 minutes per person, so a frequent
          schedule cannot flood the bell. Critical alerts also appear as an on-screen toast; all
          severities show in the bell and on the Notifications page. A sync failure reports how many
          errors occurred but shows the first one only, so the remaining detail is in the backend
          logs. Alerts are pushed live over a WebSocket, and the full list is re-fetched whenever that
          connection is re-established, so nothing is lost while a machine was offline. Read alerts
          are removed after 30 days, but unread alerts are never deleted. Days with no published
          orders are not treated as failures.
        </p>
      </SectionCard>

      <SectionCard title="Audit History" description="Where the record of what happened can be read">
        <p className="text-xs leading-relaxed text-slate-600">
          The History screen has three tabs, each backed by a filtered, server-paginated endpoint, so
          the result stays correct as the movement table grows. Movements holds everything, Parking
          is the same list narrowed to yard entries, and Verifications holds the security decisions.
          Rows show 15 at a time and can be narrowed by machine and date range.
        </p>
        <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
          Every movement names who recorded it, taken from the signed-in session rather than from the
          form. A row is tagged <span className="font-semibold text-slate-700">Driver</span> when the
          author is the machine&rsquo;s linked driver account and{' '}
          <span className="font-semibold text-slate-700">Yard office</span> when a member of staff
          recorded it, so a parking log shows who was actually at the slot. Where the record is read
          from depends on the role:
        </p>
        <Table>
          <TableHeader>
            <TableHeaderCell>Where you look</TableHeaderCell>
            <TableHeaderCell>Who can see it</TableHeaderCell>
            <TableHeaderCell>What it shows</TableHeaderCell>
          </TableHeader>
          <TableBody>
            {auditVisibility.map((row) => (
              <TableRow key={row.view}>
                <TableCell className="whitespace-normal text-[13px] font-semibold text-slate-900">{row.view}</TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.roles}</TableCell>
                <TableCell className="whitespace-normal text-xs text-slate-600">{row.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          The history endpoints require a valid session and are role-gated on the server, so hiding a
          tab in the interface is a convenience and not the point of enforcement.
        </p>
      </SectionCard>

      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-1 text-xs text-amber-800">
          <p className="font-semibold">Current behavior to be aware of</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Self-registration is immediately active with View Only access. There is no approval or pending state.</li>
            <li>A machine that reaches stage 18 without a barcode is held in Planned and raises a critical alert rather than being released. It is not offered at the gate, and it moves on by itself once a later sync supplies the barcode.</li>
            <li>A password reset changes the credential but does not revoke session tokens that were already issued; those remain valid until they expire or the account is deactivated.</li>
            <li>A gate check that succeeds raises no alert. The machine is set to In Transit silently, and Security is alerted only if the check is rejected, or later when the machine is parked into a slot. Nothing is sent between those two moments.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
