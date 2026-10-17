# Tai's Order Journey

A desktop-first internal order follow-up system for custom cabinetry and whole-home furnishing projects. It connects sales, design, technical preparation, procurement, workshop production, shipment, installation, customer acceptance, and aftersales around a shared order record.

The `main` branch of this private repository contains the core web application, backend API, WeChat Mini Program, and the files needed to install, build, initialize, and deploy them. The application interface is primarily Chinese; this README provides an English introduction and development guide.

## Project status

| Component | Scope | Release boundary |
| --- | --- | --- |
| Desktop web application | Role-based order management and operational workflows | The primary implementation and acceptance surface |
| Mobile web view | Chairman-administrator access at `/mobile` | Read-only, with business writes rejected by its dedicated server-side session |
| WeChat Mini Program | Native TypeScript pages, local simulations, and optional local API integration | Defaults to mock mode; release remains gated by desktop/mobile-web acceptance and platform requirements |
| Deployment assets | Container builds, environment templates, migrations, and operational runbooks | Source availability does not establish deployment or release readiness |

The initial import on **October 18, 2026** is a sanitized snapshot of the working source tree. The subsequent core cleanup removes independent experiments, development records, unused artwork, one-off acceptance utilities, and the full regression suites from `main`. The complete development workspace remains separate; the pre-cleanup source is recoverable at commit `47e993a`. Business samples and the original workspace history were never imported.

## Core capabilities

### Order ownership and workflow

- The order detail page brings together the current owner, next action, deadlines, payment gates, production areas, attachments, and event history.
- Standard sales orders, linked supplement orders, and internal exceptional orders follow distinct business rules.
- A tracking serial identifies an order before formal design submission. Design submission allocates its sales number; technical staff later create production areas with their own production numbers.
- Evidence-backed forms support incomplete, server-persisted drafts. Only a validated final submission advances the workflow.
- Sales visibility is enforced by brand and employee scope on the server. Other roles receive the fields and actions permitted by their responsibilities.

### Payments, design, and technical preparation

- Sales reports deposit, prepayment, and balance-payment facts; finance separately verifies actual receipt.
- Design intake, assignment, return, transfer, and formal delivery preserve the relevant ownership and deadline history.
- Formal design delivery includes versioned design files and customer confirmation evidence.
- Technical preparation organizes each production area's routes, planned workshop quantities, and material workbooks.
- Four supported material workbook categories use explicit template validation. Unknown structures are rejected instead of guessed.
- Approval publishes immutable material and cost snapshots for later review and audit.

### Procurement, production, and fulfillment

- Procurement records panel and wood/paint route confirmations independently for each area. Cost completion does not block route release.
- Purchasing, inventory, supplier negotiation, and receiving activities remain offline in the active Procurement V2 workflow. Historical compatibility structures are not a current inventory feature.
- The four production workshops are panel, wood, paint, and assembly. Assigned workers report start, cumulative completed quantity, completion, or an issue for an exact process.
- Released routes can progress independently. Shipment remains subject to completion and finance-confirmed balance-payment gates.
- Manufactured shipment batches carry installation arrangements and area-specific installation fees. Outsourced finished products have separate arrival and shipment facts.
- Customer acceptance establishes the applicable warranty start date. Aftersales cases and valid cost batches remain traceable after business completion.

### Cost accounting

Order costs cover materials, workshop work, installation and transport, outsourced finished products, and cumulative valid aftersales costs. Prices and applicable rates are versioned; an explicit audited recalculation is required to update historical cost snapshots. Missing prices leave totals provisional.

Cost access is role-scoped and controlled by a feature flag. Formal production keeps the cost module disabled until separate cost acceptance; the isolated company test environment explicitly enables it for workflow testing.

## Architecture and technology

| Layer | Main technologies | Responsibility |
| --- | --- | --- |
| Web client | React 19, TypeScript, Vite 6, Ant Design 6 | Desktop UI, mobile read-only view, and workflow forms |
| API | NestJS 11, TypeScript, Express | Authentication, authorization, business commands, scheduling, and attachment access |
| Persistence | PostgreSQL 17, Prisma 7 | Business records, immutable snapshots, audit events, and sessions |
| Mini Program | Native WeChat pages and TypeScript | Mock workflows and dedicated mobile API clients |
| Deployment | Docker, Compose, Caddy or Nginx, Tencent COS | Packaging, HTTPS entry point, private files, and backup tooling |

The web client calls the API, which enforces business permissions and persists changes in PostgreSQL. The Mini Program uses dedicated mobile authentication and controllers rather than desktop session cookies.

Use the dependency lockfile and configuration files as the source of truth for exact versions.

## Repository layout

```text
.
├── src/                       # Desktop web, mobile read-only view, and active assets
├── server/                    # NestJS controllers and business services
│   ├── domain/                # Business rules, projections, and local account rosters
│   └── prisma/                # Schema, full migration history, and base local seed
├── mini-program/              # Native pages, API clients, and required mock-mode data
├── scripts/                   # Build, health, account setup, and backup utilities
├── deploy/                    # Container, environment, backup, and restore files
├── docs/launch/                # Deployment and acceptance instructions
├── worker/                    # Static prototype packaging compatibility
├── .openai/hosting.json        # Static prototype hosting descriptor
├── tests/sites-worker.test.mjs # Small check for the retained packaging contract
├── .github/workflows/verify.yml
├── Dockerfile
├── package.json
├── package-lock.json
└── README.md
```

Dependencies, build outputs, the generated Prisma client, uploaded files, and local environment files are excluded from Git.

## Local development

### Prerequisites

- **Node.js 24.x** and npm. The package declares `>=24 <25`.
- **PostgreSQL 17**, with a dedicated local role and a disposable development database.
- Git access to this private repository.
- WeChat Developer Tools only if working on the Mini Program.

### 1. Clone and install

```bash
git clone https://github.com/ada-cj25/tai-order-journey.git
cd tai-order-journey
npm ci
cp .env.example .env
```

Edit `.env` before starting the application. Point `DATABASE_URL` to the local development database and replace the session-secret placeholder with a locally generated random value. Keep `.env` outside Git.

### 2. Prepare a disposable local database

After creating your local PostgreSQL role, create a database it owns. For example, if the role is named `erp_local`:

```bash
createdb --host=127.0.0.1 --username=erp_local whole_house_erp
```

Make the username, password, database name, and port in `.env` match that database. Generate the client and apply the existing migrations:

```bash
npm run db:generate
npm run db:deploy
```

For an empty, disposable local demo database, the optional seed command creates demonstration accounts and sample records:

```bash
npm run db:seed
```

The seed utility updates some existing account metadata and includes historical compatibility fixtures. Use it only for the intended local demo setup, not for production initialization or an existing business database. Formal initialization follows the launch runbooks and separate bootstrap commands.

### 3. Start the web application and API

```bash
npm run dev
```

This starts Vite and the API together. Default local addresses are:

| Address | Purpose |
| --- | --- |
| `http://127.0.0.1:5173` | Desktop web application |
| `http://127.0.0.1:5173/mobile` | Dedicated mobile read-only entry point |
| `http://127.0.0.1:3000/api/docs` | API documentation in non-production mode |
| `http://127.0.0.1:3000/api/health/live` | API liveness |
| `http://127.0.0.1:3000/api/health/ready` | Database/schema and reminder-service readiness |
| `http://127.0.0.1:3000/api/v1/public/config` | Public runtime flags |

Vite proxies `/api` requests to the backend. Its development server binds to all interfaces, while the API defaults to loopback; these are development settings, not a production hosting setup.

The desktop test-account picker is available only when the development build, browser host, and backend local-environment checks allow it. It fills seeded credentials and uses normal authentication; it does not bypass server authorization.

## Configuration guide

The root `.env.example` is the starting point for local development. Deployment-specific templates live under `deploy/`.

| Variable | Purpose and handling |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the selected environment |
| `SESSION_SECRET` | Session-signing secret; production requires an independent value of at least 32 characters and rejects known placeholder forms |
| `API_HOST` / `API_PORT` | API listener; defaults to `127.0.0.1:3000` |
| `WEB_ORIGIN` | Allowed web origin; use the exact local origin during development |
| `UPLOAD_ROOT` | Local attachment directory |
| `ATTACHMENT_STORAGE` | `local` for development or `cos` for configured cloud storage |
| `COST_MODULE_ENABLED` | Explicit cost feature control; keep `false` for formal production until accepted |
| `LOCAL_TEST_ACCOUNTS_ENABLED` | Set to `false` to suppress local shortcuts; enabling it does not bypass other local checks |
| `MINI_PROGRAM_ENABLED` | Backend Mini Program feature gate |
| `MINI_PROGRAM_DEV_LOGIN_ENABLED` | Local simulated identity support; prohibited in production |
| `WECHAT_MINI_APP_ID` / `WECHAT_MINI_APP_SECRET` | Server-side WeChat configuration; the secret must never enter the client bundle |
| `WECHAT_OPENID_HASH_SECRET` | Independent secret used for WeChat identity hashing |
| `NODE_ENV` / `APP_ENVIRONMENT` | Runtime mode and isolated company-test identification |
| `TZ` | Production runtime uses `Asia/Shanghai` |

Cloud credentials belong in protected environment files. The configuration examples contain placeholders, not a working cloud installation. Decorative login scenes are fixed by client type and must not be presented as live weather forecasts.

## WeChat Mini Program

Import `mini-program/` into WeChat Developer Tools. This snapshot uses `touristappid` in `project.config.json`; configure your own permitted AppID for local work when required. `project.private.config.json` is ignored by Git.

The default profile in `mini-program/config/runtime.ts` is `mock`. This mode uses fabricated local examples and does not write to PostgreSQL or consume formal order-number pools.

Optional local API integration requires:

1. A running desktop API connected to a dedicated loopback development database.
2. Explicit backend settings for `MINI_PROGRAM_ENABLED` and `MINI_PROGRAM_DEV_LOGIN_ENABLED`.
3. Public configuration confirming that the local test and Mini Program flags are enabled.
4. Local API mode in the Developer Tools simulator, followed by the employee binding flow.

A physical phone cannot reach the development computer through the phone's own `127.0.0.1`. Simulator domain-check exceptions and simulated identities do not demonstrate production WeChat login readiness.

Check the Mini Program TypeScript with:

```bash
npm run typecheck:mini
```

See the [Mini Program guide](mini-program/README.md) for scenarios and the [release gate](docs/launch/mini-program-gate.md) for prerequisites. The release-gate document is currently in Chinese. The checked-in configuration and the snapshot notes above identify what is included here.

## Build and verification

Run the complete core check with:

```bash
npm run check
```

This generates the Prisma client, checks web/backend/Mini Program types, builds the web application and API, and verifies the retained static packaging contract. It does not connect to a business database or perform business workflow acceptance.

| Command | What it checks or produces |
| --- | --- |
| `npm run typecheck` | Web and backend TypeScript checks |
| `npm run typecheck:mini` | Mini Program TypeScript checks |
| `npm run build` | Web output in `dist/client/` and static packaging compatibility files |
| `npm run build:api` | Compiled API in `server/dist/` |
| `npm run test:sites` | Four static worker and packaging checks; run after the web build |
| `npm run health:local` | Checks the running local application |

The GitHub Actions workflow runs `npm run check`, builds the container targets, and audits production dependencies. It does **not** deploy the application. Consult each run for its actual result.

### What was retained and why

- **Database schema and every migration:** a fresh installation needs the full schema history, including compatibility migrations.
- **Mini Program mock modules:** the default local mode imports these files at runtime; they are not disposable test fixtures.
- **Base seed and account setup:** needed for the supported local login and role-testing setup. Production uses separate bootstrap commands.
- **Deployment, backup, restore, and launch guidance:** required to operate the application and preserve its data correctly.
- **Static packaging files and their small test:** the existing web build and Dockerfile depend on this compatibility contract.
- **Dependency lockfile and configuration:** required for reproducible installs and compilation.

### Regression coverage outside main

The full backend, Mini Program, workflow, integration, and UI regression sources were removed from `main` as part of the core-only cleanup. They remain in the original development workspace and in the pre-cleanup sanitized commit `47e993a`.

During cleanup, the runtime changes passed **182 backend tests, 51 Mini Program tests, and 38 workflow tests** before those test sources were removed. The retained packaging checks run against the final core build. These local results do not claim Docker, database integration, physical-device, or full cloud acceptance.

Removing test files does not remove the need for release validation. Run the full business regression suite in the development workspace and complete the applicable acceptance runbook before releasing a changed system.

## Deployment and operational boundaries

Read the [launch runbook index](docs/launch/README.md) before cloud testing, production initialization, release, restore, or pilot acceptance. The active company-test route uses a separate PostgreSQL database, private COS storage, and company-test Compose overrides after the base configuration.

- Cloud testing uses fabricated data; its database never becomes the formal business database.
- Formal production is initialized separately, with validated accounts, number pools, payment accounts, and feature flags.
- The proposed internal pilot is limited to at most 50 employees and one group of 10-20 new orders. Historical orders stay in the existing process.
- Backup targets are an RPO of at most six hours and an RTO of at most eight hours. They remain targets until demonstrated by an isolated restore drill.
- Mini Program publication requires its own identity, platform, privacy, filing, permission, and acceptance checks.
- Sites assets are a static prototype handoff, not the production ERP backend.

Pushing code to this repository neither changes a running server nor publishes a WeChat Mini Program.

## Snapshot contents, ownership, and maintenance

The developer owns the product and source code. Company business data remains company-owned and may only be processed within the signed authorization described in the [data authorization template](docs/launch/data-authorization-template.md). This is a private repository; no open-source license is granted here.

The sanitized import excludes:

- Original Git history, tags, and unrelated local references.
- Environment secrets, private keys, uploaded attachments, and database backups.
- Real order photo transcriptions and supplied material-price datasets.
- Dedicated seed/import utilities and tests dependent on those excluded samples.
- Local acceptance screenshots and generated business-data reports.
- Independent customer-service agent code, its web/admin screens, and its API endpoints.
- Developer instructions, architecture notes, design drafts, unused artwork, and one-off acceptance scripts.
- Full regression suites and their npm commands; only the small packaging check remains.

General business rules, supported workbook parsers, active application assets, migrations, and the fabricated data needed by local runtime modes remain included. The original workspace and its local business samples were preserved separately.

Future updates should be reviewed as source changes from this sanitized history. Directly merging the original workspace's history could reintroduce excluded material. A source checkout alone cannot restore orders, attachments, credentials, or a running environment.

## Further reading

| Document | Purpose |
| --- | --- |
| [Launch runbooks](docs/launch/README.md) | Environment setup, acceptance, and operations |
| [Mini Program guide](mini-program/README.md) | Local simulator and API scenarios |

Supporting launch documents and UI labels are currently in Chinese. Read the relevant runbook alongside the actual configuration before environment-specific operations.
