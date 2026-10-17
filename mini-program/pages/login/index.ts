import { packagedProfile, runtime, selectLocalApiTest } from "../../config/runtime";
import { framesForMiniWeather, LOGIN_PRELUDE_FRAME_MS, miniWeatherSceneLabel, nextMiniWeatherFrame, shouldShowLoginPrelude } from "../../domain/login-prelude";
import { clearSession, getStoredSession, mockEmployees, setMockSession } from "../../domain/store";
import { homeForRole } from "../../domain/roles";
import { bindWithInvite, loginWithWechat } from "../../services/auth";

const rainyFrames = framesForMiniWeather("rainy");

Page({
  data: {
    screen: "checking" as "checking" | "prelude" | "login",
    mockMode: runtime.mode === "mock",
    canLocalApiTest: packagedProfile === "mock" && wx.getSystemInfoSync?.().platform === "devtools",
    localDevLogin: runtime.localDevLogin,
    accounts: mockEmployees.map((employee) => ({ ...employee, avatarText: employee.name.slice(0, 1), scopeLabel: employee.role === "SALES" ? employee.level === "SUPERVISOR" ? "查看本品牌全部销售订单" : "仅查看本人负责订单" : "岗位专属工作区" })),
    inviteCode: "",
    devIdentity: wx.getStorageSync<string>("tai-mini-dev-identity") || "",
    loading: false,
    sceneLabel: miniWeatherSceneLabel("rainy"),
    frames: rainyFrames,
    frameIndex: 0,
    currentFrame: rainyFrames[0],
    frameErrored: false,
    artAvailable: true,
  },
  animationTimer: null as ReturnType<typeof setInterval> | null,
  onShow() {
    const employee = getStoredSession();
    if (!shouldShowLoginPrelude(Boolean(employee)) && employee) {
      wx.reLaunch({ url: homeForRole(employee.role, employee.level) });
      return;
    }
    if (this.data.screen === "checking") {
      this.setData({ screen: "prelude" });
    }
    if (this.data.screen === "prelude") this.startAnimation();
  },
  onHide() { this.stopAnimation(); },
  onUnload() { this.stopAnimation(); },
  startAnimation() {
    if (this.animationTimer || this.data.screen !== "prelude" || this.data.frameErrored || this.data.frames.length < 2) return;
    this.animationTimer = setInterval(() => {
      if (this.data.screen !== "prelude") return;
      const frameIndex = nextMiniWeatherFrame(this.data.frameIndex, this.data.frames.length);
      this.setData({ frameIndex, currentFrame: this.data.frames[frameIndex] });
    }, LOGIN_PRELUDE_FRAME_MS);
  },
  stopAnimation() {
    if (!this.animationTimer) return;
    clearInterval(this.animationTimer);
    this.animationTimer = null;
  },
  enterLogin() {
    if (this.data.screen !== "prelude") return;
    this.stopAnimation();
    this.setData({ screen: "login" });
  },
  handleFrameError() {
    this.stopAnimation();
    if (!this.data.frameErrored && this.data.frameIndex !== 0) {
      this.setData({ frameErrored: true, frameIndex: 0, currentFrame: this.data.frames[0] });
      return;
    }
    this.setData({ frameErrored: true, artAvailable: false });
  },
  changeInvite(event: { detail: { value: string } }) { this.setData({ inviteCode: event.detail.value }); },
  changeDevIdentity(event: { detail: { value: string } }) { this.setData({ devIdentity: event.detail.value }); },
  enableLocalApiTest() {
    try {
      clearSession();
      selectLocalApiTest(true);
      this.setData({ mockMode: false, localDevLogin: true, inviteCode: "", devIdentity: "" });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "无法开启联调", icon: "none" }); }
  },
  backToMock() {
    clearSession();
    selectLocalApiTest(false);
    this.setData({ mockMode: true, localDevLogin: false, inviteCode: "", devIdentity: "" });
  },
  chooseAccount(event: { currentTarget: { dataset: { id: string } } }) {
    const employee = setMockSession(event.currentTarget.dataset.id);
    wx.reLaunch({ url: homeForRole(employee.role, employee.level) });
  },
  async wechatLogin() {
    this.setData({ loading: true });
    try {
      if (runtime.localDevLogin) wx.setStorageSync("tai-mini-dev-identity", this.data.devIdentity.trim());
      const employee = this.data.inviteCode.trim() ? await bindWithInvite(this.data.inviteCode, this.data.devIdentity) : await loginWithWechat(this.data.devIdentity);
      wx.reLaunch({ url: homeForRole(employee.role, employee.level) });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "登录失败", icon: "none", duration: 2800 });
    } finally { this.setData({ loading: false }); }
  },
});
