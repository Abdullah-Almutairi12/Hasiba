import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TotpQr } from "./totp-qr";
const renderQr = vi.hoisted(() => vi.fn((_node: unknown, _uri: string, _opts: unknown, cb: (e?: Error) => void) => cb()));
vi.mock("qrcode", () => ({ default: { toCanvas: renderQr } }));
afterEach(cleanup);
describe("local TOTP canvas lifecycle", () => {
  it("passes the complete URI to the local encoder with no image URL, and erases the canvas on removal", () => {
    const uri = "otpauth://totp/Synthetic?secret=SYNTHETIC&issuer=Hasiba";
    const { unmount } = render(<TotpQr uri={uri} />);
    const canvas = screen.getByRole("img") as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(renderQr.mock.calls.at(-1)?.[1] === uri).toBe(true);
    expect(document.querySelector("img[src]")).toBeNull();
    unmount(); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
  it("retains manual-entry guidance when the renderer fails without exposing the URI in an error", () => {
    renderQr.mockImplementationOnce((_node, _uri, _opts, cb) => cb(new Error("fixture")));
    render(<TotpQr uri="otpauth://totp/Synthetic?secret=HIDDEN" />);
    expect(screen.getByRole("alert").textContent).toContain("الإدخال اليدوي");
    expect(screen.getByRole("alert").textContent).not.toContain("HIDDEN");
  });
});
