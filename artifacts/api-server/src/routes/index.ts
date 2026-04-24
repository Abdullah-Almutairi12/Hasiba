import { Router, type IRouter } from "express";
import healthRouter from "./health";
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

const router: IRouter = Router();

router.use(healthRouter);
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

export default router;
