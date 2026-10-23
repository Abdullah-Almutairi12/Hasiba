import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintDocButton } from "./print-docs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// jsdom Blob lacks text(); browsers have it.
if (!Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(this); });
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PrintDocButton ready dialog", () => {
  it("shows accessible download/open links after a valid PDF and revokes the blob URL on close", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("%PDF-1.4 test", { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="credit-note-3.pdf"' } })));
    const create = vi.fn(() => "blob:test-1");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const u = userEvent.setup();
    render(<PrintDocButton id={3} url={(id) => `/api/sales/credit-notes/${id}/pdf`} filename="x.pdf" label="طباعة الإشعار الدائن" testId="button-print-credit-3" />);
    await u.click(screen.getByTestId("button-print-credit-3"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/credit-note-3.pdf/)).toBeTruthy();
    const dl = screen.getByTestId("link-pdf-download");
    expect(dl.getAttribute("href")).toBe("blob:test-1");
    expect(dl.getAttribute("download")).toBe("credit-note-3.pdf");
    expect(screen.getByTestId("link-pdf-open").getAttribute("target")).toBe("_blank");
    expect(click).not.toHaveBeenCalled(); // no silent auto-download
    expect(revoke).not.toHaveBeenCalled();
    await u.click(screen.getByTestId("button-pdf-ready-close"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:test-1"));
  });

  it("does not open the dialog for an invalid PDF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "غير مسموح" }, { status: 403 })));
    const u = userEvent.setup();
    render(<PrintDocButton id={4} url={(id) => `/api/pos/refunds/${id}/pdf`} filename="r.pdf" label="سند الصرف" testId="b" />);
    await u.click(screen.getByTestId("b"));
    await waitFor(() => expect((screen.getByTestId("b") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
