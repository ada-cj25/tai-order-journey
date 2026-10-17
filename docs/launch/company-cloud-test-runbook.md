# 公司云测试环境：逐步部署手册

适用范围：公司主体已备案的新域名、上海轻量服务器、编造的业务数据。最初计划默认由公司持有云账号；账号持有方式须以实际账号实名、备案条件和双方授权为准，不因 TCR 服务名为“个人版”或命名空间叫 `tai-personal` 就推断账号主体。测试数据库和两个 COS 桶只服务于本轮测试；以后正式试点另建空环境。产品和代码归开发者，公司业务数据归公司。本文不要求改动 `norli.com.cn` 或现有公司网站。

2026-10-11 截图已确认：公司主体宁波居正家居有限公司的网站服务 `taifollow.cn` 状态正常，网站备案号 `浙ICP备2021025626号-2`；上海二区轻量实例运行中，公网 IPv4 为 `110.40.168.235`，镜像为 Ubuntu 24.04 + Docker 29，规格为 4 核 / 8GB / 120GB。公网 IP 在部署前仍须到实例详情核对是否变化。镜像仓库以本手册下文记录的广州 TCR 个人版实例为准。

2026-10-11 用户确认两个 COS 桶均已正确配置；新增截图直接显示附件桶版本控制为“已开启”。其他桶设置仍以云控制台配置和上线前的实际权限/加密/备份验证结果为准。当前方案不要求启用多 AZ 或存储桶复制。

2026-10-11 OrcaTerm 截图显示已登录 `ubuntu`，Docker Compose 为 v5.3.1；`sudo docker version` 同时显示客户端和服务端 29.6.1。普通 `ubuntu` 用户直接访问 Docker socket 被拒绝，后续按本文使用 `sudo docker`，无需将用户加入 `docker` 组。

2026-10-11 用户已在本机核对服务器 ED25519 主机指纹，使用下载的私钥通过 SSH 登录成功。此后限制 22 端口来源时，先添加当前管理 IP 的允许规则，再移除 22 端口的全网允许规则，最后从本机新开 SSH 会话验证；若失败，立即从腾讯云控制台恢复规则。

2026-10-11 用户截图显示 22/TCP 已添加当前管理 IP `123.152.155.95` 的允许规则，并确认移除全网 22/TCP 规则后仍可用本机私钥 SSH 登录。服务器登录横幅提示有待安装的 Ubuntu 安全更新；在开放网站前安排系统快照、更新与重启验证，不执行提示中的跨版本 `do-release-upgrade`。

2026-10-11 新截图显示广州 TCR 个人版实例已运行，`tai-personal` 命名空间下有四个私有仓库 `tai-erp-api`、`tai-erp-web`、`tai-erp-migrate`、`tai-erp-backup`。这个名称来自历史个人部署手册，不能证明账号实名类型；本轮测试不必仅因名称另建命名空间。发布前核对四个仓库的镜像版本并固定新发布 digest，避免覆盖或误用旧镜像。

执行人还需要分别记录：两个桶的全名、TCR 个人版命名空间、发布 tag/SHA、四个应用镜像 digest、PostgreSQL 17 镜像 digest。密码和云密钥只填在受保护的服务器文件，记录表不收集它们。

## 1. 核对备案与授权

1. 已在腾讯云 **ICP 备案 → 我的备案 → 互联网信息服务 → 网站** 确认 `taifollow.cn` 网站服务状态正常，备案号为 `浙ICP备2021025626号-2`。上线前再次核对域名和服务器 IP 仍与该网站服务记录一致。
2. 确认公司试用及数据处理授权已签妥，并记录公司云账号负责人、费用承担人与故障联系人。应用开通时在登录页和业务页显示真实 ICP 备案号，链接工信部备案系统。腾讯云要求备案内容与主体性质一致，并要求网站悬挂备案号：[网站/APP 信息](https://cloud.tencent.com/document/product/243/19644)、[备案号悬挂](https://cloud.tencent.com/document/product/243/61412)。
3. 网站开通之日起 30 日内提交公安联网备案；审核通过后补上公安备案号和链接。[腾讯云公安备案说明](https://cloud.tencent.com/document/product/243/19142)。

完成标准：能够指出新域名对应的公司网站服务备案记录、签署的授权及三位责任人。

## 2. 核对两个 COS 桶

对截图中的附件桶和备份桶分别操作：

1. 进入 **对象存储 → 存储桶列表 → 桶名 → 权限管理**，确认桶为私有读写，没有公共读或公开桶策略。
2. 进入 **容错容灾管理 → 版本控制**，开启并保存；随后重新打开页面确认状态为“开启”。[官方步骤](https://cloud.tencent.com/document/product/436/19884)。
3. 进入 **安全管理 → 服务端加密**，设置桶默认 **SSE-COS** 并保存。[加密说明](https://cloud.tencent.com/document/product/436/33457)。
4. 附件桶不设自动删除业务附件的生命周期。备份桶在 **生命周期** 新建仅匹配 `postgresql/` 前缀的规则：当前对象保留 30 天，历史版本另按审批的 30 天策略处理；核对规则状态为开启。版本控制下只清理当前对象并不会自动清理历史版本。[生命周期配置](https://cloud.tencent.com/document/product/436/17031)。
5. 在 **访问管理 CAM** 建两个仅编程访问的独立身份，分别绑定只针对附件桶和备份桶的自定义策略。策略模板为 `deploy/personal/cam/attachment-policy.example.json` 与 `backup-policy.example.json`。把 `REPLACE_APPID`、桶名换成实际值后检查资源 ARN；两套策略都只允许所需的 Put/Get/Head，不含 Delete。附件身份不得访问备份桶，备份身份不得访问附件桶。把各自 SecretId/SecretKey 留在安全密码库，下一步再录入服务器文件。

完成标准：两个桶均为私有、版本控制开启、默认加密已配置；两套凭证的权限边界可在 CAM 中复核。截图中的“指定用户”和 0 B 无法证明其余设置已完成。

## 3. 检查服务器与构建机

1. 已确认上海二区轻量实例为 Ubuntu 24.04 + Docker 29、4 核 8GB、120GB 系统盘。先在 **轻量应用服务器 → SSH 密钥** 创建上海地域密钥并安全保存一次性下载的私钥，再到该实例 **SSH 密钥 → 绑定密钥** 选择在线绑定，目标用户名用 Ubuntu 默认的 `ubuntu`。然后进入 **防火墙**，先确保管理者当前公网 IP 能访问 22，再移除向所有来源开放的 22；不要开放 3000、5173、5432。待需要签发 HTTPS 证书时，开放 80/443。创建、绑定密钥和防火墙设置参见[腾讯云管理密钥](https://cloud.tencent.com/document/product/1207/44573)、[绑定密钥](https://cloud.tencent.com/document/product/1207/54228)、[管理实例防火墙](https://cloud.tencent.com/document/product/1207/44577)。
2. 用控制台终端或 SSH 登录服务器，确认 `docker compose version` 可运行，且 `docker version` 的服务端可连接。若购买的系统镜像不含 Docker，先按该系统的官方 Docker 安装步骤完成安装；不要盲目套用旧手册的 Docker CE 镜像假设。
3. 构建机（当前 Mac）确认 `node -v` 为 24.x、`docker buildx version` 可运行。当前 Mac 默认是 Node 26，但已装有 `/opt/homebrew/opt/node@24/bin/node`；在发布终端先运行 `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`，再运行 `node -v`。本机目前没有 `docker` 命令；可按 [Docker 官方 Mac 安装说明](https://docs.docker.com/desktop/setup/install/mac-install/) 安装并启动公司允许的 Docker Desktop，或使用经批准的其他 buildx 构建机。当前工作区也有大量未提交改动，这两项解决前不能执行镜像发布脚本。
4. 广州 TCR 个人版实例及 `tai-personal` 命名空间下四个私有仓库已经存在，无需重复创建或购买企业版。先确认账号实际实名与已通过的公司网站备案相容、云资源使用及数据处理获得双方授权；腾讯云说明个人实名账号如为企业法定代表人，可为其所在企业备案。检查现有仓库是否已有镜像版本；若复用，在同一命名空间以唯一 tag 推送本轮镜像并用 digest 部署。另建命名空间可帮助管理，但不是本轮测试的技术前提。上海服务器拉取广州个人版镜像仍须实测。[TCR 个人版快速入门](https://cloud.tencent.com/document/product/1141/63910)、[腾讯云备案限制](https://cloud.tencent.com/document/product/243/18911)。

完成标准：服务器可执行 Compose，构建机可执行 buildx，TCR 拉取途径确定，服务器对公网没有业务内部端口。

## 4. 固定并发布一个版本

开发者先逐项审阅当前改动，只把准备发布的代码和数据库迁移纳入同一个提交。工作区干净、自动测试通过后，给该提交打唯一的版本 tag。`deploy/personal/publish-images.sh` 要求工作区干净，且 HEAD 恰好有传入的 tag；脚本会重新运行类型检查、自动测试、工作流测试、构建、安全审计，并构建 Linux amd64 的四个镜像。

在已安装 Docker buildx 的构建机，以公司 TCR 的控制台登录指引先 `docker login ccr.ccs.tencentyun.com`，再执行：

```sh
./deploy/personal/publish-images.sh v1.2.0-company-test.1 ccr.ccs.tencentyun.com/实际命名空间
```

版本号只是示例，须使用该提交真实 tag。记录四个 `sha256:` digest；另查询并记录批准的 PostgreSQL 17 镜像 digest。不要把浮动 `latest` 或仅 tag 写入服务器 `release.env`。

完成标准：提交 SHA、tag、五个镜像 digest 对应同一发布记录；脚本所有验证成功。

## 5. 上传部署文件，填写服务器配置

只上传 `deploy/personal/` 和 `deploy/company-test/`。不要上传本地 `.env`、SQLite/PostgreSQL 数据、附件或示例订单。先在 Mac 的项目根目录执行；确认实例公网 IP 仍是截图中的值，输入本机保存的 SSH 私钥文件路径：

```sh
SERVER_IP=110.40.168.235
SSH_USER=ubuntu
printf '本机 SSH 私钥文件完整路径：'
read -r SSH_KEY_FILE
chmod 600 "$SSH_KEY_FILE"
tar -czf /tmp/tai-erp-deploy.tar.gz deploy/personal deploy/company-test
scp -i "$SSH_KEY_FILE" /tmp/tai-erp-deploy.tar.gz "$SSH_USER@$SERVER_IP:/tmp/"
ssh -i "$SSH_KEY_FILE" "$SSH_USER@$SERVER_IP"
```

SSH 登录成功后，以下命令才在**服务器终端**执行：

```sh
sudo install -d -m 755 /opt/tai-erp
sudo tar -xzf /tmp/tai-erp-deploy.tar.gz -C /opt/tai-erp
sudo install -d -m 700 /etc/tai-erp/company-test /etc/tai-erp/company-test/bootstrap /var/lib/tai-erp/backups/company-test
sudo cp /opt/tai-erp/deploy/company-test/release.env.example /etc/tai-erp/company-test/release.env
sudo cp /opt/tai-erp/deploy/company-test/runtime.env.example /etc/tai-erp/company-test/runtime.env
sudo cp /opt/tai-erp/deploy/company-test/migration.env.example /etc/tai-erp/company-test/migration.env
sudo cp /opt/tai-erp/deploy/company-test/postgres.env.example /etc/tai-erp/company-test/postgres.env
sudo cp /opt/tai-erp/deploy/company-test/backup.env.example /etc/tai-erp/company-test/backup.env
sudo cp /opt/tai-erp/deploy/company-test/bootstrap.example.json /etc/tai-erp/company-test/bootstrap/company-test-bootstrap.json
sudo chmod 600 /etc/tai-erp/company-test/release.env /etc/tai-erp/company-test/runtime.env /etc/tai-erp/company-test/migration.env /etc/tai-erp/company-test/postgres.env /etc/tai-erp/company-test/backup.env /etc/tai-erp/company-test/bootstrap/company-test-bootstrap.json
```

用 `sudo nano` 逐个打开上述六个文件，替换所有 `CHANGE_ME`、`REPLACE_...` 和 `YYMM`：

- `release.env`：实际备案根域名、公司私有镜像地址与 digest、PostgreSQL 17 digest。当前 Caddy 配置同时服务根域名与 `www`，所以两者都要有 DNS 记录；若使用的是子域名，先调整 Caddy 配置并重新发布 web 镜像。
- `postgres.env`：为 owner 与 runtime 分别生成强随机密码；首次初始化后，单改文件不会自动轮换数据库内的密码。
- `migration.env` 和 `runtime.env`：把各自数据库 URL 中密码填成上一步对应值。使用十六进制随机密码可避免 URL 特殊字符编码问题。`SESSION_SECRET` 单独生成至少 32 字节随机值；`WEB_ORIGIN` 必须与浏览器 HTTPS 地址完全一致。测试环境保留 `COST_MODULE_ENABLED=true`、`APP_ENVIRONMENT=company-test`，只使用附件桶凭证。
- `backup.env`：只使用备份桶凭证。
- `company-test-bootstrap.json`：把 `YYMM` 改为测试开始月份（例如 2026 年 10 月填 `2610`），确认唯一管理员的员工号、账号与名称。六个测试编号池由脚本从 0 建立，不读取正式编号池。

可以在服务器上用 `openssl rand -hex 32` 分别生成两个数据库密码，用 `openssl rand -hex 48` 生成会话密钥；每次都要重新运行。不要把生成值写进命令行参数、聊天或 Git。

完成标准：所有占位符清零，密钥文件仅 root 可读，测试配置指向测试桶和备案新域名。

## 6. 空库迁移与测试初始化

以下命令在服务器 `/opt/tai-erp` 执行；公司测试覆盖文件必须列在后面：

```sh
cd /opt/tai-erp
sudo docker login ccr.ccs.tencentyun.com
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml config --quiet
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml pull
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml up -d db
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml --profile maintenance run --rm migrate
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml --profile maintenance run --rm migrate node server/dist/bootstrap-company-test.js --manifest=/bootstrap/company-test-bootstrap.json
```

最后一条只检查清单与空库。它输出“尚未写入”后，在当前 SSH shell 中设置一次性管理员初始密码并真正初始化：

```sh
read -r -s BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_CONFIRM_DATABASE=tai_erp BOOTSTRAP_CONFIRM_ENVIRONMENT=company-test
sudo --preserve-env=BOOTSTRAP_ADMIN_PASSWORD,BOOTSTRAP_CONFIRM_DATABASE,BOOTSTRAP_CONFIRM_ENVIRONMENT docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml --profile maintenance run --rm -e BOOTSTRAP_ADMIN_PASSWORD -e BOOTSTRAP_CONFIRM_DATABASE -e BOOTSTRAP_CONFIRM_ENVIRONMENT migrate node server/dist/bootstrap-company-test.js --manifest=/bootstrap/company-test-bootstrap.json --apply
unset BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_CONFIRM_DATABASE BOOTSTRAP_CONFIRM_ENVIRONMENT
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml up -d api
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml ps
```

如果检查发现库中已有员工、订单或编号池，停止操作，核对是否选错数据库；初始化脚本不会覆盖它们。生产模式安全检查仍会要求 HTTPS、COS 与强会话密钥；本地测试账号快捷选择器在公网部署中关闭。

完成标准：数据库和 API 健康，空测试库只有一位须改密管理员与六个从 0 开始的测试编号池。

## 7. 备份、隔离恢复与定时器

先手动跑一次备份，再从**测试备份桶**复制该 `.dump` 的完整对象键，执行隔离恢复：

```sh
sudo /opt/tai-erp/deploy/personal/backup.sh /etc/tai-erp/company-test/release.env /opt/tai-erp/deploy/personal/compose.yaml
sudo /opt/tai-erp/deploy/personal/restore-drill.sh /etc/tai-erp/company-test/release.env postgresql/YYYY/MM/DD/tai_erp_YYYYMMDDTHHMMSSZ_XXXXXXXX.dump /opt/tai-erp/deploy/personal/compose.yaml
```

第二条中的对象键必须换成实际备份输出，不能照抄示例。确认 COS 同时有 `.dump`、`.dump.json`，SHA-256 校验通过，隔离库可读。演练库不会自动删除，记录其精确名称和抽查结果后再由管理员清理。随后安装只针对测试环境的定时器：

```sh
sudo cp /opt/tai-erp/deploy/company-test/tai-erp-company-test-backup.service.example /etc/systemd/system/tai-erp-company-test-backup.service
sudo cp /opt/tai-erp/deploy/company-test/tai-erp-company-test-backup.timer.example /etc/systemd/system/tai-erp-company-test-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tai-erp-company-test-backup.timer
sudo systemctl list-timers tai-erp-company-test-backup.timer
```

完成标准：手工备份、真对象下载与隔离恢复均成功，六小时定时器已登记。RPO/RTO 目标只在实际演练测得后记录为通过。

## 8. DNS、HTTPS 与管理员验收

1. 在新域名 DNS 控制台添加 `@` 和 `www` 的 A 记录，指向该轻量服务器公网 IP。核对解析生效后，在轻量防火墙开放 TCP 80/443，来源按验收安排设置；保持 22 限定管理 IP，3000/5173/5432 不开放。
2. 启动网页容器：

```sh
cd /opt/tai-erp
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml up -d web
sudo docker compose --env-file /etc/tai-erp/company-test/release.env -f deploy/personal/compose.yaml -f deploy/company-test/compose.override.yaml ps
```

3. 管理员在自己的浏览器检查 `http://新域名` 跳转到 HTTPS、证书有效、登录页显著显示“公司云测试环境”、页脚备案号正确。打开 `https://新域名/api/health/ready` 应返回 `{"status":"ready"}`；`/api/v1/public/config` 的 `environment` 应为 `company-test`，`localTestAccountsEnabled` 应为 `false`。
4. 管理员首次登录立即改密。再测 COS 附件上传下载、越权访问、成本页面、支付核验和关键工作流。按 [技术验收清单](personal-cloud-acceptance.md) 的权限、恢复、重启和性能条目逐项记录，但将其中“个人主体”“真实订单”“正式成本关闭”改按本手册的公司测试口径。至少测试约 50 登录会话、20 活跃用户和 5 路附件上传。

完成标准：管理员验收记录显示安全、备份恢复、功能和性能达标；此时才向员工发登录地址。

## 9. 员工接力测试与结束

用管理界面逐人创建岗位账号，要求首次改密；不运行任何演示 seed。先由销售、设计、订单管理员、技术、采购、财务、四车间、安装和售后代表，在各自电脑上用编造的客户与订单资料接力完成至少一张正常单和一张退回重提单，再覆盖分区域生产、发货安装、售后和成本。每天记录“实际做法—系统结果—问题—复验结果”。出现越权、丢记录、重复收款或错误放行，立即暂停新增测试单。

测试结束后，保留测试库供审计与问题复验；正式试点另建空库、独立桶和凭证，不导入模拟订单。正式成本模块保持关闭，直到单独验收。
