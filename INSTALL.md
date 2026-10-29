# Installing FG Yard on a New Server

Step-by-step installation guide for a **fresh server**. Covers both a Windows box running
XAMPP (how this project is currently hosted) and a Linux VPS. The full feature and API
reference lives in [`README.md`](./README.md); this file is only about getting it running.

---

## 1. Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | **20 or newer** (20 LTS / 22 LTS recommended) | Contains `npm`. Check with `node -v`. |
| MySQL | 8.x | XAMPP bundles MySQL + phpMyAdmin. |
| Git | any | To clone the repository. `git -v`. |

Nothing else is installed globally by this guide — the project uses its own local
dependencies via `npm install`.

> On Linux, MySQL is usually a separate package (`mysql-server` or `mariadb-server`).
> On Windows, XAMPP provides MySQL at `localhost:3306` (root user, empty password by
> default).

---

## 2. Get the code

Clone the repository (or copy the project folder onto the server):

```bash
git clone <your-repository-url> yard-management-system
cd yard-management-system
```

The project has two installable halves, installed separately:

```
yard-management-system/
├── backend/   # Express + Prisma API server  (port 5000 by default)
└── (root)     # Next.js frontend             (port 3000 by default)
```

---

## 3. Create the database

Create an empty database named `yard_management`.

**phpMyAdmin (XAMPP):**
1. Open http://localhost/phpmyadmin
2. Click **New**, enter database name `yard_management`, charset `utf8mb4`, click **Create**.

**MySQL command line (any OS):**
```bash
mysql -u root -p
CREATE DATABASE yard_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

> You do **not** need to import a `.sql` file or create tables — Prisma creates the schema
> in step 5 against an empty database.

---

## 4. Backend: dependencies and configuration

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory. There is no committed `.env.example`;
copy this template and fill in your values:

```env
# Database connection. XAMPP default has an empty password:
#   mysql://root:@localhost:3306/yard_management
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/yard_management"

# Required. Used to sign login tokens. Set a long random value, e.g.
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET="replace-with-a-long-random-secret"

PORT=5000
NODE_ENV=production

# First-time account bootstrap. `npm run seed` reads SEED_ADMIN_*.
SEED_ADMIN_EMAIL="admin@company.com"
SEED_ADMIN_PASSWORD="replace-with-a-strong-password"
SEED_ADMIN_NAME="Administrator"

# Shared password for the role logins created by `npm run seed:users`
# (admin, yard.manager, operator, service.tech, security, viewer).
# Minimum 8 characters.
SEED_USERS_PASSWORD="replace-with-a-strong-shared-password"
SEED_USERS_DOMAIN="bullmachine.com"

# Integration bootstrap values, read once the first time the SystemSetting row is created.
# After that, edit them under Admin > Settings; the database wins.
PRODUCTION_API_URL="http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST"
MATERIAL_MASTER_API_URL="http://172.16.1.4:8006/sap/bc/zsap_data_api"
MATERIAL_MASTER_USERNAME="RFCDF"
MATERIAL_MASTER_PASSWORD="replace-with-the-upstream-password"
MATERIAL_MASTER_PLANT="1500"
```

> **`.env` contains secrets — never commit it.** This project has no migration files in
> the repository; the schema is applied with `prisma db push` below.

---

## 5. Backend: generate the client and create the schema

```bash
cd backend

# 1. Generate the Prisma client from the schema
npx prisma generate

# 2. Apply the schema to the empty database (creates all tables and enums)
npx prisma db push
```

`npx prisma db push` is safe to run again; it reports what changed and does nothing when
the schema already matches.

---

## 6. Backend: seed accounts

Decide what data you want before the server's first boot:

```bash
cd backend
```

| Command | What it does | Destructive? |
| --- | --- | --- |
| `npm run seed:users` | Creates one login per role (`admin`, `yard.manager`, `operator`, `service.tech`, `security`, `viewer` at `SEED_USERS_DOMAIN`, all sharing `SEED_USERS_PASSWORD`). Upserts only users. | No |
| `npm run seed` | Clears movements/machines/slots/yards, then creates sample yards, slots, machines, one admin and sample movements. Requires `SEED_ADMIN_*` in `.env`. | **Yes — run only on an empty database** |
| `npm run demo:seed` | Creates 18 `isDemo` machines with full 18-stage history so Assembly, Yards and History have data to show without the plant. | No (only touches `isDemo` rows) |
| `npm run users:system` | Ensures the internal **System** service account (used for auto-generated movements) exists. **Run this always.** | No |

Recommended first-time sequence on a new server:

```bash
npm run users:system      # System account for audit trails
npm run seed:users        # role-based logins for staff
npm run demo:seed         # optional: sample machines to browse the UI
```

> `npm run demo:seed` requires TypeScript tooling (`ts-node`), which is installed with
> `npm install`. Real plant/sync data comes from the Assembly page's **Sync Now** button
> once the integration settings are configured under Admin > Settings.

---

## 7. Backend: build and run

Production build compiles TypeScript to `backend/dist/`:

```bash
cd backend
npm run build      # runs `tsc`
npm start          # runs `node dist/index.js`
```

- The API listens on **http://localhost:5000** (or `PORT` from `.env`).
- Health check: `curl http://localhost:5000/health` → `{"status":"ok", ...}`.
- Uploaded driver photos are stored under `backend/uploads/drivers/`, which is created
  automatically on first boot and served at `/uploads` on the same port.
- The realtime WebSocket is served at `ws://<host>:5000/ws` (same port).
- For **development** use `npm run dev` (nodemon, auto-restart) instead of build + start.

---

## 8. Frontend: dependencies and configuration

From the project root:

```bash
cd <repo-root>
npm install
```

Create a `.env` file in the project **root** (next to `package.json`):

```env
# The URL the browser will use to reach the backend API. Inlined at build time.
# Use the IP/hostname that other machines on the network resolve, e.g.:
#   http://192.168.1.50:5000
# For a single-machine setup this can stay http://localhost:5000
NEXT_PUBLIC_API_URL="http://YOUR_SERVER_IP:5000"
```

> The backend enables CORS for all origins and serves `/uploads` publicly, so the
> frontend can live on a different host than the backend. `NEXT_PUBLIC_*` values are
> baked into the build — rebuild the frontend if you change the URL.

---

## 9. Frontend: build and run

```bash
cd <repo-root>
npm run build      # runs `next build`
npm start          # runs `next start` on port 3000
```

Open **http://YOUR_SERVER_IP:3000/fg-yard** and log in with one of the seeded accounts. The app
is served under the `/fg-yard` base path (set in `next.config.ts`).

For **development**, `npm run dev` serves on http://localhost:3000/fg-yard with hot reload.

---

## 10. Windows + XAMPP versus Linux VPS

| Topic | Windows + XAMPP | Linux VPS |
| --- | --- | --- |
| MySQL | Enabled via XAMPP control panel; default root password is empty | Install MySQL; root usually uses `auth_socket` — create a dedicated user for the app |
| DB URL (empty password) | `mysql://root:@localhost:3306/yard_management` | `mysql://appuser:PASSWORD@localhost:3306/yard_management` |
| Firewall | Allow ports 3000 and 5000 through Windows Defender Firewall for LAN access | `sudo ufw allow 3000` / `sudo ufw allow 5000`, or reverse-proxy 80/443 |
| Keeping it running | Leave the two terminals open, or use `pm2`/a Windows service | Use `systemd` units or `pm2` (`pm2 start`) |

A minimal `pm2` setup (both platforms):

```bash
npm install -g pm2
cd backend && pm2 start "node dist/index.js" --name yms-api
cd .. && pm2 start "npm start -- --port 3000" --name yms-web   # or `pm2 start next --name yms-web`
pm2 save && pm2 startup
```

---

## 11. Post-installation checklist

- [ ] `curl http://<host>:5000/health` returns `ok`.
- [ ] http://<host>:3000/fg-yard loads the login page.
- [ ] The seeded role accounts can sign in (`npm run seed:users` used).
- [ ] The top-bar notification bell connects and receives live alerts.
- [ ] Admin > Settings shows the integration endpoints (self-created from `.env` on first
      boot); save as needed. The database row is the source of truth after creation.
- [ ] On a one-time dev database, `npm run demo:seed` added demo machines that appear on
      Assembly / Yards / History.
- [ ] Admin > Role Access shows the access matrix (defaults until an Admin changes them).
- [ ] Create logins for the Planner, PDI and Main Gate staff in User Management.
- [ ] Machines already parked before go-live: switch on Settings > Initial stock load, place them
      with Machine Tracking > Allocate, then switch it off again.

## 12. Backups and re-runs

- Back up the MySQL database regularly (phpMyAdmin *Export*, or `mysqldump`).
- `npm run seed` **wipes** operational tables — never run it against data you need.
- Read-only maintenance scripts (`verify:slots`, `slots:backfill`, `users:system`,
  `reconcile:ready-move`) are safe to re-run; see the Maintenance table in `README.md`.
- Integration settings are a single `SystemSetting` row. Delete it (and restart the
  backend) to re-bootstrap from `.env`.

## 13. Updating an existing server

For a server that already runs FG Yard (Windows + XAMPP + pm2 + IIS). Downtime is about 3–5
minutes, from stopping pm2 to starting it again. What changed in each update is in
[`CHANGELOG.md`](./CHANGELOG.md).

```powershell
cd <APP_FOLDER>
pm2 ls                                   # note the backend and frontend names
git status                               # must show no changed files
git log --oneline -1                     # write down: rollback point

# Back up the database and the settings file
E:\xampp\mysql\bin\mysqldump.exe -u root -p --single-transaction --routines yard_management > E:\fg-yard-backups\before_update.sql
Copy-Item backend\.env E:\fg-yard-backups\backend.env

pm2 stop <backend-name> <frontend-name>  # downtime starts
git pull origin master

cd backend
npm install                              # only if package.json / package-lock.json changed (see below)
npx prisma db push                       # must end "in sync"; on a data-loss warning answer N and stop
npm run build
cd ..\frontend
npm install                              # only if package.json / package-lock.json changed
npm run build
cd ..

pm2 start <backend-name> <frontend-name> # downtime ends
pm2 save
curl http://localhost:5000/health
```

`prisma db push` must be run while the backend is stopped: on Windows the running backend locks
the database client files.

**Is `npm install` needed?** Only when the package list changed. After `git pull`, run:

```powershell
git diff --name-only HEAD@{1} HEAD -- backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
```

No output means skip `npm install`; a listed file means run it in that folder. The two
`npm run build` steps and the restart are always needed.

**Login history needs the user's real IP.** After the update, sign in once from a phone or PC and
open Administration › Login History. If the IP shown is `127.0.0.1` or the server's own address,
IIS is not passing it on: in IIS Manager › Application Request Routing › Server Proxy Settings,
enable *Preserve client IP in the following header* with `X-Forwarded-For`, then `iisreset`.

### Moving to the /fg-yard address (once, from 28 Oct 2026)

IIS serves the app from a folder named after the address. After the steps above:

```powershell
Rename-Item E:\xampp\htdocs\fg-yard-system fg-yard
Copy-Item <APP_FOLDER>\web.config E:\xampp\htdocs\fg-yard\web.config -Force
New-Item -ItemType Directory -Force E:\xampp\htdocs\fg-yard-system
Copy-Item <APP_FOLDER>\deploy\old-address-redirect\web.config E:\xampp\htdocs\fg-yard-system\web.config
iisreset
```

The old folder then only redirects `/fg-yard-system/...` to `/fg-yard/...`, so old bookmarks keep
working. Confirm the IIS site root before renaming.

### Rollback

```powershell
pm2 stop <backend-name> <frontend-name>
git checkout <rollback-commit>
cd backend;  npm run build; cd ..
cd frontend; npm run build; cd ..
pm2 start <backend-name> <frontend-name>
```

The database does not need restoring: updates only add columns and tables, which the older
version ignores. Run `git checkout master` before updating again.
