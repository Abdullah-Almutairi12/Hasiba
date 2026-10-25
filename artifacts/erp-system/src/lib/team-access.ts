import type {
  TeamAction,
  TeamGrantInput,
  TeamPerson,
  TeamPersonInput,
  TeamPersonInputLoginKindsItem,
  Warehouse,
} from "@workspace/api-client-react";

export type GrantResource = "inventory" | "pos";
export type LoginKind = TeamPersonInputLoginKindsItem;

export const RESOURCE_LABEL: Record<string, string> = {
  inventory: "المخزون",
  pos: "نقطة البيع",
};

export const STATUS_META: Record<string, { label: string; tone: "ok" | "warn" | "off" | "info" }> = {
  active: { label: "نشط", tone: "ok" },
  invited: { label: "دعوة بانتظار التفعيل", tone: "info" },
  pending: { label: "بانتظار الدعوة", tone: "info" },
  record: { label: "سجل فقط — بلا دخول", tone: "off" },
  record_only: { label: "سجل فقط — بلا دخول", tone: "off" },
  suspended: { label: "موقوف", tone: "warn" },
  device_setup_required: { label: "يتطلب جهازًا مسجّلًا", tone: "warn" },
  revoked: { label: "ملغى", tone: "off" },
};

export function statusMeta(status: string | undefined | null) {
  return STATUS_META[status ?? ""] ?? { label: status || "غير معروف", tone: "info" as const };
}

export function newCreationKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function emptyPerson(): TeamPersonInput {
  return { creationKey: newCreationKey(), name: "", email: null, loginKinds: [], grants: [], deniedActions: [] };
}

/** New responsibilities start narrow: no branch, no warehouses, no actions. */
export function emptyGrant(resource: GrantResource): TeamGrantInput {
  return { resource, branchId: 0, warehouseIds: [], actions: [], amountLimit: null, startsAt: null, endsAt: null };
}

export function personToInput(p: TeamPerson): TeamPersonInput {
  return {
    creationKey: p.creationKey,
    name: p.name,
    email: p.email ?? null,
    loginKinds: [...(p.loginKinds ?? [])],
    grants: (p.grants ?? []).map((g) => ({
      resource: g.resource,
      branchId: g.branchId,
      warehouseIds: [...g.warehouseIds],
      actions: [...g.actions],
      amountLimit: g.amountLimit ?? null,
      startsAt: g.startsAt ?? null,
      endsAt: g.endsAt ?? null,
      ...bindingOf(g),
    })),
    deniedActions: [...(p.deniedActions ?? [])],
  };
}

export function actionsFor(catalog: TeamAction[] | undefined, resource: string): TeamAction[] {
  return (catalog ?? []).filter((a) => a.resource === resource);
}

export function availableKeys(catalog: TeamAction[] | undefined): Set<string> {
  return new Set((catalog ?? []).filter((a) => a.available).map((a) => a.key));
}

const DECIMAL = /^(0|[1-9]\d{0,11})(\.\d{1,4})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isDecimalString(v: string): boolean {
  return DECIMAL.test(v.trim());
}

/** Is this an action that reveals cost? Optional and never defaulted. */
export function isCostAction(key: string): boolean {
  return /cost/i.test(key);
}

export type PersonIssue = { path: string; message: string };

export function validatePerson(
  person: TeamPersonInput,
  catalog: TeamAction[] | undefined,
  warehouses: Warehouse[] | undefined,
): PersonIssue[] {
  const issues: PersonIssue[] = [];
  const avail = availableKeys(catalog);
  if (!person.name.trim()) issues.push({ path: "name", message: "اكتب اسم الشخص." });
  if (person.email !== null && person.email.trim() !== "" && !EMAIL.test(person.email.trim())) {
    issues.push({ path: "email", message: "البريد الإلكتروني غير صالح." });
  }
  if (person.loginKinds.includes("platform") && !person.email?.trim()) {
    issues.push({ path: "email", message: "دخول المنصة يتطلب بريدًا حقيقيًا للشخص نفسه." });
  }
  if (person.loginKinds.length > 0 && person.grants.length === 0) {
    issues.push({ path: "grants", message: "أضف مسؤولية واحدة على الأقل قبل منح الدخول." });
  }
  person.grants.forEach((g, i) => {
    const p = `grants.${i}`;
    if (!g.branchId) issues.push({ path: `${p}.branchId`, message: `المسؤولية ${i + 1}: اختر الفرع.` });
    if (g.warehouseIds.length === 0) issues.push({ path: `${p}.warehouseIds`, message: `المسؤولية ${i + 1}: اختر مستودعًا واحدًا على الأقل.` });
    if (warehouses) {
      const foreign = g.warehouseIds.filter((id) => warehouses.find((w) => w.id === id)?.branchId !== g.branchId);
      if (foreign.length) issues.push({ path: `${p}.warehouseIds`, message: `المسؤولية ${i + 1}: المستودعات يجب أن تتبع الفرع نفسه.` });
    }
    if (g.actions.length === 0) issues.push({ path: `${p}.actions`, message: `المسؤولية ${i + 1}: اختر إجراءً واحدًا على الأقل.` });
    else if (!g.actions.includes(baseReadAction(g.resource)))
      issues.push({ path: `${p}.actions`, message: `المسؤولية ${i + 1}: كل إجراء يتطلب صلاحية العرض الأساسية (${baseReadAction(g.resource)}). فعّلها صراحة — لا تُمنح تلقائيًا.` });
    const bad = g.actions.filter((a) => !avail.has(a));
    if (bad.length) issues.push({ path: `${p}.actions`, message: `المسؤولية ${i + 1}: إجراءات غير متاحة: ${bad.join("، ")}` });
    if (g.amountLimit !== null && !isDecimalString(g.amountLimit)) {
      issues.push({ path: `${p}.amountLimit`, message: `المسؤولية ${i + 1}: السقف رقم عشري موجب (حتى 4 خانات).` });
    }
    if (g.startsAt && g.endsAt && new Date(g.endsAt) <= new Date(g.startsAt)) {
      issues.push({ path: `${p}.endsAt`, message: `المسؤولية ${i + 1}: تاريخ الانتهاء يجب أن يلي البداية.` });
    }
  });
  return issues;
}

/** Normalise before sending (trim, null empties, dedupe). */
export function normalizePerson(p: TeamPersonInput): TeamPersonInput {
  const email = p.email?.trim() ? p.email.trim().toLowerCase() : null;
  return {
    creationKey: p.creationKey,
    name: p.name.trim(),
    email,
    loginKinds: Array.from(new Set(p.loginKinds)),
    // Strict input: only declared fields (no grant ids).
    grants: p.grants.map((g) => ({
      resource: g.resource,
      branchId: g.branchId,
      startsAt: g.startsAt ?? null,
      endsAt: g.endsAt ?? null,
      warehouseIds: Array.from(new Set(g.warehouseIds)),
      actions: Array.from(new Set(g.actions)),
      amountLimit: g.amountLimit?.trim() ? g.amountLimit.trim() : null,
      ...bindingOf(g),
    })),
    deniedActions: Array.from(new Set(p.deniedActions)),
  };
}

/** POS login without a real email cannot activate until device auth exists. */
export function needsDeviceSetup(p: Pick<TeamPersonInput, "loginKinds" | "email">): boolean {
  return p.loginKinds.includes("pos") && !p.email?.trim();
}

export function canInvite(p: Pick<TeamPersonInput, "loginKinds" | "email">): boolean {
  return p.loginKinds.length > 0 && !!p.email?.trim();
}

/** Draft payload as accepted by PUT /team/setup. Never carries tokens or passwords. */
export type SetupDraft = {
  person?: Partial<Pick<TeamPersonInput, "creationKey" | "name" | "email" | "loginKinds" | "grants" | "deniedActions">>;
  selectedPersonId?: number | null;
};

export function toDraft(person: TeamPersonInput | null, selectedPersonId: number | null): SetupDraft {
  const d: SetupDraft = {};
  if (person) {
    d.person = {
      creationKey: person.creationKey,
      name: person.name,
      email: person.email,
      loginKinds: [...person.loginKinds],
      grants: person.grants.map((g) => ({
        resource: g.resource, branchId: g.branchId, warehouseIds: [...g.warehouseIds], actions: [...g.actions],
        amountLimit: g.amountLimit ?? null, startsAt: g.startsAt ?? null, endsAt: g.endsAt ?? null,
        ...bindingOf(g),
      })),
      deniedActions: [...person.deniedActions],
    };
  }
  // Explicit null is accepted by the safe-draft endpoint.
  d.selectedPersonId = selectedPersonId && selectedPersonId > 0 ? selectedPersonId : null;
  return d;
}

export function fromDraft(raw: unknown): { person: TeamPersonInput | null; selectedPersonId: number | null } {
  if (!raw || typeof raw !== "object") return { person: null, selectedPersonId: null };
  const r = raw as Record<string, unknown>;
  const selectedPersonId = typeof r.selectedPersonId === "number" && r.selectedPersonId > 0 ? r.selectedPersonId : null;
  const p = r.person as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return { person: null, selectedPersonId };
  const base = emptyPerson();
  const kinds = Array.isArray(p.loginKinds) ? p.loginKinds.filter((k): k is LoginKind => k === "platform" || k === "pos") : [];
  const grants = Array.isArray(p.grants)
    ? (p.grants as Record<string, unknown>[]).filter((g) => g && (g.resource === "inventory" || g.resource === "pos")).map((g) => ({
        resource: g.resource as GrantResource,
        branchId: typeof g.branchId === "number" ? g.branchId : 0,
        warehouseIds: Array.isArray(g.warehouseIds) ? (g.warehouseIds as unknown[]).filter((n): n is number => typeof n === "number") : [],
        actions: Array.isArray(g.actions) ? (g.actions as unknown[]).filter((n): n is string => typeof n === "string") : [],
        amountLimit: typeof g.amountLimit === "string" ? g.amountLimit : null,
        startsAt: typeof g.startsAt === "string" ? g.startsAt : null,
        endsAt: typeof g.endsAt === "string" ? g.endsAt : null,
        ...bindingOf(g as Partial<TeamGrantInput>),
      }))
    : [];
  return {
    selectedPersonId,
    person: {
      creationKey: typeof p.creationKey === "string" && p.creationKey ? p.creationKey : base.creationKey,
      name: typeof p.name === "string" ? p.name : "",
      email: typeof p.email === "string" ? p.email : null,
      loginKinds: kinds,
      grants,
      deniedActions: Array.isArray(p.deniedActions) ? (p.deniedActions as unknown[]).filter((n): n is string => typeof n === "string") : [],
    },
  };
}

/** Activation link: token travels in the fragment, never the query string. */
export function buildActivationUrl(origin: string, basePath: string, token: string): string {
  const base = basePath.replace(/\/+$/, "");
  return `${origin}${base}/team-activate#token=${encodeURIComponent(token)}`;
}

export function readTokenFromHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const v = new URLSearchParams(h).get("token");
  return v && v.trim() ? v.trim() : null;
}

const COMMON_PASSWORDS = [
  "password", "passw0rd", "123456", "12345678", "123456789", "1234567890", "qwerty", "qwertyuiop",
  "111111", "000000", "abc123", "iloveyou", "admin", "welcome", "letmein", "football", "monkey",
  "dragon", "sunshine", "princess", "trustno1", "master", "hasiba", "riyadh", "saudi", "ksa",
];

export const MIN_NEW_PASSWORD = 15;

export function checkNewPassword(pw: string, context: string[] = []): string | null {
  if (pw.length < MIN_NEW_PASSWORD) return `كلمة المرور يجب ألا تقل عن ${MIN_NEW_PASSWORD} حرفًا.`;
  const low = pw.toLowerCase();
  if (/^(.)\1+$/.test(pw)) return "كلمة المرور مكوّنة من حرف مكرر.";
  if (/^\d+$/.test(pw)) return "كلمة المرور أرقام فقط — اختر عبارة أطول وأقل توقعًا.";
  const stripped = low.replace(/[^a-z0-9]/g, "");
  if (COMMON_PASSWORDS.some((c) => stripped === c || (stripped.startsWith(c) && /^\d*$/.test(stripped.slice(c.length))) || stripped.replace(c, "").length < 4 && stripped.includes(c))) {
    return "كلمة المرور شائعة ويسهل تخمينها.";
  }
  for (const c of context) {
    const part = c.toLowerCase().split("@")[0].trim();
    if (part.length >= 4 && low.includes(part)) return "لا تستخدم اسمك أو بريدك داخل كلمة المرور.";
  }
  return null;
}

export function errorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return null;
}

export function errorText(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const d = (err as { data: unknown }).data;
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      const m = o.message ?? o.error ?? o.detail;
      if (typeof m === "string" && m.trim()) return m;
    }
  }
  const s = errorStatus(err);
  if (s === 409) return "تغيّر السجل على الخادم منذ فتحه. أعد التحميل لمراجعة أحدث نسخة.";
  if (s === 403) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  if (s === 401) return "انتهت الجلسة. سجّل الدخول مجددًا.";
  if (err instanceof Error && err.message) return err.message;
  return "تعذر إكمال الطلب.";
}

export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function grantWindowState(g: Pick<TeamGrantInput, "startsAt" | "endsAt">, now = new Date()): "active" | "upcoming" | "expired" {
  if (g.startsAt && new Date(g.startsAt) > now) return "upcoming";
  if (g.endsAt && new Date(g.endsAt) <= now) return "expired";
  return "active";
}

/** Every granted resource requires its base read action explicitly. */
export function baseReadAction(resource: string): string {
  return `${resource}.read`;
}

export type GrantBinding = Pick<TeamGrantInput, "templateId" | "templateRevision" | "templateMode">;

/** Template binding metadata; manual grants carry explicit nulls. Invalid shapes collapse to manual. */
export function bindingOf(g: Partial<TeamGrantInput> | Record<string, unknown>): GrantBinding {
  const r = g as Record<string, unknown>;
  const id = typeof r.templateId === "number" && r.templateId > 0 ? r.templateId : null;
  const rev = typeof r.templateRevision === "number" && r.templateRevision > 0 ? r.templateRevision : null;
  const mode = r.templateMode === "inherit" || r.templateMode === "override" ? r.templateMode : null;
  if (id === null || rev === null || mode === null) return { templateId: null, templateRevision: null, templateMode: null };
  return { templateId: id, templateRevision: rev, templateMode: mode };
}

export type GrantSource = "manual" | "inherit" | "override";
export function grantSource(g: Partial<TeamGrantInput>): GrantSource {
  const b = bindingOf(g);
  return b.templateMode ?? "manual";
}

type TemplateLike = { id: number; revision: number; resource: string; actions: string[] };

/** Bind to a company template in inherit mode, using its CURRENT revision and available actions only. */
export function inheritFrom(t: TemplateLike, available: Set<string>): Partial<TeamGrantInput> {
  return { templateId: t.id, templateRevision: t.revision, templateMode: "inherit", actions: t.actions.filter((a) => available.has(a)) };
}

/** Explicit individual exception: keeps the link and revision, actions become editable. */
export function toOverride(g: TeamGrantInput, actions: string[] = g.actions): Partial<TeamGrantInput> {
  const b = bindingOf(g);
  if (!b.templateId) return { actions };
  return { ...b, templateMode: "override", actions };
}

export function toManual(): Partial<TeamGrantInput> {
  return { templateId: null, templateRevision: null, templateMode: null };
}
