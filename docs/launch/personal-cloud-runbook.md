# 个人腾讯云上线手册（小白版）

这是已被公司主体云测试路线替代的历史个人方案，不作为当前部署命令使用。当前步骤见 [公司云测试逐步部署手册](company-cloud-test-runbook.md)。

## 0. 先说清楚三个边界

1. 现在不办微信小程序，首发只是电脑网页和妈妈的 `/mobile` 只读网页。
2. 这是个人持有的产品，但它处理公司客户和订单数据，所以必须先有妈妈代表公司签字盖章的数据处理授权。
3. 个人ICP备案要求网站内容符合个人主体，官方明确说个人网站不能涉及企业、团体或需前置审批内容。因此，“受邀给一家公司使用的个人跟单工具”能否按个人主体备案，存在实质被驳回风险。不能用虚假网站描述规避。[腾讯云网站/主体内容要求](https://cloud.tencent.com/document/product/243/19644)

### 个人备案风险预检（免费，先做）

在买服务器前，通过腾讯云在线客服/工单或备案咨询如实提问：

> 我是个人开发者，不经营、不收费、不对公开放注册。网站只有受邀账号登录，用于家人公司的订单跟进，公司有书面数据处理授权。个人主体、网站名称“苔的跟单旅程”、这个真实用途在我所在省是否允许备案？

保留工单编号和客服答复。如果明确不允许，就停止个人公网上线：继续本地/局域网试用，或将来由真实公司主体备案。不借用他人主体，不用中国香港服务器承载真实公司数据来规避备案。

## 1. 授权书（纸质）

1. 打开 [ERP试用及数据处理授权书](data-authorization-template.md)。
2. 填你的姓名、公司全称、统一社会信用代码、期限、联系方式和事故通知方式。
3. 你签字，妈妈代表公司签字并盖公章。
4. 扫描为PDF，纸质原件和PDF都不放Git、不发普通工作群。

## 2. 注册个人腾讯云账号

你在控制台操作：

1. 打开[腾讯云](https://cloud.tencent.com/)，用你长期控制的微信/邮箱注册，绑定安全手机和安全邮箱。
2. 进入“账号中心 → 实名认证”，选个人实名，姓名必须与身份证完全一致。
3. 进入“账号中心 → 安全设置 → 虚拟MFA → 绑定”，可用腾讯云助手小程序、Google Authenticator或Microsoft Authenticator；同时为“登录保护”和“操作保护”开启MFA。[腾讯云MFA步骤](https://cloud.tencent.com/document/product/378/55649)
4. 如页面提供恢复码/备用校验，立即纸质抄存并放安全位置；不要和密码放在同一个备忘录。
5. 在费用中心的预算/消息通知中建100元和120元两档月消费提醒，同时开通欠费、续费和资源到期通知。控制台名称如有调整，以当前页面为准。
6. 进入CAM访问管理，建一个名为 `tai-deployer` 的自定义子用户，不给 `AdministratorAccess`。后续只给它运维轻量服务器、TCR目标仓库及指定COS的必要权限。官方也建议日常操作用最小权限子账号。[腾讯云CAM用户类型](https://cloud.tencent.com/document/product/598/13665)

## 3. 域名：只查询，到付款前停下

1. 进入腾讯云域名注册页，先查 `taigenlvcheng.cn`。
2. 如页面显示已注册/不可用，再查 `taifollow.cn`。
3. 两个都不可用时立即停止，不自动买其他名称。
4. 可用时创建“个人域名信息模板”，所有者填你本人，完成模板实名审核。腾讯云当前说明个人/企业模板通常需1–3个工作日；域名备案前还需等实名信息同步。[域名实名说明](https://cloud.tencent.com/document/product/242/6707)
5. 结算页核对：域名、所有者是你、首年价、续费价、是否勾选不需要的增值服务。确认后才由你付款。

注：只能以注册商实时查询为准，DNS查不到或搜索引擎没结果都不能证明域名可注册。

## 4. 购买轻量应用服务器

1. 进入“轻量应用服务器 → 新建”。
2. 地域：上海；系统：官方Docker CE应用镜像（当前官方示例底层为Ubuntu Server 24.04 LTS，以购买页为准）。[腾讯云Docker轻量镜像](https://cloud.tencent.com/document/product/1207/60423)
3. 配置：2核4GB，系统盘至少60GB，带宽不能为0。
4. 计费：包年包月，首次至少买3个月。腾讯云当前要求中国境内轻量实例用于备案时实际购买时长不少于3个月，且备案期间剩余期限至少1个月。[备案云资源条件](https://cloud.tencent.com/document/product/243/18908)
5. 在付款页记录首购总额、每月折算、到期续费价、流量包和超额计费。超出三个月可承受总额时不付款。
6. 购买后先不开放80/443；备案通过前不对公网提供ERP。

## 5. ICP备案

备案不收服务费，但需要已购买符合条件的中国境内云资源。[腾讯云备案定价说明](https://cloud.tencent.com/document/product/243/18793)

开始前准备：身份证、本人手机、本人邮箱、个人实名腾讯云账号、已实名域名、符合条件的轻量服务器。

1. 登录腾讯云ICP备案控制台，选“首次备案 → 网站/域名”，输入最终购买的域名。
2. 选择个人主体；主办单位名称是你身份证姓名，必须与腾讯云账号实名、域名实名一致。
3. 云资源选刚购买的上海轻量服务器。
4. 仅在信息完全真实、且预检得到可行答复时，填：
   - 网站名称：`苔的跟单旅程`
   - 网站服务内容：通常选“其他”，以当地管局和页面选项为准。
   - 网站说明：`个人开发的非经营性跟单管理工具，仅受邀账号登录使用`
   - 前置审批：只有实际内容确实不涉及新闻、出版、医疗、教育等时，才选“以上都不涉及”。
5. 按页面做视频核验、上传补充材料并提交腾讯云初审。官方当前说明初审通常1–2个工作日反馈。
6. 收到工信部短信后，在24小时内进入工信部备案系统完成短信核验。省级管局审核为20个工作日内，不包括前期补正、初审和短信等待。[腾讯云快速备案流程](https://cloud.tencent.com/document/product/243/39038)

如被驳回：只按驳回理由补正真实信息。如理由是个人主体与企业使用场景不符，立即停止这条公网方案，不更换虚假说明。

## 6. COS附件桶与备份桶

你在“对象存储COS → 存储桶列表 → 创建存储桶”分别创建两个上海桶：

- `tai-erp-attachments-APPID`：正式附件。
- `tai-erp-backups-APPID`：PostgreSQL备份，与附件凭证完全分开。

两个桶都设：

1. 访问权限“私有读写”，禁止公有读。
2. “容错容灾管理 → 版本控制 → 开启”。版本控制开启后不能回到从未开启状态，而且历史版本会计费。[腾讯云COS版本控制](https://cloud.tencent.com/document/product/436/19884)
3. “安全管理 → 服务端加密”开启SSE-COS默认加密。
4. 附件桶不配自动删除业务文件的生命周期。
5. 备份桶对 `postgresql/` 前缀配生命周期：当前对象保留30天；历史版本也按已审批的30天策略清理；上线后核对规则是否生效。生命周期按北京时间异步执行，不是精确到秒删除。[腾讯云COS生命周期](https://cloud.tencent.com/document/product/436/56548)

### COS最小权限密钥

1. 在CAM创建两个“仅编程访问”子用户：`tai-erp-app` 和 `tai-erp-backup`。
2. 复制 `deploy/personal/cam/attachment-policy.example.json` 为附件策略，只替换APPID和附件桶名，关联给 `tai-erp-app`。
3. 复制 `deploy/personal/cam/backup-policy.example.json` 为备份策略，只替换APPID和备份桶名，关联给 `tai-erp-backup`。
4. 两个策略都没有DeleteObject；附件用户不能看备份桶，备份用户不能看附件桶。官方COS策略的资源格式参考[腾讯云COS用户策略](https://cloud.tencent.com/document/product/436/68280)。
5. SecretId/SecretKey只填到服务器 `/etc/tai-erp/production/*.env`，不放代码、不截图、不发群。

## 7. TCR个人镜像仓库

1. 进入容器镜像服务TCR个人版，选上海。
2. 创建一个私有命名空间，例如 `tai-personal`。
3. 创建四个私有仓库：`tai-erp-api`、`tai-erp-web`、`tai-erp-migrate`、`tai-erp-backup`。
4. 个人版面向个人开发者，只有基础存储分发能力且不承诺SLA；这是低成本取舍。所以服务器保留当前和上一个已批准镜像，不在发布后立即清理。[腾讯云TCR个人版说明](https://cloud.tencent.com/document/faq/1141/57780)
5. 等本地Git标签和全部测试通过后，在Mac上登录TCR，运行：

```sh
./deploy/personal/publish-images.sh v1.2.0 ccr.ccs.tencentyun.com/你的命名空间
```

脚本会使用Node24重跑验证，构建Linux amd64的四个镜像并推送。它只打印镜像digest，不写入云密钥。把每个 `sha256:...` 复制到服务器受保护的 `release.env`；服务器不使用 `latest` 或只指向tag。

## 8. 服务器文件与首次启动

这一节必须在备案信息已核对、COS/TCR已建好后做。先在轻量控制台用VNC登录，再设SSH密钥；不使用弱密码长期开放22端口。

1. 将仓库的 `deploy/personal/` 安全复制到服务器 `/opt/tai-erp/deploy/personal/`。服务器不需要客户附件、本地 `.env` 或本地数据库。
2. 在服务器创建：

```sh
sudo install -d -m 700 /etc/tai-erp/production /etc/tai-erp/bootstrap /var/lib/tai-erp/backups
sudo cp /opt/tai-erp/deploy/personal/runtime.env.example /etc/tai-erp/production/runtime.env
sudo cp /opt/tai-erp/deploy/personal/migration.env.example /etc/tai-erp/production/migration.env
sudo cp /opt/tai-erp/deploy/personal/postgres.env.example /etc/tai-erp/production/postgres.env
sudo cp /opt/tai-erp/deploy/personal/backup.env.example /etc/tai-erp/production/backup.env
sudo cp /opt/tai-erp/deploy/personal/release.env.example /etc/tai-erp/production/release.env
sudo cp /opt/tai-erp/deploy/personal/bootstrap.example.json /etc/tai-erp/bootstrap/production-bootstrap.json
sudo chmod 600 /etc/tai-erp/production/*.env /etc/tai-erp/bootstrap/production-bootstrap.json
```

3. 用 `sudo nano` 依次编辑五个env和初始化JSON，替换每一个 `CHANGE_ME`/`REPLACE_...`。密码出现 `@:/?#%` 等字符时需先做URL编码再放入 `DATABASE_URL`。`AMAP_WEATHER_API_KEY` 必须使用高德“Web服务” Key，并在上线前确认该账号授权适用于当前内部业务用途。Key只存入该受保护的运行环境文件，不填前端变量、不发群、不截图。留空时登录仍可用，但天气动画会降级为静态晴天画面。
4. `SESSION_SECRET` 可在服务器生成：

```sh
openssl rand -base64 48
```

5. `production-bootstrap.json` 的 `yearMonth` 改为开始试点的当月 `YYMM`（如 `2608`，初始化时统一为数据库使用的 `202608`；也接受 `YYYYMM`），六个分类池的 `lastValue` 填旧流程已占用最大值；没有使用也须经订单管理员确认0。不复制演示订单。
6. 以镜像仓库凭证登录TCR，然后校验Compose：

```sh
cd /opt/tai-erp
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml config --quiet
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml pull
```

7. 只启数据库并迁移：

```sh
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml up -d db
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml --profile maintenance run --rm migrate
```

8. 先只检查空库和初始化清单，不写入：

```sh
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml --profile maintenance run --rm migrate node server/dist/bootstrap-production.js --manifest=/bootstrap/production-bootstrap.json
```

9. 检查通过后，用一个从未使用的强初始密码应用初始化；密码不写入命令历史：

```sh
read -r -s BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_CONFIRM_DATABASE=tai_erp
sudo --preserve-env=BOOTSTRAP_ADMIN_PASSWORD,BOOTSTRAP_CONFIRM_DATABASE docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml --profile maintenance run --rm -e BOOTSTRAP_ADMIN_PASSWORD -e BOOTSTRAP_CONFIRM_DATABASE migrate node server/dist/bootstrap-production.js --manifest=/bootstrap/production-bootstrap.json --apply
unset BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_CONFIRM_DATABASE
```

10. 先启API检查日志；备案通过前不起web：

```sh
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml up -d api
sudo docker compose --env-file /etc/tai-erp/production/release.env -f deploy/personal/compose.yaml ps
```

## 9. 每6小时备份与第一次恢复演练

1. 手工跑第一次备份：

```sh
sudo /opt/tai-erp/deploy/personal/backup.sh /etc/tai-erp/production/release.env /opt/tai-erp/deploy/personal/compose.yaml
```

2. 在COS备份桶确认同时出现 `.dump` 和 `.dump.json`；JSON里有数据库名、时间、字节数和SHA-256。
3. 复制该 `.dump` 的对象键，做隔离恢复：

```sh
sudo /opt/tai-erp/deploy/personal/restore-drill.sh /etc/tai-erp/production/release.env postgresql/YYYY/MM/DD/tai_erp_YYYYMMDDTHHMMSSZ_XXXXXXXX.dump /opt/tai-erp/deploy/personal/compose.yaml
```

4. 脚本会先验SHA-256，然后创建 `tai_restore_...` 隔离库，不覆盖正式库，也不自动删除演练库。核对员工数、订单数、最大生产编号、收款事实、报工数量、补单父关系和附件抽样。
5. 记录从备份时间到故障时间的差，以及从开始恢复到核对完成的时长。只有实测满足时才可写RPO≤6小时、RTO≤8小时。
6. 演练库经确认后，人工用它的精确库名执行 `dropdb`；不允许使用模糊名、通配符或正式库名。
7. 安装systemd定时器：

```sh
sudo cp /opt/tai-erp/deploy/personal/tai-erp-backup.service.example /etc/systemd/system/tai-erp-backup.service
sudo cp /opt/tai-erp/deploy/personal/tai-erp-backup.timer.example /etc/systemd/system/tai-erp-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tai-erp-backup.timer
sudo systemctl list-timers tai-erp-backup.timer
```

它每天00:15、06:15、12:15、18:15执行，有最多5分钟随机延迟，断电错过后会补跑。你每天查一次 `systemctl status tai-erp-backup.timer` 和最近一次service日志。

## 10. DNS、防火墙和正式开网

只有ICP备案已通过、备份恢复已通过、[云端验收清单](personal-cloud-acceptance.md)阻断项清零后执行：

1. DNSPod中添加两条A记录：`@` → 轻量服务器公网IP，`www` → 同一IP。
2. 轻量防火墙只保留：TCP 80来源全部、TCP 443来源全部、TCP 22只来源你当前管理公网IP。删除对公网3000、5173、5432的规则。
3. 启动web：

```sh
sudo docker compose --env-file /etc/tai-erp/production/release.env -f /opt/tai-erp/deploy/personal/compose.yaml up -d web
```

4. Caddy会为根域名和 `www` 自动申请并续期HTTPS证书，`www` 自动跳到根域名。检查HTTP跳HTTPS、浏览器证书、登录Cookie和 `/api/health/ready`。
5. 把工信部下发的真实备案号填入页脚，链接 `https://beian.miit.gov.cn/`。不填占位号。官方说明根域名与www都应可访问并展示备案号。[备案号悬挂说明](https://cloud.tencent.com/document/product/243/61412)
6. 从网站开通日起30日内在全国互联网安全管理服务平台提交公安联网备案；通过后把公安备案号和图标放页脚。

## 11. 试点与日常维护

1. 第一次管理员登录必须立即改密，然后逐个建员工账号；正式库不得运行 `npm run db:seed` 或任何样例seed。
2. 只导入员工、部门、工序模板、已批准收款账户目录和六编号池。旧订单不导入。
3. 第一周只录1–3张真实新单，每天核对负责人、环节、收款、工序数量和附件；稳定后再到10–20张。
4. 妈妈手机只访问 `https://你的域名/mobile`，用董事长管理员账号登录。这是专用只读会话，不与桌面办理会话混用。
5. 每日：备份成功、磁盘/数据库容量、5xx、附件失败、提醒扫描、欠费/到期。每月：从COS真备份做一次隔离恢复。
6. 出现越权、丢数据、编号冲突、重复事实或错误发货放行，立即停止新建订单，保留日志，用统一临时登记表记真实发生时间和凭证。

## 12. 版本更新与回退

每次更新：本地全部验证 → Git标签 → 构建并推送digest → 手工备份 → 更新 `release.env` → 迁移 → `up -d` → 登录和关键动作烟测。

代码问题将 `release.env` 中四个ERP镜像digest改回上一个已批准版本后重启。不为了回退代码直接覆盖数据库，不抹掉已发生的收款或报工事实。
