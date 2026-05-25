/**
 * Phase 2 — read-only liquidity dashboard endpoints.
 *
 * Two modes, each gated by a guard appropriate to its audience:
 *   - /liquidity/corporate → finance/holding (reportReadGuard).
 *   - /liquidity/retail    → store managers + finance (posRead-wide).
 */

import { Router } from "express";
import { reportReadGuard, posReadGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import {
  getCorporateLiquidity,
  getRetailLiquidity,
} from "../lib/liquidity-forecast";

const router = Router();

router.get("/liquidity/corporate", reportReadGuard, async (req, res) => {
  try {
    const snapshot = await getCorporateLiquidity(getCompanyId(req));
    res.json(snapshot);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/liquidity/retail", posReadGuard, async (req, res) => {
  try {
    const snapshot = await getRetailLiquidity(getCompanyId(req));
    res.json(snapshot);
  } catch (err) {
    handleRouteError(err, res);
  }
});

export default router;
