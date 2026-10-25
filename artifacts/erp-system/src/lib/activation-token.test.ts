import {afterEach,describe,expect,it} from "vitest";
import {captureActivationToken,clearActivationToken} from "./activation-token";
afterEach(clearActivationToken);
describe("memory-only activation across address cleanup",()=>{
  it("retains the token on same-route remount and consumes it explicitly",()=>{
    expect(captureActivationToken("/app/team-activate","#token=synthetic%2Btoken")).toBe("synthetic+token");
    expect(captureActivationToken("/app/team-activate","")).toBe("synthetic+token");
    clearActivationToken();expect(captureActivationToken("/app/team-activate","")).toBeNull();
  });
  it("does not leak to a different path, and a new link replaces the pending token",()=>{
    captureActivationToken("/app/team-activate","#token=first");
    expect(captureActivationToken("/app/team-activate","#token=second")).toBe("second");
    expect(captureActivationToken("/login","")).toBeNull();
    expect(captureActivationToken("/app/team-activate","")).toBeNull();
  });
});
