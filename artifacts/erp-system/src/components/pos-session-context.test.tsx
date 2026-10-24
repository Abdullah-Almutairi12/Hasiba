import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PosSessionContext } from "./pos-session-context";
afterEach(cleanup);
it("shows the actual server branch, actor and shift rather than a placeholder or an implicit owner", () => {
  render(<PosSessionContext session={{id:9,branchId:3,branchName:"فرع التجربة",cashierName:"المالك الحالي",
    sessionNumber:"WRD-SYNTHETIC-9",openedAt:"2026-10-25T00:00:00Z",status:"open",totalSales:0,ordersCount:0}}/>);
  expect(screen.getByTestId("pos-active-session-context").textContent).toBe("فرع التجربةالمالك الحاليWRD-SYNTHETIC-9");
});
it("does not invent an active shift when there is none", () => {
  render(<PosSessionContext/>);
  expect(screen.queryByTestId("pos-active-session-context")).toBeNull();
});
