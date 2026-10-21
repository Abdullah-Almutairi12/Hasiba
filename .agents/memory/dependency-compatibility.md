---
name: Dependency compatibility
description: Constraints for security updates to shared frontend tooling
---

Keep the shared Vite development-server plugins and Vitest on one compatible Vite major when updating dependencies.

**Why:** Resolving transitive dependencies independently can select a newer Vite major for testing and plugin declarations while the apps remain on the older major. The structurally different plugin types then break frontend type checking even though each package's individual version range is satisfied.

**How to apply:** Preserve the workspace-wide version alignment unless deliberately migrating all consumers together. Verify all frontend type checks and builds after changing the shared toolchain. Retain the release-age safety policy when selecting patched releases.
