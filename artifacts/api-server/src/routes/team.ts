import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TEAM_ACTIONS, TEAM_MODULES, TEAM_TEMPLATES, TeamPersonInput, GrantInput } from "../lib/team-catalog";
import { teamOwner, teamRows, teamWrite, teamPeople, teamPolicy, teamAudit, previewTeamPerson, createTeamPerson, updateTeamPerson } from "../lib/team-store";
import { issueTeamInvitation, inspectTeamInvitation, acceptTeamInvitation } from "../lib/team-invitations";
import { managedProfile, currentResponsibilities, requireResponsibility } from "../lib/responsibility-context";
import { scopedRouteAction } from "../middlewares/managed-access";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { FinancialRequestError } from "../lib/financial-transaction";
import { getCompanyId } from "../lib/scoped-db";
import { scopedIncomingTransfers } from "../lib/scoped-inventory-receipts";
import { LegacyConversionInput, legacyTeamUsers, previewLegacyTeamConversion, applyLegacyTeamConversion,
  previewLegacyTeamRollback, rollbackLegacyTeamConversion } from "../lib/legacy-team-conversion";

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (handler: AsyncHandler) => async (req: Request, res: Response, next: NextFunction) => {
  try { await handler(req, res); } catch (err) {
    if (err instanceof FinancialRequestError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues.map(i => i.message).join("؛ ") });
    next(err);
  }
};
const id = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
const TokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const teamPublicRouter = Router();
const activationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "تجاوزت محاولات التفعيل؛ حاول لاحقًا" } });
teamPublicRouter.post("/auth/team-activation/inspect", activationLimiter, requireSameOrigin, wrap(async (req, res) => {
  res.json(await inspectTeamInvitation(TokenInput.parse(req.body).token));
}));
teamPublicRouter.post("/auth/team-activation/accept", activationLimiter, requireSameOrigin, wrap(async (req, res) => {
  const body = TokenInput.extend({ password: z.string().min(1).max(1024) }).parse(req.body);
  res.json(await acceptTeamInvitation(body.token, body.password, req.session.userId));
}));

type RouteLayer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: RouteLayer[] } };
function routeInventory(stack: unknown[]): Array<{ method: string; path: string; enforcement: string }> {
  return stack.flatMap(raw => { const layer = raw as RouteLayer; return layer.route ? Object.keys(layer.route.methods).flatMap(method =>
    (Array.isArray(layer.route!.path) ? layer.route!.path : [layer.route!.path]).map(String).map(path => ({
      method: method.toUpperCase(), path,
      enforcement: scopedRouteAction(method.toUpperCase(), path.replace(/:id/g, "1")) ? "scoped_supported" : "scoped_denied_legacy_unchanged",
    }))) : routeInventory(layer.handle?.stack ?? []); });
}
export function makeTeamRouter(getStack: () => unknown[]) {
  const router = Router();
  router.get("/team/legacy/users", wrap(async (req, res) => {
    res.json(await legacyTeamUsers(getCompanyId(req), req.session.userId!));
  }));
  router.post("/team/legacy/preview", wrap(async (req, res) => {
    res.json(await previewLegacyTeamConversion(getCompanyId(req), req.session.userId!, LegacyConversionInput.parse(req.body)));
  }));
  router.post("/team/legacy/apply", wrap(async (req, res) => {
    const body = LegacyConversionInput.extend({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    res.json(await applyLegacyTeamConversion(getCompanyId(req), req.session.userId!,
      { userId: body.userId, person: body.person }, body.expectedDigest));
  }));
  router.get("/team/legacy/:id/rollback-preview", wrap(async (req, res) => {
    res.json(await previewLegacyTeamRollback(getCompanyId(req), req.session.userId!, id(req)));
  }));
  router.post("/team/legacy/:id/rollback", wrap(async (req, res) => {
    const body = z.object({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body);
    res.json(await rollbackLegacyTeamConversion(getCompanyId(req), req.session.userId!, id(req), body.expectedDigest, body.reason));
  }));
  router.get("/team/catalog", wrap(async (req, res) => {
    await teamOwner(getCompanyId(req), req.session.userId!);
    res.json({ actions: TEAM_ACTIONS, templates: TEAM_TEMPLATES, routes: routeInventory(getStack()) });
  }));
  router.get("/team/setup", wrap(async (req, res) => {
    const companyId = getCompanyId(req);
    await teamOwner(companyId, req.session.userId!);
    const [state] = await teamRows(db, sql`SELECT mode,step,draft,revision FROM team_setup_state WHERE company_id=${companyId}`);
    res.json({ ...(state ?? { mode: "team", step: "people", draft: {}, revision: 0 }), policy: await teamPolicy(companyId) });
  }));
  // A partial form may be saved, but secrets/arbitrary fields cannot enter a
  // resumable draft. Incomplete rows are inert draft data, never grants.
  const draftPerson = z.object({
    creationKey: z.string().uuid().optional(), name: z.string().max(200).optional(),
    email: z.string().max(320).nullable().optional(), loginKinds: z.array(z.enum(["platform","pos"])).max(2).optional(),
    grants: z.array(z.object({
      resource: z.enum(["inventory","pos"]), branchId: z.number().int().nonnegative().optional(),
      warehouseIds: z.array(z.number().int().positive()).max(100).optional(),
      actions: z.array(z.string().max(100)).max(30).optional(),
      amountLimit: z.string().max(40).nullable().optional(),
      startsAt: z.string().max(50).nullable().optional(), endsAt: z.string().max(50).nullable().optional(),
    }).strict()).max(30).optional(), deniedActions: z.array(z.string().max(100)).max(30).optional(),
  }).strict();
  router.put("/team/setup", wrap(async (req, res) => {
    const body = z.object({ expectedRevision: z.number().int().nonnegative(), mode: z.enum(["solo","team"]),
      step: z.enum(["people","access","review","done"]),
      draft: z.object({ person: draftPerson.optional(), selectedPersonId: z.number().int().positive().nullable().optional() }).strict() }).strict().parse(req.body);
    const companyId = getCompanyId(req), userId = req.session.userId!;
    const state = await teamWrite(companyId, userId, async tx => {
      const [old] = await teamRows<{ revision: number }>(tx, sql`SELECT revision FROM team_setup_state WHERE company_id=${companyId}`);
      if ((old?.revision ?? 0) !== body.expectedRevision) throw new FinancialRequestError("الإعداد تغير في جلسة أخرى؛ أعد تحميله", 409);
      const [saved] = await teamRows(tx, sql`INSERT INTO team_setup_state(company_id,mode,step,draft,revision,updated_by)
        VALUES(${companyId},${body.mode},${body.step},${JSON.stringify(body.draft)}::jsonb,1,${userId})
        ON CONFLICT(company_id) DO UPDATE SET mode=excluded.mode,step=excluded.step,draft=excluded.draft,
          revision=team_setup_state.revision+1,updated_by=excluded.updated_by,updated_at=now()
        RETURNING mode,step,draft,revision`);
      await teamAudit(tx, companyId, userId, "team.setup.save", { mode: body.mode, step: body.step, revision: Number(saved.revision) });
      return { ...saved, policy: await teamPolicy(companyId, tx) };
    });
    res.json(state);
  }));
  router.put("/team/policy", wrap(async (req, res) => {
    if (process.env.NODE_ENV === "production") throw new FinancialRequestError("الاستحقاقات التجارية لا تعدل عبر إعداد تطويري", 403);
    const body = z.object({ enabledModules: z.array(z.string()).max(TEAM_MODULES.length),
      seatLimit: z.number().int().nonnegative().nullable() }).strict().parse(req.body);
    if (body.enabledModules.some(m => !TEAM_MODULES.includes(m))) throw new FinancialRequestError("وحدة غير معروفة", 400);
    const companyId = getCompanyId(req), userId = req.session.userId!;
    res.json(await teamWrite(companyId, userId, async tx => {
      const previous = await teamPolicy(companyId, tx);
      await tx.execute(sql`INSERT INTO team_access_policy(company_id,enabled_modules,seat_limit,updated_by)
        VALUES(${companyId},${sql.param(body.enabledModules)}::text[],${body.seatLimit},${userId})
        ON CONFLICT(company_id) DO UPDATE SET enabled_modules=excluded.enabled_modules,seat_limit=excluded.seat_limit,
          updated_by=excluded.updated_by,updated_at=now()`);
      const after = await teamPolicy(companyId, tx);
      await teamAudit(tx, companyId, userId, "team.policy.development", { before: previous, after });
      return after;
    }));
  }));
  router.get("/team/people", wrap(async (req, res) => {
    await teamOwner(getCompanyId(req), req.session.userId!);
    res.json(await teamPeople(getCompanyId(req)));
  }));
  router.post("/team/people/preview", wrap(async (req, res) => {
    const companyId = getCompanyId(req);
    await teamOwner(companyId, req.session.userId!);
    const person = TeamPersonInput.parse(req.body);
    const [existing] = await teamRows<{ employee_id: number }>(db,
      sql`SELECT employee_id FROM employee_access WHERE company_id=${companyId} AND creation_key=${person.creationKey}`);
    res.json(await previewTeamPerson(companyId, person, db, existing?.employee_id));
  }));
  router.post("/team/people", wrap(async (req, res) => {
    res.status(201).json(await createTeamPerson(getCompanyId(req), req.session.userId!, TeamPersonInput.parse(req.body)));
  }));
  router.put("/team/people/:id/access", wrap(async (req, res) => {
    const body = z.object({ expectedRevision: z.number().int().positive(), person: TeamPersonInput,
      suspended: z.boolean() }).strict().parse(req.body);
    res.json(await updateTeamPerson(getCompanyId(req), req.session.userId!, id(req), body.expectedRevision, body.person, body.suspended));
  }));
  router.post("/team/people/:id/invite", wrap(async (req, res) => {
    const { expectedRevision } = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(req.body);
    res.status(201).json(await issueTeamInvitation(getCompanyId(req), req.session.userId!, id(req), expectedRevision));
  }));
  router.delete("/team/people/:id/invite", wrap(async (req, res) => {
    const companyId = getCompanyId(req), userId = req.session.userId!, personId = id(req);
    await teamWrite(companyId, userId, async tx => {
      if (!(await teamPeople(companyId, tx, personId)).length) throw new FinancialRequestError("الشخص غير متاح", 404);
      await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${companyId}
        AND employee_id=${personId} AND revoked_at IS NULL AND used_at IS NULL`);
      await teamAudit(tx, companyId, userId, "team.invitation.revoke", { personId });
    });
    res.json({ ok: true });
  }));
  router.get("/workspace/access", wrap(async (req, res) => {
    const companyId = getCompanyId(req), userId = req.session.userId!;
    const profile = await managedProfile(userId, companyId);
    const [company] = await teamRows<{ vat_registration_status: string }>(db,
      sql`SELECT vat_registration_status FROM companies WHERE id=${companyId}`);
    res.json({ managed: !!profile, status: profile?.status ?? "legacy", revision: profile?.revision ?? 0,
      deniedActions: profile?.deniedActions ?? [], grants: profile ? await currentResponsibilities(userId, companyId) : [],
      vatRegistered: ["registered","voluntary"].includes(company?.vat_registration_status) });
  }));
  router.get("/workspace/inventory", wrap(async (_req, res) => {
    const grant = await requireResponsibility("inventory.read");
    const context = (await import("../lib/responsibility-context")).responsibilityContext.getStore()!;
    res.json(await teamRows(db, sql`SELECT p.id AS "productId",p.name_ar AS "productName",w.id AS "warehouseId",
      w.name AS "warehouseName",q.quantity::text AS quantity,
      CASE WHEN ${grant.actions.includes("inventory.cost.read")} THEN q.avg_cost::text ELSE NULL END AS cost
      FROM stock_quants q JOIN warehouses w ON w.id=q.warehouse_id AND w.company_id=${context.companyId}
      JOIN products p ON p.id=q.product_id AND p.company_id=w.company_id
      WHERE w.branch_id=${grant.branchId} AND w.id=ANY(${sql.param(grant.warehouseIds)}::integer[])
      ORDER BY p.id,w.id LIMIT 1000`));
  }));
  router.get("/workspace/inventory/transfers",wrap(async (_req,res)=>{
    res.json(await scopedIncomingTransfers());
  }));
  return router;
}
