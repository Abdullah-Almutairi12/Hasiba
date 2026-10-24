---
name: PostgreSQL array binding
description: Drizzle SQL templates expand JavaScript arrays rather than binding them as PostgreSQL arrays
---
Do not interpolate a JavaScript array directly into a Drizzle `sql` template and then cast it to a PostgreSQL array for `ANY`.

**Why:** The template expands it into tuple chunks. A one-element input becomes an integer cast, and multiple elements become a row cast; both fail instead of representing an SQL array.

**How to apply:** Use an explicit typed `ARRAY[...]` built from bound scalar parameters, or bind a properly validated PostgreSQL array-literal string as one parameter. Verify both one-branch and multi-branch inputs; a TypeScript check does not catch this SQL construction error.
