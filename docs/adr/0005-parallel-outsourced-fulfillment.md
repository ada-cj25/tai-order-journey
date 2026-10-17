---
status: accepted
---

# Track outsourced finished products as a parallel fulfillment line

The main workflow remains linear and manufactured production areas still ship once as a whole order. Outsourced finished products are instead an order-level, versioned technical requirement: they have no production number and do not contribute to workshop progress. Procurement records immutable cumulative arrivals, and each product may ship exactly once when its valid arrivals reach the published plan and finance has confirmed the tail payment. Outsourced shipment does not require an installation application and does not advance the main stage.

Manufactured shipment still advances the order to installation without waiting for outsourced products, so site work can begin. Installation completion and customer acceptance are server-blocked until every applicable outsourced product has shipped. Orders migrated from before this decision are marked `LEGACY_EXEMPT`; the old `outsourceReady` flag is retained only for compatibility and never fabricates requirement, arrival, or shipment facts.

Order administrators use one shipment-registration workspace for a vehicle: they may select manufactured area batches, ready outsourced products, or both. A combined submission is atomic, but the server still records separate manufactured and outsourced shipment facts so their gates, installation treatment, and audit histories cannot be confused. This removes the separate outsourced-shipment action without coupling outsourced products to the manufactured workflow.

This partially supersedes ADR-0003: its manufactured shipment rules remain authoritative for production areas, while outsourced finished products use their own independent shipment records.

## 2026-09-10 amendment: installation application and package counts

Installation application is no longer a manufactured-shipment gate. It reads a live order package total and may be submitted while that total is provisional. The total is the sum of area hardware packages supplied by procurement, manufactured warehouse packages recorded by assembly, and per-product outsourced warehouse packages recorded by assembly after arrival. Late outsourced packages may be appended later; completeness is informational and does not block fulfillment.

Shipment registration no longer accepts or infers per-batch piece counts. Historical manual counts remain visible under a legacy basis and are not converted into the new source ledger because their component origins cannot be proven.
