---
name: Dependency compatibility
description: Compatibility constraints for shared frontend tooling and schema adapters
---

Keep the shared Vite development-server plugins and Vitest on one compatible Vite major when updating dependencies.

**Why:** Resolving transitive dependencies independently can select a newer Vite major for testing and plugin declarations while the apps remain on the older major. The structurally different plugin types then break frontend type checking even though each package's individual version range is satisfied.

**How to apply:** Preserve the workspace-wide version alignment unless deliberately migrating all consumers together. Verify all frontend type checks and builds after changing the shared toolchain. Retain the release-age safety policy when selecting patched releases.

Form validation adapters must explicitly support the Zod generation used by the form, including when dependency resolution exposes both Zod generations.

**Why:** An older adapter can resolve its schema types through a newer transitive Zod package while the application uses the older schema API. This breaks repository-wide type checking despite the form schema being valid.

**How to apply:** Use an adapter with explicit support for both generations when the dependency graph mixes them; do not suppress the error with a schema type cast.

Check installed workspace dependencies against the lockfile before changing code to fix a compatibility error.

**Why:** A task environment retained an old form adapter symlink even though the manifest and lockfile already selected the compatible version. A frozen-lockfile install resolved the error without any source or dependency changes.

**How to apply:** When declared versions appear correct but diagnostics imply an older API, inspect the installed package and refresh with `pnpm install --frozen-lockfile` before editing schemas or upgrading libraries.

Pin API generator compatibility modes explicitly when dependencies use workspace
catalog references.

**Why:** Generator auto-detection can fail to resolve catalog versions and emit
the wrong Zod generation or React Query option shape even though dependencies
and application code are compatible.

**How to apply:** Match the generator's schema and query modes to the installed
workspace consumers before regenerating contracts; do not upgrade shared runtime
libraries merely to accommodate incorrectly inferred generated code.

Refresh emitted shared-library declarations after changing the schema-library generation, before fixing consumer inference errors.

**Why:** Incremental output retained references to the old Zod internals after a catalog upgrade and made a generated body's safe-parse result appear untyped. Rebuilding shared declarations restored the actual types without weakening consumer code.

**How to apply:** Force the shared TypeScript build when a dependency-generation change produces inexplicable `any` inference; then assess genuine input/output differences such as form coercion separately.

Do not let creation defaults change omitted PATCH fields.

**Why:** Zod 4 applies defaults inside optional fields differently from Zod 3. After the generation change, a harmless description/deactivation patch could reset limits, active flags or workflow actions and invalidate an otherwise valid configuration.

**How to apply:** Validate partial updates, then keep only top-level fields explicitly supplied by the caller. Preserve false/zero/null and validation/defaults inside explicitly replaced nested structures. Test omission independently of normal creation validation when changing schema libraries.

Check generated path-parameter validators before consuming a new UUID route.

**Why:** The installed generator/Zod combination emitted a UUID method on a coerced string that the installed Zod type does not support. Generating files succeeded, but the shared-library build failed.

**How to apply:** Keep strict UUID validation at the server boundary and a compatible path-string contract when necessary; compile generated output before running consumers. Do not patch generated validators by hand or weaken server validation.

Do not assume that a newer Minimatch is compatible with a legacy archive
consumer merely because it still exports Minimatch and GLOBSTAR.

**Why:** A global upgrade cleared an audit but made legacy glob traversal return
an empty file set, while an Excel workbook buffer round-trip still passed.
That can silently omit attachments rather than throw a useful error.

**How to apply:** Test real traversal with braces, globstar, hidden files and
ignores through each installed consumer, as well as workbook import/export.
If incompatible, retain the rejected experiment as evidence and restore the
lockfile; migrate the archive consumer deliberately rather than waive the audit.

Migrate and verify both workbook writer and extractor chains, including legacy
non-native stream contracts. A small buffered round-trip is insufficient.

**Why:** Updating the writer left a vulnerable reader chain; strict stream
recognition broke a legacy input, and tiny worksheets missed Arabic corruption
at ZIP/XML chunk boundaries. An audit pass alone cannot detect content loss.

**How to apply:** Verify actual archive entries and bytes, buffered and streaming
writers/readers, and long Unicode text crossing64KiB plus individual byte
boundaries. Require content equality, not just successful parsing or row counts.
