# FG Yard — Changelog

Changes that matter to users, IT and Quality. Newest first. For how to apply an update to a
running server, see [INSTALL.md › Updating an existing server](./INSTALL.md#13-updating-an-existing-server).

## 30 October 2026

**Update needs:** `npx prisma db push` (one new column, MachineStageHistory.endState; nothing
removed), backend and frontend rebuild. No new packages. Take a database backup first.

### Assembly: stage done only after inspection
- The plant API now sends `end_state_cd` for every operation. A stage counts as done only when it
  is **INSPECTION-COMPLETED**. The plant sends quantity 1.00 and an end time while the stage is
  still **IN-INSPECTION**, so the quantity alone is no longer used. Older data without the field
  still uses the quantity.
- A machine reaches Ready to Move, and can come in at the gate, only after **stage 18 inspection
  is completed**. A Ready to Move machine whose stage 18 goes back to IN-INSPECTION returns to
  Planned. Machines already past the gate keep their stage.
- **Assembly Line** shows the plant status of each machine's latest operation, for example
  *S18 In inspection*. **Stage History** has a Plant Status column and an *In inspection at stage*
  chip.

## 29 October 2026, second update

**Update needs:** `npx prisma db push` (new columns and one new table, PasswordReset; nothing
removed), backend and frontend rebuild. No new packages, so `npm install` is
not needed. Add the backup lines to `backend/.env` (INSTALL.md › 12). Take a database backup first.

### Dashboard
- New layout without empty gaps: top cards, a single **Needs attention** row (now also PDI hold),
  the FG Yard Flow across the full width, then two-column rows.
- **Last 7 Days** chart: FG gate in, FG gate out and main gate out per day, with hover numbers and
  a table view.
- **Activity**: the latest yard events (gate in / out, parking verified / rejected, PDI, main gate
  out) with who and when.
- **Open Dispatch Plans**: progress of each open plan (out of plant, out of FG yard, in yard) and
  its PDI holds.
- **Find & Go** puts machine search and the screen shortcuts in one card.

### Forgot password and Create account
- **Forgot your password?** on the login page: enter the work e-mail, a 6-digit code is e-mailed
  (valid 15 minutes, 5 tries), then set a new password. The page never says whether an account
  exists. When the code cannot be e-mailed (SMTP not set up, or it failed), the Admins get a
  *Password reset requested* alert and reset it in User Management.
- A password reset, or a new password set by an Admin, signs that account out of every device.
  Reset requests and results appear in Login History.
- **Create account** on the login page is now **off by default**. **Settings › Accounts › Show
  Create account** switches it on; when off, only an Admin creates accounts (the server refuses
  self-registration too).

### Daily database backup
- The backend saves the whole database every night at 01:00 into a folder on the server
  (`BACKUP_DIR`, gzip files named `fg-yard_YYYY-MM-DD_HHMM.sql.gz`). Kept 14 days; the newest 3 are
  always kept. The Admin team copies the files from that folder to another system.
- **Settings › Database Backup** (Admin): folder, last result, the files, and **Back up now**.
- A failed backup notifies every Admin.

### Two-person rule for parking
- The person who confirmed a parking (driver, yard office or security) cannot also approve it;
  another person must. Rejecting is always allowed. On by default; **Settings › Parking & Security
  Check** switches it off (for a shift with only one guard, for example).
- **Security Verification** shows who parked each machine and greys out Approve on your own.

### Bulk stock load from Excel
- **Machine Tracking › Upload Stock List** (Admin, Yard Manager, only while Initial stock load is
  on): an Excel (.xlsx) or CSV file with Serial Number, Yard, Slot and optional Inward Date and
  Remark. Every row is checked first (Stage 18, barcode, slot free, no duplicates) and shown; only
  the rows that pass are placed, and each still goes to Security. Template download included.

### Feedback
- A screenshot can be added to feedback (choose a file, or Print Screen then Ctrl+V). It is kept
  outside the public folder and only the sender and Admins can open it.
- New feedback is e-mailed to **Settings › Feedback Alert** addresses, or every active Admin
  when that is empty (needs the SMTP settings).

### Other
- **Login page:** "How to use FG Yard" opens a short getting-started note.
- **SOP:** the role checklists are marked *Version 0.1 DRAFT, not yet reviewed by Quality*, on the
  page and on every printout, until Quality reviews them.
- **Fix:** a Settings e-mail list containing the letter "s" (for example `sales@...`) was split
  into broken addresses on save. Commas, semicolons and spaces now separate addresses.
- **For IT:** automated tests (`npm test`, `npm run test:api` in `backend`) and a GitHub Actions
  check on every push. See README › Tests.

## 29 October 2026

**Update needs:** `npx prisma db push` (two new tables: Feedback and LoginEvent, nothing removed),
backend and frontend rebuild. No new packages, so `npm install` is not needed if the server is
already on the 28 October update. Take a database backup first.

### Feedback
- **Feedback** button in the top bar for every user: send a Suggestion, an Issue or Other
  feedback from any screen; the screen is attached. **My feedback** shows the status and reply.
- **Administration › Feedback** (Admin): New / In progress / Done / Closed, filter, search, set the
  status and reply. Admins are notified of new feedback; the sender is notified of changes.

### Login history
- Every sign-in attempt and sign-out is recorded with time, IP address and device.
- **Administration › Login History** (Admin): today's sign-ins, users and failures, filters,
  search by email, name or IP, date range.
- 5 failed sign-ins on one account within 15 minutes alert the Admins.
- Personal data (DPDPA): Admin-only, deleted after 90 days, notice on the login page.
- **IIS must pass on the user's IP** (`X-Forwarded-For`); otherwise every row shows the server's
  address. See INSTALL.md › Updating an existing server.

### Login and screens
- Login page with the FG yard photo and the Bull logo in its real colours beside the FG Yard name;
  on phones the photo sits at the top with the form under it, no empty space, no zoom on iPhone.
- Opening the app without signing in now goes to the login page (Help needs a sign-in).
- Login and Create account pages redesigned and made more compact: show/hide password, Caps Lock
  warning, password strength and match check on Create account.
- All screens refreshed: darker sidebar with the section and page in the top bar, the signed-in
  user beside the bell, tighter tables and form fields, popups as bottom sheets on phones.
- Gate Control shows the three steps as numbered circles, bigger scan fields, and a clear
  Authorized / Refused result. Dispatch Machine List shows the four dispatch steps; FG Yard cards
  show a free / occupied / reserved / blocked bar.
- Short, subtle animations (page change, popups, status changes); off when Windows "reduce motion"
  is on.
- Popups always open in the middle of the screen (the Feedback popup was stuck to the top bar).

## 28 October 2026

**Update needs:** `npx prisma db push` (new columns and tables only, nothing removed), backend and
frontend rebuild, and the IIS folder change for the new address. Take a database backup first.

### Name and address
- The application is now called **FG Yard** (browser tab, login, sidebar, e-mails, printouts).
- The address is now **`/fg-yard`** instead of `/fg-yard-system`. The old address redirects to the
  new one through `deploy/old-address-redirect/web.config`.

### Dispatch
- **SO number** (optional) on a dispatch plan; searchable, shown on the plan, the dispatch list
  and the pick slip.
- **PDI final check** after FG gate-out: Pass, or Hold with a remark and check again. **Main gate-out
  is refused until PDI passes the machine**, from the screen and from the main gate API.
- Dispatch Machine List tabs: In FG yard · At PDI · Ready for main gate · Main gate out.
- A machine that comes back into the FG yard **before main gate-out** is taken off its plan
  ("Returned to FG yard") and goes on return hold.
- Dispatch Planning: plans load page by page with Open / Completed / Cancelled tabs, date and
  SO search, and a progress bar per plan.
- Dispatch is no longer a manual exit reason; customer dispatch goes only through Dispatch Planning.

### Yard and stock
- **Initial stock load** switch (Settings, Admin, off by default): only while it is on can a machine
  already parked before go-live be placed straight into a slot (Machine Tracking › Allocate),
  with stage 18, a barcode and a remark. When off, machines enter only through Gate Control.
- **Block / Unblock a slot** with a reason (who and when recorded). The Remove slot option is gone.
- Dragging a machine to another slot on the FG Yard grid now works (it silently failed before);
  the move is recorded and goes back to Security.
- Slot details show why a machine is not free stock (return hold, security rejection, plan, exit
  request). The slot "Dispatch" button is now **Release for exit** (testing, repair, relocation,
  maintenance).
- Yard Stock and Dispatch Planning summary cards open the list of machines behind them.

### Access
- **Role Access** page (Administration, Admin only): tick which role may open each page and use
  each action; the server enforces it; every change is logged; Reset to Default available. The
  default access is the same as before.
- **Security** role: Gate Control, Confirm Parking (on the driver's behalf) and FG Yard (view only).

### SOP and gate
- **SOP page** (Documentation › SOP) with the issued PDF, role checklists and Do's & Don'ts that can
  be printed or saved as PDF per role. The checklists are app guidance pending Quality review.
- Gate Control shows the **red / green T-shirt** dress code reminder next to the driver badge.

### Screens
- Compact two-line summary cards, tighter table rows and spacing on every page.

### Data
- Database backups (`backend/prisma/backups/`) are no longer kept in git; they hold personal data.
