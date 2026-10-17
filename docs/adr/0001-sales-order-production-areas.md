---
status: superseded by ADR-0003
---

# Separate sales orders from production areas

One sales order owns the contract, payments, installation application and final acceptance, while one or more production areas own production numbers, technical packages, material versions and workshop execution. Technical review and procurement remain atomic whole-order decisions, but production and immutable shipment area selections progress independently; this preserves simple commercial control while allowing real room-by-room manufacturing and partial delivery.
