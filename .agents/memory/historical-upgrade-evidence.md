---
name: Historical upgrade evidence
description: Why financial upgrade tests must use a coherent old application and its dependency/configuration closure.
---

Seed pre-upgrade financial history through a pinned previous application and schema together. Do not use current handlers against the old schema or pre-create new tables merely to make fixture setup pass.

**Why:** New permission and workflow code can depend on tables that are deliberately absent before upgrade. Such setup tests neither the previous installation nor the real transition.

**How to apply:** Preserve the previous snapshot's referenced project configuration and library closure as well as its database schema. Then apply the current migration path and verify existing records, financial relationships and balances, followed by a no-op repeat.
