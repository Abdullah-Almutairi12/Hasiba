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

**How to apply:** Do not keep retrying identity aliases. Consult current Replit documentation, but verify navigation against the user's actual interface; never extract or request a token to work around the UI.

Do not repeat account settings → Git Providers as a verified navigation path for this environment.

**Why:** The user supplied a screenshot showing the current settings interface without that entry after following this advice. Documentation searches still returned the unavailable path.

**How to apply:** Start from the project's Git tool rather than workspace Advanced settings. If authorization controls are not visible, inspect a screenshot of the Git panel before giving another precise settings path. The visible Integrations entry alone does not establish that it manages the Git remote's source-control authorization.

Keep a separately authorized repository's existing work intact when it has unrelated history.

**Why:** The user explicitly requires preserving both Replit and GitHub files, retaining the previous remote and a rollback point, avoiding force pushes and hard resets, and using a separate branch when histories or configuration conflicts need a decision.

**How to apply:** Compare history and shared files first. Publish the ERP work to an independent branch when necessary, do not claim the requested main branch is synchronized until integration is actually approved and verified, and disclose ignored reports and data. Inspect reachable history for sensitive files as well as the current tree: ignore rules do not remove old uploads from existing commits.

Treat Hasiba as the existing repository for the existing Replit project, not as a replacement project or a newly created repository.

**Why:** The user explicitly corrected that framing and stated that Hasiba contains previous work and had already been synchronized. They prohibited replacing main or archiving its site based on an assumption that it is old.

**How to apply:** Audit all remote branches and available reflogs before inferring the previous synchronization path. Distinguish a safety branch created by the agent from an established historical branch. If older pushes or remote-URL changes cannot be established from retained evidence, state that limitation rather than denying the user's account. Preserve main and its files; do not propose archiving based solely on unrelated branch histories, commit age, or a different directory layout.
