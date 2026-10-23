---
name: Repository synchronization
description: Required GitHub handoff and scope boundaries for synchronized project files.
---

Treat GitHub synchronization as a required project handoff, not as another name for a local checkpoint.

**Why:** The user explicitly requires the workspace project files and connected GitHub repository to stay synchronized.

**How to apply:** Fetch and compare the connected branch before pushing; preserve remote work and never force-push to achieve apparent equality. Verify the remote commit/tree after synchronization. Explicitly disclose that ignored generated reports, dependencies, runtime data, and secrets are not included; do not describe tracked-source synchronization as a backup of every workspace file or promise continuous automatic synchronization without configuring it.

Git CLI source-control authorization and the GitHub App API connection are separate paths.

**Why:** A healthy GitHub App connection and a declared scope list did not mean the Git remote's OAuth credential could update GitHub Actions workflows.

**How to apply:** When Git rejects a workflow update for missing `workflow` scope, renew the source-control GitHub authorization rather than deleting the workflow, weakening verification, force-pushing, or reconnecting an unrelated App connection.

The legacy source-control connection may be healthy yet unavailable to integration reconnect cards, even after attachment.

**Why:** Reconnect cards rejected both its handle and canonical connection ID; the ordinary connect card could not resolve a connector ID.

**How to apply:** Do not keep retrying identity aliases. Consult current Replit documentation and have the user disconnect/reconnect GitHub under account settings → Git Providers when this occurs; never extract or request a token to work around the UI.
