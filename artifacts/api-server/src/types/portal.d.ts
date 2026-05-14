import type { PortalSessionContext } from "../middlewares/require-portal-session";

declare global {
  namespace Express {
    interface Request {
      portal?: PortalSessionContext;
    }
  }
}

export {};
