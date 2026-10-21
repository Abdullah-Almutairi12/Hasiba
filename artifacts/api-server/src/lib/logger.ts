import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const safeLoggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']",
      "password", "passwordHash", "token", "secret", "authorization", "cookie",
      "*.password", "*.passwordHash", "*.token", "*.secret",
      "req.body", "body", "financialData",
      "email", "emails", "recipient", "*.email", "*.recipient",
      "reason", "details", "amount", "total", "subtotal", "balance",
      "*.amount", "*.total", "*.balance",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    // DB errors can include SQL parameters (financial rows, emails or secrets).
    // Keep diagnostic locations and codes, never arbitrary error properties/messages.
    err(value: unknown) {
      const err = value as { name?: unknown; code?: unknown; stack?: unknown };
      return {
        type: typeof err?.name === "string" ? err.name : "Error",
        code: typeof err?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(err.code) ? err.code : undefined,
        stack: typeof err?.stack === "string"
          ? err.stack.split("\n").slice(1).filter((line) => /^\s+at /.test(line)).join("\n")
          : undefined,
      };
    },
  },
  ...(isProduction || process.env.NODE_ENV === "test"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
};

export const logger = pino(safeLoggerOptions);
