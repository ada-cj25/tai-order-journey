---
status: accepted
date: 2026-09-13
supersedes: active order-level installation application workflow
---

# Attach installation arrangements to manufactured shipments

## Context

An order-level installation application duplicated the information needed at shipment time and could not represent different teams, contacts or planned dates for multiple vehicle loads. It also created an unnecessary action between production and installation.

## Decision

The active order-level installation application is retired. Every manufactured `Shipment` records its installation team, site contact, planned installation date and site conditions in the same transaction as shipment registration. A successful manufactured shipment creates one installation-department task keyed by shipment; completing that shipment's installation completes only its matching task.

Outsourced-only shipments do not require an installation arrangement. Historical installation applications and shipments remain read-only and are not rewritten. Historical shipments without the new fields retain the legacy installation-task fallback.

## Consequences

- Shipment registration is the single server-authoritative interface for a vehicle and its installation arrangement.
- Package counts are referenced directly by shipment registration and are not an installation-application gate.
- Each manufactured vehicle can be scheduled and completed independently.
