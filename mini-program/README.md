# Tai's Order Journey - WeChat Mini Program

This directory contains the native TypeScript Mini Program used by the core project. It includes role-specific pages, API clients, login artwork, and local simulation modules.

## Open the project

1. Import this directory into WeChat Developer Tools.
2. The repository uses `touristappid` as its AppID placeholder. Configure your own permitted AppID for the intended local or platform environment. Keep AppSecret on the backend only.
3. The default `packagedProfile` in `config/runtime.ts` is `mock`. Start with that profile for local UI exploration.
4. The pre-login scene uses the fixed rainy animation. It is decorative and does not represent live weather.

## Runtime modes

| Mode | Data source | Boundary |
| --- | --- | --- |
| `mock` | Local fabricated examples and device storage | No PostgreSQL writes; no formal number-pool consumption |
| `local-api` | Desktop API at `http://127.0.0.1:3000` | Developer Tools simulator only, with explicit backend flags and employee binding |
| `company-test-api` | Configured HTTPS company test API | Requires accepted platform configuration, real WeChat identity, and isolated test data |

The mock modules in `domain/` are runtime dependencies, so they remain in this core checkout. Local mock records do not appear in the desktop database. Clearing simulator storage can remove local mock records.

For local API testing, start the root web/API project against a local development database. Explicitly set `MINI_PROGRAM_ENABLED=true` and `MINI_PROGRAM_DEV_LOGIN_ENABLED=true` in that local backend environment. Confirm the flags through `/api/v1/public/config`, then select local API mode in the simulator login page and follow the employee invitation/binding flow.

A physical phone cannot reach the computer through the phone's own `127.0.0.1`. Simulated local identity is not proof of production WeChat login readiness.

## Structure

- `app.json`, `app.ts`, `app.wxss`: application entry, registered pages, and shared styles.
- `pages/`: login, role workspaces, orders, reporting, shipment, installation, and aftersales screens.
- `components/`: shared native components.
- `services/`: authentication, API access, and role-specific data clients.
- `domain/`: projections, business-facing types, and local mock-mode behavior.
- `assets/`: referenced branding, icons, and login animation frames.
- `typings/` and `tsconfig.json`: local TypeScript definitions and compiler settings.

## Verification and release

From the repository root, run `npm run typecheck:mini` or `npm run check`. Full regression tests and design previews were removed from core main and remain in the development workspace and pre-cleanup Git history.

Backend permissions and workflow gates remain authoritative in API mode. Heavy material import and technical preparation still require the desktop workflow. The presence of pages in this project does not imply release approval for every role or feature.

Read the [main project guide](../README.md) for installation and the [Mini Program release gate](../docs/launch/mini-program-gate.md) before platform publication. Desktop/mobile-web acceptance, company authorization, AppID ownership, service category, filing, privacy configuration, permissions, and real-device validation remain separate prerequisites.
