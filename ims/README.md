# IMS app

Next.js 16 (App Router) + PostgreSQL 17 + Prisma 7 + Auth.js 5, with shadcn/ui and Tailwind 4.
Spec: `../IMS_MVP.md` · Build order: `../IMS_BUILD_PLAN.md` · Progress: `../Projects/Code/Inventory Management System (IMS).md`

## Run with Docker (recommended)

Needs Docker Desktop.

```bash
cp .env.example .env
#   Edit .env: set POSTGRES_PASSWORD (use the same value inside DATABASE_URL / TEST_DATABASE_URL)
#   and AUTH_SECRET (any long random string, e.g. `npx auth secret`).
docker compose -f compose.dev.yaml up --build --watch
```

Open http://localhost:3000. On start the app container applies migrations and seeds demo data.
Edits to source files reload in the browser (Compose `watch` syncs them into the container).
Stop with `Ctrl+C`, then `docker compose -f compose.dev.yaml down` (add `-v` only if you want to **delete** the database).

## Run on your machine (faster reloads)

Needs Node 24.

```bash
cp .env.example .env            # as above
npm ci
npm run db:up                   # Postgres only, on 127.0.0.1:5433
npm run db:migrate
npm run db:seed
npm run dev                     # http://localhost:3000
```

Only one `next dev` can run per folder. Stop the Docker `web` container first if it's running.

## Demo accounts (development only)

| Email                | Role          | Locations         |
| -------------------- | ------------- | ----------------- |
| admin@ims.local      | Administrator | all               |
| supervisor@ims.local | Supervisor    | MAIN-WH, WORKSHOP |
| field@ims.local      | Field staff   | SITE-B            |

The password for all three is `SEED_PASSWORD` in your `.env`. The seed refuses to run when `NODE_ENV=production`.

## Checks

```bash
npm run check          # typecheck + lint + format check + all tests
npm run test:unit      # permission matrix and helpers (no database)
npm run test:integration   # real Postgres: the ims_test database (created by compose.dev.yaml)
```

## Where things live

| Path                      | What                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `app/(app)/`              | Signed-in screens (shell, dashboard, users, locations, …)    |
| `app/(auth)/`             | Sign in, forgot password, reset password                     |
| `app/api/v1/`             | JSON API. Every handler is wrapped by `lib/api/route.ts`     |
| `lib/permissions/`        | `requireAccess()`: the one permission check (§5 role matrix) |
| `lib/<domain>/service.ts` | Business rules (no rules in components)                      |
| `lib/auth/`               | Auth.js config, database-backed sessions, password hashing   |
| `components/common/`      | Shared UI: StatusChip, DataList, ConfirmSheet, Wizard, …     |
| `prisma/`                 | Schema, reviewed migrations, dev seed                        |
| `tests/`                  | `unit/` and `integration/` (Vitest)                          |

Style guide with every component state: http://localhost:3000/dev/ui (not available in production).

## Database changes

Never use `prisma db push`. Change `prisma/schema.prisma`, then
`npm run db:new-migration -- --name <what>`, review the SQL, and apply with `npm run db:migrate`.
