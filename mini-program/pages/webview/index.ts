import { runtime } from "../../config/runtime";

Page({
  data: { enabled: runtime.webViewEnabled && runtime.webBaseUrl.startsWith("https://"), url: runtime.webBaseUrl },
  back() { wx.navigateBack(); }
});
