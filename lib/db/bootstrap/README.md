# Frozen empty-installation baseline

`0000_installation_baseline.sql` and its Drizzle metadata were generated from
the schema at code reference `6e39f6f` (2026-10-23). They are immutable input to
the installer, not regenerated on application start.

The historical SQL files are intentionally unchanged. They alone do not
initialize an empty database: the missing product ownership column stops
the history at `0008_tenant_scope_not_null.sql`.

The migrator installs this snapshot transactionally **only when the target
schema has no application tables and no recorded migrations**. Existing
recognized application schemas never receive it. Unknown partial databases
are refused instead of being guessed or overwritten.

After the baseline the original SQL history still runs, then the existing
application initializers run. This is the normal installation path exercised
by `test:isolated`; it no longer pre-creates the schema with `push`.

Do not edit already-applied migration SQL. Future schema changes require
new additive migrations. The explicit `--legacy-upgrade` fixture exports the
previous database package and its actual migrator from the pinned reference;
it reconstructs that older installation with synthetic data. It is not a
production backup or a proof for undocumented historical versions.
