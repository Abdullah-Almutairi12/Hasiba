import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TransferReceiptRow } from "./inventory-transfer-receipts";

const mock=vi.hoisted(()=>({receive:vi.fn()}));
vi.mock("@workspace/api-client-react",()=>({
  receiveInventoryTransfer:mock.receive,
  getGetWorkspaceInventoryTransfersQueryKey:()=>["transfers"],
  getGetWorkspaceInventoryQueryKey:()=>["stock"],
  useGetWorkspaceInventoryTransfers:vi.fn(),
}));
const transfer={id:7,reference:"TRF-SYNTHETIC",quantity:"3.0000",state:"in_transit" as const,
  productName:"منتج مصطنع",sourceWarehouse:"المصدر",destinationWarehouse:"الوجهة",createdAt:"2026-10-25T00:00:00Z"};
afterEach(cleanup);
beforeEach(()=>mock.receive.mockReset());
const prepare=()=>{
  fireEvent.change(screen.getByLabelText("مرجع إثبات الاستلام الكامل"),{target:{value:" SYN-RECEIPT-7 "}});
  fireEvent.click(screen.getByRole("checkbox"));
};

it("does not offer an execution control for a read-only destination responsibility",()=>{
  render(<TransferReceiptRow transfer={transfer} grantId={90} canReceive={false} onReceived={vi.fn()}/>);
  expect(screen.queryByRole("button")).toBeNull();
  expect(mock.receive).not.toHaveBeenCalled();
});

it("freezes the original reference and reuses exactly the same key/body after an uncertain result",async()=>{
  const refresh=vi.fn().mockResolvedValue(undefined);
  mock.receive.mockRejectedValueOnce({status:502}).mockResolvedValueOnce({ok:true,id:7});
  render(<TransferReceiptRow transfer={transfer} grantId={90} canReceive onReceived={refresh}/>);
  prepare();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(()=>expect(screen.getByRole("button").textContent).toBe("استعادة نتيجة الطلب نفسه"));
  expect((screen.getByLabelText("مرجع إثبات الاستلام الكامل") as HTMLInputElement).disabled).toBe(true);
  await act(async()=>{fireEvent.click(screen.getByRole("button"));});
  expect(mock.receive).toHaveBeenCalledTimes(2);
  expect(mock.receive.mock.calls[0]).toEqual(mock.receive.mock.calls[1]);
  expect(mock.receive.mock.calls[0][0]).toBe(7);
  expect(mock.receive.mock.calls[0][1]).toEqual({receiptReference:"SYN-RECEIPT-7"});
  expect(mock.receive.mock.calls[0][2].headers["X-Workspace-Responsibility"]).toBe("90");
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("does not invent receipt success on denial, and replaces the form with a server-confirmed record",async()=>{
  mock.receive.mockRejectedValueOnce(Object.assign(new Error("سُحب فعل الاستلام"),{status:403}));
  const props={transfer,grantId:90,canReceive:true,onReceived:vi.fn()};
  const view=render(<TransferReceiptRow {...props}/>);
  prepare();
  await act(async()=>{fireEvent.click(screen.getByRole("button"));});
  expect(screen.getByRole("status").textContent).toBe("لا تملك صلاحية تنفيذ هذا الإجراء.");
  expect(props.onReceived).not.toHaveBeenCalled();
  expect((screen.getByLabelText("مرجع إثبات الاستلام الكامل") as HTMLInputElement).value).toBe(" SYN-RECEIPT-7 ");
  view.rerender(<TransferReceiptRow {...props} transfer={{...transfer,state:"done"}}/>);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("مستلم في الخادم");
});
