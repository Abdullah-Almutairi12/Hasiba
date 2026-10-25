import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import posRouter from "./pos";
import returnSettlementRouter from "./return-settlement";
import invoicesRouter from "./invoices";
import accountingRouter from "./accounting";
import financialReportsRouter from "./financial-reports";
import reportsRouter from "./reports";
import reportsBuilderRouter from "./reports-builder";
import dashboardsRouter from "./dashboards";
import customersRouter from "./customers";
import branchesRouter from "./branches";
import warehousesRouter from "./warehouses";
import inventoryRouter from "./inventory";
import stockRevaluationsRouter from "./stock-revaluations";
import usersRouter from "./users";
import securityRouter from "./security";
import projectsRouter from "./projects";
import marketingRouter from "./marketing";
import adminRouter from "./admin";
import companiesRouter from "./companies";
import appSettingsRouter from "./app-settings";
import aiRouter from "./ai";
import suppliersRouter from "./suppliers";
import procurementRouter from "./procurement";
import salesRouter from "./sales";
import crmRouter from "./crm";
import storageRouter from "./storage";
import exportsRouter from "./exports";
import hrRouter, { hrPublicRouter } from "./hr";
import manufacturingRouter from "./manufacturing";
import workflowRouter from "./workflow";
import integrationsRouter, { integrationsPublicRouter } from "./integrations";
import anomaliesRouter from "./anomalies";
import portalAuthRouter from "./portal-auth";
import portalRouter from "./portal";
import intercompanyRouter, {
  intercompanyEmailActionRouter,
  intercompanyPublicRouter,
} from "./intercompany";
import liquidityRouter from "./liquidity";
import complianceRouter from "./compliance";
import vatRouter from "./vat";
import documentsRouter, { signPublicRouter } from "./documents";
import docsRouter from "./docs";
import { requireAuth } from "../middlewares/require-auth";
import { managedAccessGate } from "../middlewares/managed-access";
import { teamPublicRouter, makeTeamRouter } from "./team";
import { administrationReceiptRouter, administrationRouter } from "./administration";
import { requireCompanyContext } from "../middlewares/require-company-context";
import printProfileRouter from "./print-profile";
import operationalDocumentsRouter from "./operational-documents";
import sellersRouter from "./sellers";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { aggregatePrintGuard,checkDocumentPrint } from "../lib/print-permissions";
import { FinancialRequestError } from "../lib/financial-transaction";

const router: IRouter = Router();
router.use((req,res,next)=>{
  res.setHeader("X-Request-ID",String(req.id));
  if(req.method==="GET"){res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");}
  next();
});

// Public routes (no auth required)
router.use(healthRouter);
router.use(authRouter);
router.use(teamPublicRouter);
router.use(administrationReceiptRouter);

// Public user-manual endpoints (PDF export + JSON manifest). Mounted
// BEFORE requireAuth so the docs site and external links work without
// a session — they only expose static text from @workspace/docs-content.
router.use(docsRouter);
// HR device webhook is API-key authenticated and must bypass session auth.
router.use(hrPublicRouter);
// Payment provider webhooks verify HMAC and must bypass session auth.
router.use(integrationsPublicRouter);
// Portal magic-link auth + per-portal endpoints (token-authenticated, not session).
router.use(portalAuthRouter);
router.use(portalRouter);
// Public e-signature endpoints (token-authenticated, bypass session auth).
router.use(signPublicRouter);
// Intercompany digest unsubscribe (token-authenticated email link).
router.use(intercompanyPublicRouter);
// Intercompany morning-digest one-click action links (token-auth).
router.use(intercompanyEmailActionRouter);

// All business routes require an authenticated session and a tenant
// context (Multi-Company Phase 2). A handful of cross-tenant admin
// surfaces (companies, app_settings, admin panel) still
// require auth but bypass company scoping — they are mounted BEFORE
// requireCompanyContext below.
router.use(requireAuth);
// CSRF defense-in-depth: reject cross-origin POST/PUT/PATCH/DELETE on
// every authenticated route. Webhooks and token-authenticated public
// routes above bypass this. See middlewares/require-same-origin.ts.
router.use(requireSameOrigin);
router.use(managedAccessGate);

// Cross-tenant routes — auth only, no company scope:
//   /companies (Phase 3), /app-settings, /admin/*, /storage
// These manage data that is either global (app-settings) or that
// itself selects/joins on companies (admin panel for the tenant).
// Users are global identities, but their administration is tenant-scoped
// inside this router using the active company's membership roster.
router.use(usersRouter);
router.use(adminRouter);
// Company administration validates active context internally; target-company
// management also requires an explicit owner membership in that company.
router.use(companiesRouter);
router.use(appSettingsRouter);
router.use(storageRouter);

// Everything past this point operates inside a single tenant.
router.use(requireCompanyContext);
router.use(administrationRouter);
router.use(makeTeamRouter(() => router.stack));
router.use(printProfileRouter);
router.use(operationalDocumentsRouter);
router.use(sellersRouter);
router.use("/exports",aggregatePrintGuard);
router.use(async(req,res,next)=>{
  if(req.method!=="GET")return next();
  const documents:Array<[RegExp,"invoice"|"supplier"|"po"|"pos"]>=[
    [/^\/sales\/invoices\/(\d+)(?:\/pdf)?$/,"invoice"],
    [/^\/invoices\/(\d+)(?:\/pdf)?$/,"supplier"],
    [/^\/procurement\/purchase-orders\/(\d+)\/pdf$/,"po"],
    [/^\/pos\/orders\/(\d+)\/receipt$/,"pos"],
  ];
  try{
    for(const [pattern,kind] of documents){const m=req.path.match(pattern);if(m){await checkDocumentPrint(req,kind,Number(m[1]));break;}}
    next();
  }catch(e){
    req.log.warn({errorName:e instanceof Error?e.name:"Unknown",diagnosticRef:String(req.id)},"document download scope denied");
    res.status(e instanceof FinancialRequestError?e.status:500).json({error:e instanceof FinancialRequestError?e.message:"تعذر التحقق من صلاحية المستند",diagnosticRef:String(req.id)});
  }
});

router.use(dashboardRouter);
router.use(productsRouter);
router.use(posRouter);
router.use(returnSettlementRouter);
router.use(invoicesRouter);
router.use(accountingRouter);
router.use(financialReportsRouter);
router.use(reportsRouter);
router.use(reportsBuilderRouter);
router.use(dashboardsRouter);
router.use(customersRouter);
router.use(branchesRouter);
router.use(warehousesRouter);
router.use(stockRevaluationsRouter);
router.use(inventoryRouter);
router.use(securityRouter);
router.use(projectsRouter);
router.use(marketingRouter);
router.use(aiRouter);
router.use(suppliersRouter);
router.use(procurementRouter);
router.use(salesRouter);
router.use(intercompanyRouter);
router.use(liquidityRouter);
router.use(complianceRouter);
router.use(vatRouter);
router.use(crmRouter);
router.use(exportsRouter);
router.use(hrRouter);
router.use(manufacturingRouter);
router.use(workflowRouter);
router.use(integrationsRouter);
router.use(anomaliesRouter);
router.use(documentsRouter);

export default router;
