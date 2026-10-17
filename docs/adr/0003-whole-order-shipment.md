---
status: superseded by ADR-0006
---

# Require whole-order shipment after all areas complete

Production remains independent by area, but manufactured-product shipment is a single whole-order fact because operations no longer want partial delivery of production areas. Every active area must finish before the order enters 发货, and tail-payment confirmation plus installation-application submission must both be complete before one immutable manufactured shipment records all area production numbers; historical partial shipments remain auditable and can only close by shipping every remaining area together. ADR-0005 keeps this manufactured-product decision and supersedes only the former assumption that every product on the sales order shares that one shipment.
