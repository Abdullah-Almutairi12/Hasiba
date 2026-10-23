/** Split PostgreSQL statements without splitting quoted strings or DO bodies. */
export function splitSqlStatements(input: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (input.startsWith("--", i)) {
      const end = input.indexOf("\n", i + 2);
      i = end < 0 ? input.length : end + 1;
    } else if (input.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < input.length && depth) {
        if (input.startsWith("/*", i)) { depth++; i += 2; }
        else if (input.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment");
    } else if (c === "'" || c === '"') {
      const escape = c === "'" && /(?:^|[^a-z0-9_])e$/i.test(input.slice(Math.max(0, i - 2), i));
      i++;
      let closed = false;
      while (i < input.length) {
        if (escape && input[i] === "\\") { i += 2; continue; }
        if (input[i] === c) {
          i++;
          if (input[i] === c) { i++; continue; }
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new Error("Unterminated SQL quotation");
    } else if (c === "$" && /^\$(?:[a-z_][a-z_0-9]*)?\$/i.test(input.slice(i))) {
      const delimiter = input.slice(i).match(/^\$(?:[a-z_][a-z_0-9]*)?\$/i)![0];
      const end = input.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new Error("Unterminated SQL dollar quotation");
      i = end + delimiter.length;
    } else if (c === ";") {
      const statement = input.slice(start, ++i).trim();
      if (statement) statements.push(statement);
      start = i;
    } else i++;
  }
  const tail = input.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}
