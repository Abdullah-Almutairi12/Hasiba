---
name: Repository synchronization
description: Required GitHub handoff and scope boundaries for synchronized project files.
---

Treat GitHub synchronization as a required project handoff, not as another name for a local checkpoint.

**Why:** The user explicitly requires the workspace project files and connected GitHub repository to stay synchronized.

**How to apply:** Fetch and compare the connected branch before pushing; preserve remote work and never force-push to achieve apparent equality. Verify the remote commit/tree after synchronization. Explicitly disclose that ignored generated reports, dependencies, runtime data, and secrets are not included; do not describe tracked-source synchronization as a backup of every workspace file or promise continuous automatic synchronization without configuring it.
