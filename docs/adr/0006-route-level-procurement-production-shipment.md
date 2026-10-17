---
status: accepted
date: 2026-09-11
supersedes: ADR-0003 and the manufactured-area assumptions retained by ADR-0005
amended_by: ADR-0008 for route-shipment cardinality and final-batch confirmation
amended: 2026-09-22 for area-route procurement confirmation
---

# Execute procurement, assembly, and manufactured shipment by production route

## Context

A production area can contain a panel route and a solid-wood/paint route. The two routes may receive materials and finish days apart. The former area-wide procurement flag, shared assembly process, and manually marked final shipment batch forced an already-ready route to wait for unrelated work and made partial shipment state ambiguous.

## Decision

New orders use `ROUTE_V2`. Technical approval creates one `ProductionRoute` for every applicable area and route kind, plus one order-level `ProcurementRouteGate` per applicable kind. Procurement completion is recorded on each production area's route and releases only that route. The order-level gate is the aggregate fact for a route kind and closes after every applicable area route is released. A one-click action may confirm every remaining area route of the same kind, but it uses the same per-route release semantics and audit trail. Panel and solid-wood/paint routes each own their assembly process set, production progress, manufactured package-count source, completion fact, and shipment facts. ADR-0008 replaces this ADR's former at-most-once route-shipment assumption.

The first completed route may ship after finance confirms the tail payment; production, another procurement gate, shipment, and installation may continue concurrently. A vehicle may contain multiple routes across areas and ready outsourced products. Route shipment cardinality and final-batch confirmation follow ADR-0008.

Production percentage is projected in four layers: process ratio, equal-average route processes, assembly-area-weighted routes within an area, and equal-average active areas within an order. Hardware handoff and package ledgers are excluded.

Orders with production reports, manufactured package facts, or manufactured shipments remain `AREA_LEGACY`. Clean single-route orders can be migrated automatically. A clean dual-route order with only one historical assembly quantity remains pending manual allocation and cannot be guessed.

## Consequences

- Steps 7, 8, and 9 are projections and can be active at the same time.
- Procurement can save progress area by area; confirming one production number never releases another production number unless the operator explicitly uses the one-click bulk action.
- `order.stage` remains a compatibility/navigation field and is not authoritative for route readiness.
- All detail, task, risk, reporting, package, and shipment checks must use route facts or the shared route projection.
- Historical area batches and explicit final-batch facts remain readable and executable only for `AREA_LEGACY`.
- The dry-run migration audit is `npm run audit:route-v2`; local application requires the explicit `npm run migrate:route-v2:local` command.
