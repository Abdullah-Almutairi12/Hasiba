/** The legacy seed truncates tables. Never run it against an ordinary database. */
export function assertDisposableSeedTarget(options: {
  databaseName: string;
  environment: string | undefined;
  args: readonly string[];
}): void {
  if (options.environment === "production"
    || !/^hasiba_seed_[a-f0-9]{16}$/.test(options.databaseName)
    || !options.args.includes("--confirm-disposable-seed")) {
    throw new Error("Seed refused: requires a disposable hasiba_seed_<16 hex> database and --confirm-disposable-seed; production is forbidden");
  }
}

export function requireSeedPassword(value: string | undefined): string {
  if (!value || value.length < 14 || value.length > 72
    || Buffer.byteLength(value, "utf8") > 72
    || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)
    || !/[^a-zA-Z0-9\s]/.test(value)) {
    throw new Error("Seed refused: set SEED_ADMIN_PASSWORD securely (14–72 bytes, mixed-case, number and symbol)");
  }
  return value;
}
