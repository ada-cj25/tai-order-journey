# Tai's Order Journey

A desktop-first internal order follow-up system for custom cabinetry and whole-home furnishing projects. It connects sales, design, technical preparation, procurement, workshop production, shipment, installation, customer acceptance, and aftersales around a shared order record.

This private repository contains the web application, backend API, a WeChat Mini Program prototype, and a local customer-service agent demo. The application interface is primarily Chinese; this README provides an English introduction and development guide.

## Project status

| Component | Scope | Release boundary |
| --- | --- | --- |
| Desktop web application | Role-based order management and operational workflows | The primary implementation and acceptance surface |
| Mobile web view | Chairman-administrator access at `/mobile` | Read-only, with business writes rejected by its dedicated server-side session |
| WeChat Mini Program | Native TypeScript pages, local simulations, and optional local API integration | Defaults to mock mode; release remains gated by desktop/mobile-web acceptance and platform requirements |
| Customer-service agent | Isolated local demo with authorized order lookup, knowledge retrieval, and execution diagnostics | Requires separate setup; not enabled for production |
| Deployment assets | Container builds, environment templates, migrations, and operational runbooks | Source availability does not establish deployment or release readiness |

The initial import on **October 18, 2026** is a sanitized snapshot of the working source tree. It starts a new Git history and excludes the original workspace's business samples and historical commits.

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
| Web client | React 19, TypeScript, Vite 6, Ant Design 6 | Desktop UI, mobile read-only view, workflow forms, and local demo screens |
| API | NestJS 11, TypeScript, Express | Authentication, authorization, business commands, scheduling, and attachment access |
| Persistence | PostgreSQL 17, Prisma 7 | Business records, immutable snapshots, audit events, and sessions |
| Mini Program | Native WeChat pages and TypeScript | Mock workflows and dedicated mobile API clients |
| Local agent | Python, FastAPI, LangGraph, MCP, and optional retrieval models | Controlled customer-service demonstration and diagnostics |
| Deployment | Docker, Compose, Caddy or Nginx, Tencent COS | Packaging, HTTPS entry point, private files, and backup tooling |

The web client calls the API, which enforces business permissions and persists changes in PostgreSQL. The Mini Program uses dedicated mobile authentication and controllers rather than desktop session cookies. The customer-service demo runs separately and obtains order facts through authorized tools.

Use the dependency lockfile and configuration files as the source of truth for exact versions.

## Repository layout

```text
.
├── src/                       # Web application, styles, and visual assets
├── server/                    # NestJS controllers, services, and backend tests
│   ├── domain/                # Business rules and projections
│   └── prisma/                # Schema, migrations, and local seed utilities
├── mini-program/              # Native WeChat Mini Program prototype
├── customer-agent/            # Local agent and synthetic demo knowledge
├── tests/                     # Workflow, deployment, integration, and packaging tests
├── scripts/                   # Development, verification, and maintenance utilities
├── deploy/                    # Container and environment templates
│   ├── personal/              # Shared components and historical route assets
│   └── company-test/          # Isolated company-test overrides
├── docs/
│   ├── adr/                   # Architecture decision records
│   └── launch/                # Acceptance, deployment, and operations runbooks
├── worker/                    # Sites-compatible static prototype worker
├── .github/workflows/         # Automated verification; no deployment workflow
├── AGENTS.md                  # Product and implementation constraints
└── CONTEXT.md                 # Domain terminology and context
```

Dependencies, build outputs, the generated Prisma client, uploaded files, and local environment files are excluded from Git.

## Local development

### Prerequisites

- **Node.js 24.x** and npm. The package declares `>=24 <25`.
- **PostgreSQL 17**, with a dedicated local role and a disposable development database.
- Git access to this private repository.
- WeChat Developer Tools only if working on the Mini Program.
- A Python virtual environment only if working on the customer-service demo; its dependencies are separate from npm.

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

Run the Mini Program tests with:

```bash
npm run test:mini
```

See the [Mini Program guide](mini-program/README.md) for scenarios and the [release gate](docs/launch/mini-program-gate.md) for prerequisites. These supporting documents are currently in Chinese and may describe the original local test setup; the checked-in configuration and snapshot notes above identify what is included here.

## Local customer-service demo

The optional demo uses separate local databases for fabricated ERP orders and agent state:

- `whole_house_erp_customer_demo`
- `whole_house_erp_customer_agent_demo`

It requires an ignored `.env.customer-demo`, a Python environment, and explicit initialization. Follow the [customer-service demo guide](docs/customer-agent-local-demo.md) before starting the dedicated services:

```bash
npm run dev:customer:api
npm run dev:customer:agent
npm run dev:customer:web
```

The demo web entry point is `http://127.0.0.1:5174/customer`. Model credentials and optional downloaded weights remain local. The single-agent workflow exposes structured tool and validation outcomes; unreviewed material must not be treated as approved company policy.

`customer-agent/benchmark-result.json` is a reviewed synthetic fixture used by the UI. Its saved metrics are not evidence of current production accuracy or a substitute for evaluation with independently labeled, approved data.

## Build and verification

Generate the Prisma client before running backend checks.

| Command | What it checks or produces |
| --- | --- |
| `npm run typecheck` | Web and backend TypeScript checks |
| `npm test` | Backend service and domain tests |
| `npm run test:mini` | Mini Program tests |
| `npm run test:workflow` | Workflow forms, drafts, and related regressions |
| `npm run test:deploy` | Deployment-template checks |
| `npm run build` | Web output in `dist/client/` and Sites-compatible packaging |
| `npm run build:api` | Compiled API in `server/dist/` |
| `npm run test:sites` | Static worker and packaging checks; run after the web build |
| `npm run test:integration` | Database-backed tests in a newly created isolated database |
| `npm run health:local` | Checks the running local application |

Integration tests require an explicit `TEST_DATABASE_ADMIN_URL`. The runner creates a uniquely named `erp_test_*` database, applies migrations, runs the suite, and drops that database afterward. It does not fall back to the application's `DATABASE_URL`; use a dedicated local or CI database administrator connection.

The GitHub Actions workflow verifies pushes and pull requests, including database integration tests, container builds, and a dependency audit. It does **not** deploy the application. Consult each run for its actual result; local test results do not imply that every CI step has passed.

### Initial snapshot verification

For the October 18, 2026 import, local type checking, the web build, and API compilation passed. The following **281 tests** also passed:

| Suite | Passed |
| --- | ---: |
| Backend | 182 |
| Mini Program | 51 |
| Workflow | 38 |
| Deployment templates | 6 |
| Sites packaging | 4 |

That verification did not include database integration tests, Docker builds, or full cloud acceptance. The web build retained a large-bundle warning. These are historical results for the initial snapshot, not a live status badge for later commits.

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

General business rules, supported workbook parsers, application assets, migrations, and fabricated regression fixtures remain included. The original workspace and its local business samples were preserved separately.

Future updates should be reviewed as source changes from this sanitized history. Directly merging the original workspace's history could reintroduce excluded material. A source checkout alone cannot restore orders, attachments, credentials, or a running environment.

## Further reading

| Document | Purpose |
| --- | --- |
| [Product and implementation constraints](AGENTS.md) | Durable repository-specific requirements |
| [Domain context](CONTEXT.md) | Shared business terminology |
| [Architecture decisions](docs/adr/) | Recorded design choices |
| [Launch runbooks](docs/launch/README.md) | Environment setup, acceptance, and operations |
| [Mini Program guide](mini-program/README.md) | Local simulator and API scenarios |
| [Customer-service demo guide](docs/customer-agent-local-demo.md) | Isolated agent setup and evaluation boundaries |

Most supporting business documents and UI labels are currently in Chinese. Read the relevant runbook alongside the actual configuration before environment-specific operations.
