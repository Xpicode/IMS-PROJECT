# IMS-PROJECT

Inventory Management System: stock, assets, offline field counts, borrowing, and official PDFs.

| Path | What it is |
|---|---|
| `IMS_MVP.md` | The spec (rules for stock, custody, sync, PDFs, security) |
| `IMS_BUILD_PLAN.md` | The build order, phase by phase |
| `Projects/Code/Inventory Management System (IMS).md` | Progress tracker: checklists, decisions, log, handoff |
| `ims/` | The app (Next.js + PostgreSQL + Prisma + Auth.js) |

## Run it locally

Needs Node 24 and Docker Desktop.

```bash
cd ims
cp .env.example .env          # then set POSTGRES_PASSWORD, DATABASE_URL, AUTH_SECRET
npm ci
docker compose -f compose.dev.yaml up -d db
npx prisma migrate deploy
npx prisma db seed            # demo users: admin@ / supervisor@ / field@ims.local
npm run dev                   # http://localhost:3000
```

Tests: `npx vitest run` (integration tests use the `ims_test` database from the dev compose).

Status: Phase 1 (Foundation) in progress. See the tracker.
