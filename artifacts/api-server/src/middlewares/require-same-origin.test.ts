/**
 * Unit tests for the CSRF defense-in-depth Origin/Referer check.
 * Covers: safe-method pass-through, header-less S2S pass-through,
 * matching Origin allow, mismatching Origin reject, Referer fallback,
 * unparseable Referer reject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireSameOrigin } from "./require-same-origin";

interface FakeReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  get(name: string): string | undefined;
  log: { warn: (...args: unknown[]) => void };
}

function makeReq(method: string, headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const req: FakeReq = {
    method,
    url: "/api/test",
    headers: lower,
    get(name: string) {
      return lower[name.toLowerCase()];
    },
    log: { warn: vi.fn() },
  };
  return req as unknown as Request;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {
    _status: undefined as number | undefined,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res as unknown as Response & { _status?: number; _body?: unknown };
}

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  process.env.ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DOMAINS = "myapp.replit.app";
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  process.env = originalEnv;
});

describe("requireSameOrigin", () => {
  it("passes through GET requests without checking origin", () => {
    const req = makeReq("GET", { origin: "https://evil.example.com" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it("passes through HEAD and OPTIONS", () => {
    for (const m of ["HEAD", "OPTIONS"]) {
      const req = makeReq(m, { origin: "https://evil.example.com" });
      const res = makeRes();
      const next: NextFunction = vi.fn();
      requireSameOrigin(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("passes through non-browser POST with no Origin and no Referer (S2S/curl)", () => {
    const req = makeReq("POST");
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows POST whose Origin is in ALLOWED_ORIGINS", () => {
    const req = makeReq("POST", { origin: "https://app.example.com" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows POST whose Origin matches REPLIT_DOMAINS via https://", () => {
    const req = makeReq("POST", { origin: "https://myapp.replit.app" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects POST whose Origin is not in the allowlist (403)", () => {
    const req = makeReq("POST", { origin: "https://evil.example.com" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("falls back to Referer when Origin is absent (allowed)", () => {
    const req = makeReq("PATCH", { referer: "https://app.example.com/dashboard" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("falls back to Referer when Origin is absent (rejected)", () => {
    const req = makeReq("DELETE", { referer: "https://evil.example.com/x" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("rejects POST with unparseable Referer and no Origin", () => {
    const req = makeReq("POST", { referer: "not-a-url" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("allows any localhost port in development mode", () => {
    process.env.NODE_ENV = "development";
    const req = makeReq("POST", { origin: "http://localhost:5173" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("parses comma-separated REPLIT_DOMAINS and allows every listed host", () => {
    process.env.REPLIT_DOMAINS = "primary.replit.app, secondary.replit.app ,third.replit.app";
    process.env.ALLOWED_ORIGINS = "";
    for (const host of ["primary.replit.app", "secondary.replit.app", "third.replit.app"]) {
      const req = makeReq("POST", { origin: `https://${host}` });
      const res = makeRes();
      const next: NextFunction = vi.fn();
      requireSameOrigin(req, res, next);
      expect(next, `expected ${host} to be allowed`).toHaveBeenCalledOnce();
      expect(res._status).toBeUndefined();
    }
  });

  it("rejects unknown origin even in development", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOWED_ORIGINS = "";
    process.env.REPLIT_DOMAINS = "";
    const req = makeReq("POST", { origin: "https://evil.example.com" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireSameOrigin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });
});
