import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import posRouter from "./pos";
import invoicesRouter from "./invoices";
import accountingRouter from "./accounting";
import reportsRouter from "./reports";
import customersRouter from "./customers";
import branchesRouter from "./branches";
import warehousesRouter from "./warehouses";
import usersRouter from "./users";
import securityRouter from "./security";
import hrRouter from "./hr";
import projectsRouter from "./projects";
import marketingRouter from "./marketing";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(healthRouter);
router.use(authRouter);

// All business routes require an authenticated session
router.use(requireAuth);

router.use(dashboardRouter);
router.use(productsRouter);
router.use(posRouter);
router.use(invoicesRouter);
router.use(accountingRouter);
router.use(reportsRouter);
router.use(customersRouter);
router.use(branchesRouter);
router.use(warehousesRouter);
router.use(usersRouter);
router.use(securityRouter);
router.use(hrRouter);
router.use(projectsRouter);
router.use(marketingRouter);

export default router;
