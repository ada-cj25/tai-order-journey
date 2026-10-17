---
status: accepted
date: 2026-09-12
supersedes: ADR-0006 route-shipment cardinality and automatic final-batch decision
---

# Allow immutable multi-batch shipment per production route

## Context

A rare but valid vehicle load may contain only part of one completed production route. Treating the first route shipment as the whole route silently closes later delivery work and can allow installation or customer acceptance before the remaining goods leave the factory.

## Decision

Each completed `ProductionRoute` owns an ordered collection of immutable `ShipmentRouteLine` batch facts. When the order administrator selects a route for a vehicle, they explicitly record whether that route line is the final batch. A non-final line keeps the route eligible for another shipment. A final line sets the route's shipment-completion fact and closes later shipment registration for that route.

The vehicle still has one `ShipmentArea` per included area and one installation-fee snapshot for that area and vehicle. The area batch is final only when every applicable route in the area has either an earlier final line or a final line in the current vehicle. Customer acceptance requires every applicable route to have a final line and every manufactured vehicle shipment to be installed.

Historical route shipment lines are migrated as sequence 1 and final because the former model allowed exactly one line and treated its creation as route completion. Existing shipment, installation-fee, installation and audit facts are not rewritten.

## Consequences

- Route shipment completion is distinct from the existence of any shipment line.
- `ProductionRoute.shippedAt` means final shipment confirmed, not first shipment created.
- A route line has its own route sequence and final flag; the surrounding area sequence remains the vehicle's area-batch sequence.
- Package totals remain route-level production facts and are not divided among shipment batches.
