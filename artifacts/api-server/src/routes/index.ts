import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import posRouter from "./pos";
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
import usersRouter from "./users";
import securityRouter from "./security";
import projectsRouter from "./projects";
import marketingRouter from "./marketing";
import adminRouter from "./admin";
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
import documentsRouter, { signPublicRouter } from "./documents";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(healthRouter);
router.use(authRouter);
// HR device webhook is API-key authenticated and must bypass session auth.
router.use(hrPublicRouter);
// Payment provider webhooks verify HMAC and must bypass session auth.
router.use(integrationsPublicRouter);
// Portal magic-link auth + per-portal endpoints (token-authenticated, not session).
router.use(portalAuthRouter);
router.use(portalRouter);
// Public e-signature endpoints (token-authenticated, bypass session auth).
router.use(signPublicRouter);

// All business routes require an authenticated session
router.use(requireAuth);

router.use(dashboardRouter);
router.use(productsRouter);
router.use(posRouter);
router.use(invoicesRouter);
router.use(accountingRouter);
router.use(financialReportsRouter);
router.use(reportsRouter);
router.use(reportsBuilderRouter);
router.use(dashboardsRouter);
router.use(customersRouter);
router.use(branchesRouter);
router.use(warehousesRouter);
router.use(inventoryRouter);
router.use(usersRouter);
router.use(securityRouter);
router.use(projectsRouter);
router.use(marketingRouter);
router.use(adminRouter);
router.use(appSettingsRouter);
router.use(aiRouter);
router.use(suppliersRouter);
router.use(procurementRouter);
router.use(salesRouter);
router.use(crmRouter);
router.use(storageRouter);
router.use(exportsRouter);
router.use(hrRouter);
router.use(manufacturingRouter);
router.use(workflowRouter);
router.use(integrationsRouter);
router.use(anomaliesRouter);
router.use(documentsRouter);

export default router;
