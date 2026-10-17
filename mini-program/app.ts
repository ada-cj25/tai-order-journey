import { clearSession, initializeMockSession } from "./domain/store";
import { runtime } from "./config/runtime";

App({
  globalData: {
    runtimeMode: runtime.mode,
  },
  onLaunch() {
    if (runtime.mode === "mock") initializeMockSession();
    else if (!wx.getStorageSync("tai-mini-access-token")) clearSession();
  },
});
