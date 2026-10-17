# 小程序视觉验收

## 2026-09-19 登录天气前置页

- Source visual truth: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-5a8384d8-ea54-4fb0-baae-e455d10511c3.jpg`
- Source pixels: `1536 x 1152`；原图是含桌面背景和浏览器外框的横版参考，因此只将暖白纸页、中央手绘图、品牌标题和底部进入动作作为构图真值，不将粉色外框视为小程序要求。
- Rendered implementation: WeChat DevTools `Stable 2.02.2608070` 的 `pages/login/index` 实际模拟器截图（本任务内 Codex computer-use inline capture）。
- Implementation states: 晴天 mock、雨天 mock、已登录会话跳过、前置页进入原登录页。
- Viewports: iPhone 12/13 Pro `390 x 844 CSS px @3x`，Nexus 5 `360 x 640 CSS px @3x`；额外在 Nexus 5 上使用开发者工具字号 `26` 复核。
- Density normalization: 判断以小程序 CSS 视口尺寸为准；开发者工具为适应工作区缩放显示，未将工具缩放当作布局差异。

### Full-view comparison evidence

- 源图的“大面积温暖纸页 + 中央小尺寸手绘场景 + 下方标题/入口”层级被保留。
- 按已确认的产品方向，粉色桌面改为 `#06251f` 深绿点阵，浏览器外框改为适配安全区的暖白纸窗；这是明确的移动端适配，不是视觉漂移。
- iPhone 12/13 Pro 和 Nexus 5 上均无横向溢出，纸页与微信胶囊保持间隔，底部“点击进入”始终可见可达。

### Focused region comparison evidence

- Typography: 标题使用楷体系 fallback 保留手帐气质，英文 eyebrow 和天气标签使用更清晰的粗细与字距；窄屏下没有断行或裁切标题。
- Spacing/layout: `430rpx` 图面在短屏降为 `350rpx`，中央场景、天气标签、标题和入口的纵向节奏与参考图一致。
- Colors/tokens: 深绿、暖白、灰绿文字和青绿品牌标记与现有产品语言一致，边框与阴影在小屏上不显得厚重。
- Image quality: 11 张原始 PNG 均从用户素材派生为 `900 x 900 WebP q90`，未重绘、未使用 SVG/CSS 近似图；晴天 6 帧和雨天 5 帧在模拟器中均清晰、无拉伸、无透明光晕。
- Copy/content: “宁波镇海 · 本地演示”、“苔的跟单旅程”、“点击进入”和辅助文案都可独立理解，没有暴露开发参数或 Key。

### Accessibility and interaction evidence

- 动画容器只暴露一次场景描述，逐帧图片对读屏隐藏；“点击进入”保持语义化 button。
- 实际点击整页与底部按钮均成功进入原本地测试账号页；退出登录后前置页重现，已有会话时直接进入岗位工作台。
- `onHide` 暂停、`onShow` 恢复、`onUnload` 清理、图片失败降级和 650ms 循环已由单元测试覆盖。
- 大字号与窄屏下入口仍在首屏可达；若未来文案进一步变长，页面允许纵向滚动。

### Findings

- 无可执行的 P0/P1/P2 视觉差异。
- P3 保留项：微信字体渲染与参考图手写字体不可能完全同形；当前回退字体与已有品牌页保持一致，不影响验收。

### Comparison history

1. 首次打开时开发者工具的 WebView 路由异常导致模拟器白屏；“普通编译”后恢复，项目编译错误为 0，因此判定为开发者工具状态，不是页面缺陷。
2. iPhone 12/13 Pro 晴天状态通过；之后切到 Nexus 5 和字号 26，无溢出、胶囊重叠或入口不可达。
3. 临时将 `mockWeatherMode` 切到 `rainy` 后完成雨天构图复核，随后已恢复默认 `sunny`。
4. 代码复核发现图片失败占位缺少 `display: flex` 且短屏使用了 `padding-block`；已改为显式 flex 和 `padding-top/padding-bottom`，降低 WXSS 兼容风险。

### Verification

- Mini Program TypeScript: passed.
- `npm run test:mini`: passed, `20/20`.
- WeChat DevTools compile: project errors `0`, project problems `0`.
- DevTools code-quality scan: “小程序表现良好，未发现代码质量问题”。
- Weather assets: `11` WebP files, all `900 x 900`, total `406,656 bytes` (about `397 KiB`); DevTools preview reported a compressed code package of about `310 KB`.
- Secret scan: `mini-program/` 中未找到 `AMAP_WEATHER_API_KEY` 或硬编码 API key。

## 原有小程序验收记录

- 2026-09-13 车间工作台、生产追踪、多区域订单详情、个人待办和累计报工已在 iPhone 12/13 Pro 模拟器通过。
- 真实微信认证、私有附件、实体机弱网、扫码和拍照仍属发布前门槛，不在本次本地界面实现范围内。

final result: passed
