import type { DbOrTx } from "./journal-posting";

export type ApprovalEffect = () => Promise<unknown> | void;
export interface ApprovalExecutionContext {
  connection: DbOrTx;
  companyId: number;
  userId: number;
  afterCommit(effect: ApprovalEffect): void;
}
