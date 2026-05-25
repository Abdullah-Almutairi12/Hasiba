import session from "express-session";
// @ts-expect-error - connect-pg-simple has no published types; we declare what we use below.
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgStore = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

// connect-pg-simple bundles a table.sql file that's lost when we bundle with esbuild.
// Create the session table manually (matches connect-pg-simple's expected schema).
async function ensureSessionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);
}

ensureSessionTable().catch((err) => {
  console.error("Failed to create session table:", err);
});

export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
  name: "hasba.sid",
});

declare module "express-session" {
  interface SessionData {
    userId?: number;
    role?:
      | "owner"
      | "manager"
      | "accountant"
      | "sales"
      | "cashier"
      | "inventory"
      | "marketing"
      | "auditor"
      | "hr";
    /**
     * Active tenant for this session. Populated at login from
     * `user_companies.is_default`, or lazily back-filled by
     * `requireCompanyContext` for pre-Phase-2 sessions.
     */
    companyId?: number;
  }
}
