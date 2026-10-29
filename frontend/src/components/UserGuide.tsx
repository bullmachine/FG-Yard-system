'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import {
  Search, ChevronDown, ChevronRight, ArrowRight, LogIn, PanelLeft, LayoutDashboard, Bell, LogOut,
  Lightbulb, HelpCircle, UserCog, Route
} from 'lucide-react';

// Plain-language guide for every screen. Content is data so the page can filter
// it by the reader's role and by a search term. Keep it in step with the screens:
// when a screen changes, update its entry here.

interface ScreenGuide {
  tab: string;
  title: string;
  purpose: string;
  roles: string;
  steps: string[];
  tips?: string[];
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  YARD_MANAGER: 'Yard Manager',
  OPERATOR: 'Operator',
  SERVICE_TECHNICIAN: 'Service Technician',
  SECURITY: 'Security',
  VIEW_ONLY: 'View Only',
  DRIVER: 'Driver',
  PLANNER: 'Dispatch Planner',
  PDI: 'PDI Team',
  MAIN_GATE: 'Main Gate',
};

const ROLE_SUMMARY: Record<string, string> = {
  ADMIN: 'Full access: every screen, user accounts, settings and master data.',
  YARD_MANAGER: 'Runs the yard: slots, machines, master data, drivers, gate, exit approvals and returns.',
  OPERATOR: 'Day-to-day yard work: gate check-in/out, parking confirmation, machine tracking.',
  SERVICE_TECHNICIAN: 'Looks up machines, raises exit requests for testing or repair, and follows returns.',
  SECURITY: 'Checks machines in and out at the FG yard gate (Gate Control) and verifies parked machines.',
  VIEW_ONLY: 'Read-only view of the dashboard, yards and machines. Can raise exit requests.',
  DRIVER: 'Confirms when a machine has been parked in its slot.',
  PLANNER: 'Checks yard stock and plans machines for dispatch.',
  PDI: 'Assigns drivers to planned machines and prints the pick slip.',
  MAIN_GATE: 'Marks dispatched machines out of the main gate.',
};

const QUICK_START = [
  { icon: <LogIn className="w-4 h-4" />, title: 'Sign in', text: 'Open FG Yard and sign in with your work email and password. New users can register, but start with View Only access until an Administrator changes the role. Sign-ins are recorded (time, IP address and device) for security.' },
  { icon: <PanelLeft className="w-4 h-4" />, title: 'Use the menu', text: 'The left menu lists only the screens your role can open. On a phone or tablet, tap the ☰ button at the top left to open it. On a computer, use the arrow at the top of the menu to collapse it.' },
  { icon: <LayoutDashboard className="w-4 h-4" />, title: 'Start at the Dashboard', text: 'The Dashboard shows the FG yard today: stock, free slots, dispatch and a "Needs attention" list. Click any card to see the machines behind the number.' },
  { icon: <Bell className="w-4 h-4" />, title: 'Watch the bell', text: 'The bell at the top right shows alerts for your role (yard full, gate rejected, sync failed and so on). Critical alerts also pop up on screen. Open Notifications for the full list.' },
  { icon: <LogOut className="w-4 h-4" />, title: 'Sign out', text: 'Use the exit icon next to your name at the bottom of the menu. Always sign out on a shared gate or yard device.' },
];

const JOURNEY = [
  { step: 'Assembly', status: 'Stages 1–18', text: 'Production orders are read from the plant every morning. Each machine moves through 18 assembly stages.' },
  { step: 'Completed', status: 'Stage 18 done', text: 'When stage 18 is finished the machine appears under Assembly Line → Completed. It needs a barcode before it can leave the plant.' },
  { step: 'Ready to Move', status: 'READY TO MOVE', text: 'With a barcode, the machine is released and waits for a driver.' },
  { step: 'Gate In', status: 'IN TRANSIT', text: 'At the gate the driver badge and machine barcode are scanned. If authorized, the barrier opens and the driver is told which yard slot to go to.' },
  { step: 'Parked', status: 'PARKED PENDING', text: 'The driver (or the yard office) confirms the machine is in its slot.' },
  { step: 'Verified', status: 'PARKED VERIFIED', text: 'Security checks the machine is in the right slot and approves it. If rejected, the driver re-parks in the same slot and confirms again.' },
  { step: 'Dispatch', status: 'PLANNED → MAIN GATE OUT', text: 'The Dispatch Planner plans machines by model-type; the oldest free machines are picked (FIFO). The driver takes the machine out through FG gate-out, and the Main Gate marks it out of the plant.' },
  { step: 'Exit', status: 'AT GATE → EXITED', text: 'For testing, repair and other purposes, an exit request is raised and approved by a Yard Manager. The gate then checks it out. Machines that left for testing or repair show under Returns until they come back.' },
];

const SCREENS: ScreenGuide[] = [
  {
    tab: 'dashboard', title: 'Dashboard', roles: 'Everyone',
    purpose: 'A live summary of the FG yard: stock, inward, dispatch and slots. Assembly is not shown here; use Assembly Line for that.',
    steps: [
      'Read the top cards: machines in the FG yard, free stock, planned for dispatch, awaiting main gate, free slots, and today’s gate in, gate out and main gate out.',
      'Check "Needs attention" first: dispatch overdue at the main gate, parking not confirmed in time, parking rejected, machines returned after dispatch (on hold), yards full and pending exit requests. Each card opens its list or the screen that fixes it.',
      'Use "FG Yard Flow" to see how many machines are at each step, from Ready to Move to Main Gate Out. Click a step to list them.',
      '"Stock by Model-Type" shows, per model-type, the machines in the yard, free, planned and the age of the oldest free machine (red after 30 days). "Stock Age" groups all yard machines by days since first inward.',
      'Use "Quick Search" to find an FG yard machine by serial number, model, model-type or barcode, then click View for its location and movement history.',
      '"Yard Capacity" shows each yard’s free, reserved and occupied slots as a bar. The lists at the bottom show machines in transit, awaiting verification and awaiting the main gate.',
    ],
    tips: ['The page refreshes itself every minute and when new alerts arrive. The time of the last update is shown at the top right.', 'Overdue and parking alert times are the ones set by the Administrator in Settings.'],
  },
  {
    tab: 'yards', title: 'FG Yard', roles: 'Administrator, Yard Manager, Operator, View Only, Security (view only)',
    purpose: 'See every yard as a grid of slots, find a machine, and manage slots.',
    steps: [
      'Click a yard card to open its slot grid. Rows are letters (A, B, C…) and columns are numbers, so slot B5 is row B, column 5.',
      'Read the colours: green Available, yellow Reserved (held for an incoming machine), red Occupied, blue Dispatch Ready, amber Inspection, orange Maintenance, grey Blocked.',
      'Type a serial number or slot (for example A1) in the search box. The match is highlighted in the grid.',
      'Click a slot to see its machine, driver, park time and aging on the right.',
      'Administrators and Yard Managers can release a machine for exit (testing, repair, relocation or maintenance) and release a reservation (a reason is required).',
      'To take a free slot out of use for now (ground damage, waterlogging, maintenance), click it and press Block, with a reason. A blocked slot is grey and shows the reason, who and when. Press Unblock to put it back into use. A slot that is no longer used at all stays blocked.',
      'Administrators and Yard Managers create or edit yards with Create Yard / the pencil icon. Rows and columns can only be increased.',
    ],
    tips: ['On a phone, a large yard grid scrolls sideways. Swipe the grid left and right.', 'A red banner at the top means every yard is fully reserved and machines are waiting for space.'],
  },
  {
    tab: 'stock', title: 'Yard Stock', roles: 'Administrator, Yard Manager, Dispatch Planner, Operator, View Only',
    purpose: 'How many machines of each model-type are in the yard, and which one should be dispatched first (FIFO).',
    steps: [
      'Each row is a model-type with its free quantity (parked, verified and not reserved), machines planned for dispatch, machines still awaiting verification, and the oldest inward date.',
      'Click a model-type to list its machines in dispatch order. FIFO 1 (green) is the oldest and should go out first.',
      'Filter by yard, or search a model-type or serial number.',
      'The badge next to the inward date shows where the date came from: Actual (entered by hand), Gate (first gate check-in) or Stage 18 (estimate).',
      'Administrators and Yard Managers can click the pencil icon to enter the real inward date of a machine that was in the yard before go-live.',
      'Age (first inward) counts from the first time the machine came into the yard. A machine that left and came back keeps that date and shows a blue Returned tag.',
      'A machine that came back after dispatch shows "On hold · returned" and is not free stock. An Administrator or Yard Manager checks it, opens it and clicks Clear for Dispatch with a remark. Machines back from testing or repair are free stock again straight away.',
    ],
    tips: ['Machines awaiting security verification, planned for dispatch, on an exit request or on hold are shown but not numbered: only free stock gets a FIFO number.'],
  },
  {
    tab: 'dispatch', title: 'Dispatch Planning', roles: 'Dispatch Planner, Yard Manager, Administrator',
    purpose: 'Plan FG yard machines for dispatch. The system picks the oldest machines first (FIFO).',
    steps: [
      'Click Plan Machines. Enter the SO number if the plan is for a Sales Order (optional).',
      'Choose a model-type and the quantity; the free stock of each model-type is shown in the list.',
      'Add more model-types if needed, then click Save Plan.',
      'The quantity cannot be more than the free FG yard stock. If it is, the plan is not saved.',
      'The oldest free machines are picked straight away and appear on the PDI Dispatch Machine List. No approval is needed.',
      'Click a plan to see its machines and where each one is. Cancel removes a machine that is still in the FG yard and makes it free stock again.',
    ],
    tips: ['Planned machines show a purple Planned badge on Yard Stock and are not counted as free stock.'],
  },
  {
    tab: 'pdi', title: 'Dispatch Machine List', roles: 'PDI Team, Main Gate, Yard Manager, Administrator (Dispatch Planner, Operator and View Only can view)',
    purpose: 'Follow planned machines from the FG yard through the PDI final check to the main gate.',
    steps: [
      'In FG yard lists the planned machines with their yard and slot.',
      'Choose a driver for a machine (optional).',
      'Tick the machines and click Print Slip. The slip lists, for each driver, the machine serial, barcode, yard and slot to collect.',
      'The driver takes the machine out through the normal FG gate-out with their badge and the machine barcode. No exit request is needed. The machine moves to At PDI by itself.',
      'PDI does the final check and clicks PDI Check: Pass, or Hold with a remark. A machine on hold stays At PDI; check it again after rectification.',
      'A passed machine moves to Ready for main gate. Main Gate Out is only possible after PDI passes the machine.',
      'The time since FG gate-out is shown. It turns amber at half the alert time and red after it (8 hours by default).',
      'The Main Gate user clicks Main Gate Out when the machine leaves the plant. Later the main gate system will send this automatically. Undo corrects a wrong click.',
      'A machine that comes back into the FG yard before main gate-out (for example sent back from PDI) is taken off its plan and shows "Returned to FG yard". It is on return hold in Yard Stock; once cleared it can be planned again. The planner plans a replacement if needed.',
    ],
    tips: ['A machine still waiting after the alert time is e-mailed to the production manager, with a reminder while it is still waiting. The time and the e-mail address are set by the Administrator in Settings.', 'The Main Gate user sees only this list, and only machines that have left the FG yard. They cannot mark a machine out until PDI passes it.'],
  },
  {
    tab: 'machines', title: 'Machine Tracking', roles: 'Administrator, Yard Manager, Operator, Service Technician, View Only',
    purpose: 'The full machine inventory with status, park status and location.',
    steps: [
      'Search by serial number or model, and filter by status or park status.',
      'Click "Stage X/18" to see the assembly stage history, or History for slot movements.',
      'Machines enter the yard only through Gate Control. Allocate (place a machine straight into a slot) appears only while an Administrator has Initial stock load switched on in Settings, for machines already parked before go-live. It needs stage 18, a barcode and a remark, and the machine still goes to Security.',
      'Administrators, Yard Managers and Operators can add a machine manually with Add Machine.',
    ],
  },
  {
    tab: 'assembly', title: 'Assembly Line', roles: 'Administrator, Yard Manager, Operator',
    purpose: 'Track machines through assembly stages 1–18, and follow machines that have completed assembly.',
    steps: [
      'Click a stage button (1–18) to list machines currently at that stage. "All" lists every machine still in assembly.',
      'Click Completed (after 18) to see machines that finished stage 18. Use the chips to filter: No Barcode, Ready to Move, In Transit, At Gate, Parked, Exited.',
      'Search by serial, order number or barcode. The search works inside the stage or Completed view you have selected.',
      'Click any machine row to open its full stage history: work centre, start and end time, duration.',
      'Administrators can press "Sync last N days" to read the latest production orders from the plant now. The Last Sync and Schedule cards are also Administrator-only.',
    ],
    tips: ['"No Barcode" machines cannot be released to the yard. The barcode must be added in the plant system; the next sync picks it up.', 'The plant sync runs automatically every morning (schedule set in Settings).'],
  },
  {
    tab: 'fert', title: 'FERT Categories', roles: 'Administrator, Yard Manager',
    purpose: 'Groups of finished machines (FERT) with a priority and a preferred yard.',
    steps: ['Read the list: code, name, priority, preferred yard, and how many machines use each category.', 'Administrators add a category with Add Category, and edit or delete it with the icons at the end of each row.'],
  },
  {
    tab: 'models', title: 'Vehicle Models', roles: 'Administrator, Yard Manager',
    purpose: 'Maps each KMAT code to a model, type and preferred yard. The preferred yard decides where a machine is parked first.',
    steps: [
      'Use the status filter to find models marked Pending. These came from SAP without a model or type and need completing.',
      'Click the pencil icon to set the model, type and preferred yard.',
      'Add a new mapping with Add Model.',
    ],
    tips: ['The KMAT must match CONF_MATERIAL in the Material Master. A sync never overwrites values you entered.'],
  },
  {
    tab: 'materials', title: 'Material Master', roles: 'Administrator, Yard Manager',
    purpose: 'Item codes read from SAP, linking each item to its CONF_MATERIAL (KMAT).',
    steps: ['Read the cards for record count, last sync, plant and sync window.', 'Administrators and Yard Managers press Sync Now to read SAP immediately.'],
    tips: ['SAP is only reachable from the office network. A sync from guest Wi-Fi will fail.'],
  },
  {
    tab: 'drivers', title: 'Drivers', roles: 'Administrator, Yard Manager',
    purpose: 'The driver roster, badges and driver logins.',
    steps: [
      'Add Driver: enter name, phone, licence number and employee code. The employee code is what the gate scans from the badge.',
      'Upload a photo so the gate guard can recognise the driver.',
      'Print Badges prints a sheet of barcode badges for all drivers with an employee code.',
      'Administrators only: the key icon creates (or removes) a login so the driver can confirm parking on a device, and the bin icon deletes a driver.',
    ],
  },
  {
    tab: 'users', title: 'User Management', roles: 'Administrator',
    purpose: 'Create user accounts and control their role and access.',
    steps: [
      'Add User: name, email, role and a password of at least 8 characters.',
      'Pencil icon: change name, role or password. Leave password empty to keep the current one.',
      'Power icon: deactivate or reactivate an account. You cannot deactivate your own account or change your own role.',
    ],
    tips: ['A role change applies on the user’s next action. Deactivating is safer than deleting because history stays linked to the person.'],
  },
  {
    tab: 'logins', title: 'Login History', roles: 'Administrator',
    purpose: 'Who signed in and out, when, from which IP address and device, and every failed attempt.',
    steps: [
      'The cards show today’s sign-ins, the number of different users and failed attempts. Click Failed today to list them.',
      'Filter by Signed in, Failed or Signed out, search an email, name or IP, or pick a date range.',
      'Click an IP address to list every sign-in from it.',
    ],
    tips: ['Five failed sign-ins on one account within 15 minutes alert the Administrators.', 'History is kept 90 days and then deleted automatically, because IP addresses linked to people are personal data.'],
  },
  {
    tab: 'feedback', title: 'Feedback', roles: 'Everyone sends · Administrator reviews',
    purpose: 'Send a suggestion, report an issue or give feedback from any screen, and follow what happens to it.',
    steps: [
      'Press Feedback in the top bar. Choose Suggestion, Issue or Other, write a few words and press Send. The screen you were on is sent with it.',
      'Open Feedback > My feedback to see the status (New, In progress, Done, Closed) and the Administrator’s reply. You get a notification when it changes.',
      'Administrators: open Administration > Feedback, filter by status or type, open an item, set the status and write a reply.',
    ],
    tips: ['For an issue, include the serial number, the screen and what you expected, so it can be checked quickly.'],
  },
  {
    tab: 'access', title: 'Role Access', roles: 'Administrator',
    purpose: 'Choose which role may open each page and use each action, without a code change.',
    steps: [
      'Tick a box to allow, untick to remove. Rows are pages (Open page) with their actions under them; columns are roles.',
      'Press Save. Users get the change the next time they open or refresh the app. The server applies it too, so a removed action is refused even outside the screen.',
      'A dot marks a box that differs from the default. Reset to Default puts every role back to the original access.',
      'Recent changes lists who changed what and when.',
    ],
    tips: ['Administrator always has full access. User Management, Settings and Role Access stay Administrator-only. A driver can only be given Dashboard, Confirm Parking and Exit Requests.', 'An action needs its page: give the page too, or the role cannot reach the button.'],
  },
  {
    tab: 'settings', title: 'Settings', roles: 'Administrator',
    purpose: 'Connections to the plant production system, SAP material master, the gate barrier, e-mail and the main gate, plus parking and dispatch alerts.',
    steps: [
      'Set each API URL, sync window (days), schedule (cron) and timeout.',
      'Press Test Connection before saving to confirm the server can reach the system.',
      'Gate Boom Barrier: set the Open and Close URLs and the auto-close time. Optionally enable the Manual Open button for the gate.',
      'E-mail (SMTP): enter the sender mailbox and its app password, then press Send Test.',
      'Parking & Security Check: choose whether Security must verify each parked machine, and the minutes after gate in before an alert is raised for parking that is not confirmed.',
      'Initial stock load: switch on only while entering the machines already parked in the yard before go-live (Machine Tracking > Allocate), then switch it off. When off, machines enter only through Gate Control.',
      'Dispatch Overdue Alert: set the hours a machine may wait between FG gate-out and main gate out, and the e-mail address that receives the alert.',
      'Main Gate Integration: press Create Key only when the main gate system team is ready to connect.',
      'Press Save Changes. New schedules take effect immediately.',
    ],
    tips: ['Schedule format is 5 fields: "30 6 * * *" means every day at 06:30.', 'Keep the security check switched on unless switching it off has been formally approved. When it is off, parked machines are verified automatically and this is recorded in the history.'],
  },
  {
    tab: 'gate', title: 'Gate Control', roles: 'Administrator, Yard Manager, Operator, Security',
    purpose: 'Check machines in to the yard (Inward) and out of the yard (Outward).',
    steps: [
      'Choose Inward or Outward at the top right.',
      'Scan the driver badge into "Scan Driver Badge". With no barcode reader, tap the camera icon at the end of the field and point the camera at the badge.',
      'Scan the machine barcode the same way. The screen shows the detected machine, its stage and status.',
      'Inward slot: if the machine already has a reserved slot, it is shown in yellow and used as it is. Otherwise the "Gate slot" list is pre-set to the suggested slot (automatic). To override, choose another free slot from the list; "Back to suggested slot" undoes it.',
      'If the chosen slot is taken by another machine before you authenticate, the next free slot is assigned and a notice says so. If no yard has a free slot, entry is refused.',
      'Press "Authenticate & Open Barrier" (or "Authorize Exit" for Outward). Green means authorized and the barrier opens. Red shows the reason it was refused.',
      'Print the Driver Pass or the 50mm label if needed, then Close Barrier (or let it close automatically).',
      'Press Reset before the next machine.',
    ],
    tips: [
      'Camera scanning needs the site opened over https (or on the same computer) and permission to use the camera. Tap Allow when the browser asks.',
      'If a barcode will not scan, use "or select machine manually".',
      'Outward only lists machines whose exit request was approved, or that are planned for dispatch. A planned machine needs no exit request; its slot is freed when it is scanned out.',
      'Inward refuses a machine that is already parked in the yard or released for exit. A machine still in transit keeps its slot if it is scanned again.',
      'A machine that comes back after dispatch is put on hold until a manager clears it in Yard Stock. Managers are notified.',
      '"Recent Gate Logs" on the right shows every attempt, authorized or rejected.',
    ],
  },
  {
    tab: 'parked', title: 'Confirm Parking', roles: 'Administrator, Yard Manager, Operator, Security, Driver',
    purpose: 'Tell the yard the machine is physically in its slot.',
    steps: [
      'Find your machine card. It shows the yard and slot it should be in.',
      'Park the machine in that exact slot, then press "I have parked it".',
      'The card changes to "Waiting for security to check it". You are notified when Security approves or rejects.',
      'If rejected, put the machine back in the same slot and press "I have parked it" again.',
    ],
    tips: [
      'Drivers only see their own machines. Yard office staff can confirm on a driver’s behalf.',
      'If the security check is switched off in Settings, the machine is verified as soon as parking is confirmed and the card says so.',
      'If parking is not confirmed within the set time after gate in (30 minutes by default), the yard team and the driver are alerted.',
    ],
  },
  {
    tab: 'security', title: 'Security Verification', roles: 'Administrator, Security',
    purpose: 'Check parked machines and see which machines are cleared to leave.',
    steps: [
      'Each card is a machine waiting for a check, with its yard and slot.',
      'Walk to the slot. If the right machine is there, press Approve.',
      'If not, press Reject, type the reason, and Confirm reject. The driver is told to re-park.',
      '"Authorized Exits" lists machines approved to leave. They drop off once the gate checks them out.',
      '"Recent Verifications" keeps the last 8 decisions as a record.',
    ],
    tips: ['New machines appear automatically. If "Live updates offline" is shown, press Refresh.', 'If an Administrator switches the security check off in Settings, no new machines arrive here; they are verified automatically.'],
  },
  {
    tab: 'returns', title: 'Returns', roles: 'Everyone except Drivers',
    purpose: 'Machines that left for testing, inspection, repair, relocation or maintenance and are expected back.',
    steps: [
      'Each row shows why the machine left, who requested it and when.',
      'Administrators, Yard Managers and Operators can press Reserve Slot to hold a slot for its return (optional: the gate can also assign one on arrival).',
      'When the machine comes back, check it in through Gate Control → Inward as usual.',
    ],
  },
  {
    tab: 'requests', title: 'Exit Requests', roles: 'Everyone',
    purpose: 'Ask for a parked machine to leave the yard, and approve or reject those requests.',
    steps: [
      'New Request: choose a parked machine, the purpose (Dispatch, Testing / Inspection, Repair, Relocation, Maintenance) and optional notes, then Submit.',
      'Yard Managers and Administrators press Approve or Reject (with a reason) on pending requests.',
      'Approval frees the slot and sends the machine to the gate. Security sees it straight away.',
      'Use the status filter to find Pending, Approved, Rejected or Completed requests.',
    ],
    tips: ['Most roles only see their own requests. Managers see every request.'],
  },
  {
    tab: 'history', title: 'Movement History', roles: 'Administrator, Yard Manager, Operator, Security',
    purpose: 'The audit trail of every slot movement, parking confirmation and security decision.',
    steps: [
      'Choose a tab: Movements, Parking or Verifications.',
      'Filter by machine to see one machine’s history.',
      'Each row records who did it. Parking rows show whether the Driver or the Yard office entered it.',
    ],
  },
  {
    tab: 'docs', title: 'Docs (Process Flow)', roles: 'All signed-in users',
    purpose: 'Reference of the full process, the rules the system enforces, and what each role can do.',
    steps: ['Read the machine lifecycle and access lifecycle, the guardrails, the role table and the alert list.'],
  },
  {
    tab: 'sop', title: 'SOP', roles: 'All signed-in users',
    purpose: 'The Quality Department SOP for the FG yard gate system: process steps, the shortage rule and who does what.',
    steps: ['Read the 13 process steps and the roles table.', 'Click Download PDF for the issued copy.'],
  },
  {
    tab: 'notifications', title: 'Notifications', roles: 'All signed-in users',
    purpose: 'Every alert sent to your role.',
    steps: ['Read new alerts (red = critical, amber = warning, blue = information).', 'Press Mark read on one alert or "Mark all read".'],
    tips: ['The same alert is not repeated more than once every 15 minutes. Read alerts are removed after 30 days.'],
  },
];

const GLOSSARY = [
  { term: 'Slot label (A1, B5…)', meaning: 'The letter is the row and the number is the column of the yard grid. B5 = row B, column 5.' },
  { term: 'Stage 1–18', meaning: 'The assembly stages a machine passes on the production line. Stage 18 is the last one.' },
  { term: 'Completed', meaning: 'Every stage-18 operation is finished. The machine has left assembly.' },
  { term: 'Barcode', meaning: 'The machine’s identification label, scanned at the gate. A machine without one cannot be released.' },
  { term: 'Employee code / badge', meaning: 'The driver’s identity code, printed as a barcode on the driver badge and scanned at the gate.' },
  { term: 'Order No', meaning: 'The production order number from the plant system.' },
  { term: 'FERT', meaning: 'A finished machine (finished product) as recorded in SAP.' },
  { term: 'KMAT / CONF_MATERIAL', meaning: 'The configurable material code that identifies the machine model. It links SAP items to Vehicle Models.' },
  { term: 'Model-Type', meaning: 'The model and type of a machine, taken from the Vehicle Model master.' },
  { term: 'Preferred yard', meaning: 'The yard a model or category should be parked in first, if it has free slots.' },
  { term: 'Reservation', meaning: 'A slot held for a machine that has not arrived yet (yellow in the grid).' },
  { term: 'Sync', meaning: 'Reading the latest data from the plant production system or SAP. Runs every morning automatically.' },
  { term: 'Aging', meaning: 'How long a machine has been parked in its slot.' },
  { term: 'FIFO', meaning: 'First in, first out: the machine that came into the yard first is dispatched first.' },
  { term: 'Free stock', meaning: 'Machines parked and verified, not planned for dispatch, not on an exit request and not on hold.' },
  { term: 'Age (first inward)', meaning: 'Days since the machine first came into the FG yard. It does not restart when a machine leaves and comes back.' },
  { term: 'On hold · returned', meaning: 'A machine that came back after dispatch. It cannot be planned until a manager clears it.' },
  { term: 'FG gate-out / Main gate out', meaning: 'FG gate-out is leaving the FG yard; main gate out is leaving the plant.' },
];

const FAQ = [
  { q: 'I cannot see a screen my colleague can see.', a: 'The menu shows only the screens your role can open. Ask an Administrator to check your role in User Management.' },
  { q: 'The gate rejected a machine. What now?', a: 'Read the red reason. Common causes: driver badge not found, machine not at stage 18, machine has no barcode, machine already parked in the yard, or no free slot in any yard. Fix the cause (for example free a slot or add the barcode in the plant system), then Reset and scan again.' },
  { q: 'A completed machine shows "No Barcode".', a: 'The barcode is missing in the plant system. The machine cannot be released until it is added there; the next sync updates it automatically.' },
  { q: 'The camera icon does not open the camera.', a: 'Tap Allow when the browser asks for the camera. Camera scanning only works over a secure (https) address or on the same computer. Otherwise use the barcode reader or type the code.' },
  { q: 'Numbers look out of date.', a: 'Press Refresh on the screen, or reload the page. The Dashboard also refreshes every minute.' },
  { q: 'Sync failed or Material Master is empty.', a: 'The plant and SAP systems are only reachable from the office network. An Administrator can use Settings → Test Connection to check.' },
  { q: 'I forgot my password.', a: 'Ask an Administrator to set a new one in User Management.' },
  { q: 'Something is wrong with the system.', a: 'Note the screen, the machine serial number and the time, take a screenshot if you can, and report it to the system administrator. Report anything that looks like a security problem to IT straight away.' },
];

interface UserGuideProps {
  onNavigate?: (tab: string) => void;
  allowedTabs?: string[];
}

export default function UserGuide({ onNavigate, allowedTabs }: UserGuideProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const can = (tab: string) => !allowedTabs || allowedTabs.includes(tab);
  const role = user?.role || 'VIEW_ONLY';
  const term = query.trim().toLowerCase();

  const screens = useMemo(() => {
    const base = showAll ? SCREENS : SCREENS.filter((s) => can(s.tab));
    if (!term) return base;
    // Search always covers every screen, so an answer is found even for a screen
    // outside the reader's role.
    return SCREENS.filter((s) =>
      [s.title, s.purpose, s.roles, ...s.steps, ...(s.tips || [])].join(' ').toLowerCase().includes(term)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, term, allowedTabs]);

  const faq = term ? FAQ.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(term)) : FAQ;
  const glossary = term ? GLOSSARY.filter((g) => `${g.term} ${g.meaning}`.toLowerCase().includes(term)) : GLOSSARY;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Help & User Guide"
        description="How to use FG Yard, screen by screen"
      />

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the guide, e.g. gate, barcode, slot, password…"
        icon={<Search className="w-4 h-4" />}
        aria-label="Search the user guide"
      />

      {!term && (
        <>
          {/* Your role */}
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white"><UserCog className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-blue-900">
                {user ? <>You are signed in as {user.name} · <Badge variant="blue">{ROLE_LABELS[role] || role}</Badge></> : <>You are not signed in. Sign in (top right) to see your own screens.</>}
              </p>
              <p className="mt-0.5 text-xs text-blue-800">{ROLE_SUMMARY[role] || ROLE_SUMMARY.VIEW_ONLY}</p>
              <p className="mt-1 text-[11px] text-blue-700">This guide shows the screens your role can open. Use &quot;Show all screens&quot; below to read about the others.</p>
            </div>
          </div>

          {/* Quick start */}
          <SectionCard title="Quick start" description="The basics, in five steps">
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {QUICK_START.map((s, i) => (
                <li key={s.title} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">{i + 1}</span>
                    <span className="text-slate-500">{s.icon}</span>
                    <p className="text-[13px] font-semibold text-slate-900">{s.title}</p>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{s.text}</p>
                </li>
              ))}
            </ol>
          </SectionCard>

          {/* Machine journey */}
          <SectionCard title="A machine's journey" description="From the assembly line to a verified yard slot, and out again">
            <ol>
              {JOURNEY.map((j, i) => (
                <li key={j.step} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"><Route className="w-3 h-3" /></span>
                    {i < JOURNEY.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                  </div>
                  <div className="pb-3.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-slate-900">{i + 1}. {j.step}</p>
                      <Badge variant="gray">{j.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{j.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </SectionCard>
        </>
      )}

      {/* Screen guides */}
      <SectionCard
        title={term ? `Screens matching "${query.trim()}" (${screens.length})` : `Screen guides (${screens.length})`}
        description={term ? 'Search covers every screen' : showAll ? 'Every screen in the system' : 'The screens in your menu'}
        action={!term ? (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[11px] font-semibold text-blue-700 hover:underline">
            {showAll ? 'Show only my screens' : 'Show all screens'}
          </button>
        ) : undefined}
        noPadding
      >
        {screens.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No screen matches your search.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {screens.map((s) => {
              const expanded = open === s.tab || !!term;
              return (
                <div key={s.tab}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === s.tab ? null : s.tab)}
                    aria-expanded={expanded}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    {expanded ? <ChevronDown className="mt-0.5 w-4 h-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 w-4 h-4 shrink-0 text-slate-400" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-900">{s.title}</span>
                        {!can(s.tab) && <Badge variant="gray">Not in your menu</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">{s.purpose}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4 pl-10 space-y-3">
                      <p className="text-[11px] text-slate-500"><span className="font-semibold text-slate-700">Who uses it (default):</span> {s.roles}</p>
                      <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
                        {s.steps.map((step) => <li key={step}>{step}</li>)}
                      </ol>
                      {s.tips && s.tips.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800"><Lightbulb className="w-3.5 h-3.5" /> Tips</p>
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-900">
                            {s.tips.map((tip) => <li key={tip}>{tip}</li>)}
                          </ul>
                        </div>
                      )}
                      {can(s.tab) && onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate(s.tab)}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-800 transition-colors"
                        >
                          Open {s.title} <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Status reference */}
      {!term && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="Machine park status" description="The badge shown next to each machine">
            <dl className="space-y-1.5 text-xs">
              {[
                ['PLANNED', 'In assembly, or completed but not released yet (for example no barcode).'],
                ['READY TO MOVE', 'Released with a barcode. Waiting for a driver to take it to the gate.'],
                ['IN TRANSIT', 'Checked in at the gate, on its way to the slot.'],
                ['PARKED PENDING', 'Confirmed parked. Waiting for Security to check.'],
                ['PARKED REJECTED', 'Security found a problem. Re-park in the same slot and confirm again.'],
                ['PARKED VERIFIED', 'Security approved. The machine is correctly parked.'],
                ['AT GATE', 'Exit approved. Waiting to be checked out at the gate.'],
                ['EXITED', 'Has left the yard.'],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="w-32 shrink-0 font-semibold text-slate-800">{k}</dt>
                  <dd className="text-slate-600">{v}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard title="Yard slot colours" description="As shown in the FG Yard grid">
            <dl className="space-y-1.5 text-xs">
              {[
                ['bg-emerald-100 border-emerald-400', 'Available', 'Free for the next machine.'],
                ['bg-yellow-100 border-yellow-400', 'Reserved', 'Held for a machine on its way. Shows that machine’s serial.'],
                ['bg-red-100 border-red-400', 'Occupied', 'A machine is parked here.'],
                ['bg-blue-100 border-blue-400', 'Dispatch Ready', 'Machine ready to be dispatched.'],
                ['bg-amber-100 border-amber-400', 'Inspection', 'Machine under inspection.'],
                ['bg-orange-100 border-orange-400', 'Maintenance', 'Slot or machine under maintenance.'],
                ['bg-slate-200 border-slate-400', 'Blocked', 'Out of service. Not used for new machines.'],
              ].map(([cls, label, text]) => (
                <div key={label} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border ${cls}`} />
                  <dt className="w-28 shrink-0 font-semibold text-slate-800">{label}</dt>
                  <dd className="text-slate-600">{text}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </div>
      )}

      {/* Glossary */}
      {glossary.length > 0 && (
        <SectionCard title="Glossary" description="Terms used across the screens">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {glossary.map((g) => (
              <div key={g.term}>
                <dt className="text-[13px] font-semibold text-slate-900">{g.term}</dt>
                <dd className="text-xs leading-relaxed text-slate-600">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      )}

      {/* FAQ */}
      <SectionCard title="Common questions" description="Problems users run into most often">
        {faq.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-3">No question matches your search.</p>
        ) : (
          <div className="space-y-2.5">
            {faq.map((f) => (
              <div key={f.q} className="flex gap-2.5">
                <HelpCircle className="mt-0.5 w-4 h-4 shrink-0 text-blue-600" />
                <div>
                  <p className="text-[13px] font-semibold text-slate-900">{f.q}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{f.a}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
