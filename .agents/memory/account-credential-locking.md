---
name: Account credential lock ordering
description: Coordinate password writes with the existing database authority trigger without shared-to-exclusive advisory deadlocks.
---
Password writers must acquire the authority **writer** fence before locking the identity row; ordinary factor verification can use the shared side.

**Why:** Existing authority triggers on identity updates acquire the writer fence implicitly. If a password writer first holds the shared fence and the user row while a concurrent login/reset holds another shared fence and waits for that row, the writer's implicit fence upgrade deadlocks. This was observed under concurrent old-password login and single-use reset.

**How to apply:** Declare an identity write before the first account row lock. Do not fix the race by permitting transient server errors in acceptance tests or by globally serializing every ordinary login with the writer lock. Preserve explicit lock-order tests.
