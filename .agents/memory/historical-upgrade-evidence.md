---
name: Historical upgrade evidence
description: Why financial upgrade tests must use a coherent old application and its dependency/configuration closure.
---

Seed pre-upgrade financial history through a pinned previous application and schema together. Do not use current handlers against the old schema or pre-create new tables merely to make fixture setup pass.

**Why:** New permission and workflow code can depend on tables that are deliberately absent before upgrade. Workspace-package links can silently route an old application's imports to current database definitions, making even an old select-all query demand new columns. Such setup tests neither the previous installation nor the real transition.

Requiring today's initializers to remain byte-identical to the reference also confuses normal development with reference integrity. Verify and bootstrap the archived reference itself; do not merely remove the guard while still initializing the previous database with today's application.

**How to apply:** Preserve the previous snapshot's referenced project configuration and library closure as well as its database schema. Reusing installed third-party dependencies must not redirect workspace packages to today's sources. Then apply the current migration path and verify existing records, financial relationships and balances, followed by a no-op repeat.

A deliberate numeric precision widening can change PostgreSQL's textual scale without changing a historical monetary value. Preserve exact decimal comparisons and all other snapshot fields rather than converting financial evidence to JS floats.

**Why:** Wire strings with additional trailing zeros are not a revaluation; loosening the whole snapshot or rounding both sides can instead conceal real changes.

**How to apply:** Expect only the declared scale transformation, verify the new column precision, and independently assert old and upgraded values with PostgreSQL numeric equality. Keep the remaining history and balance checks unchanged.
