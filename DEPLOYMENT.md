# sjtuai.art · 个人知识库（personal-knowledge-web）部署手册

与 `wujiangai.art`（纯静态门户）不同，本站是**动态应用**：Next.js 15 + PostgreSQL，
由 Caddy 反向代理到本机 Node 服务。本地目录按域名存放完整项目源码（独立 git 仓库）。

## 架构总览

| 环节 | 值 |
|---|---|
| 域名 | `sjtuai.art`（www 301 → 裸域），DNS → 43.155.203.242（腾讯云，与门户同一台） |
| 入口 | Caddy `reverse_proxy 127.0.0.1:3000`（配置：`/etc/caddy/Caddyfile`，快照见本目录 `Caddyfile`） |
| 应用 | Next.js 15 生产模式，systemd 服务 `personal-knowledge-web.service` |
| 代码（服务器） | `/opt/personal-knowledge-web`（git 检出，运行账号 `knowledge-web` 属主） |
| 运行账号 | `knowledge-web`（专用低权限账号，`HOME=/var/lib/knowledge-web`） |
| 数据库 | 本机 PostgreSQL 16（systemd 依赖 `postgresql.service`） |
| 本地源码 | 本目录（git 仓库，origin = github.com/wujiang1999/personal-knowledge-web） |

## 目录映射

| 本地（E:\TXY\deployment\sjtuai.art\） | 服务器 | 说明 |
|---|---|---|
| 项目全部源码（`app/`、`lib/`、`db/` 等） | `/opt/personal-knowledge-web` | 经审核的 git bundle 更新服务器检出 |
| `deploy.sh`（项目根自带） | 同名文件 | **服务器端**部署脚本，以 root 运行 |
| `Caddyfile` | `/etc/caddy/Caddyfile` | 线上 Caddy 配置的**权威快照**，改动后须双向同步 |
| `server/` | 各自路径 | 服务器侧配置纳管：`backup.sh`(→/usr/local/sbin/personal-knowledge-web-backup)、`restore-drill.*`(→/usr/local/sbin + /etc/systemd/system)、`kb-notify.sh`+`kb-alert@.service`(告警通知器)、`fail2ban-jail.local`(→/etc/fail2ban/jail.local)、`systemd-drops/*.conf`(OnFailure 告警 drop-in) |
| `offsite/pull-kb-offsite.ps1` | —（Windows 侧） | 异地拉取脚本，计划任务 "KB offsite backup pull" 每日 12:30 运行，备份落 `E:\Backups\personal-knowledge-web` |
| `DEPLOYMENT.md` | 不上传 | 本文档 |

## 部署流程

1. 本地开发、提交（`npm run check` = typecheck + lint + test）。
2. 代码以**审核后的 git bundle** 方式传到服务器，更新 `/opt/personal-knowledge-web` 检出
   （服务器脚本刻意不直接从 GitHub 拉取）。
3. SSH 到服务器，在检出目录执行 `sudo ./deploy.sh`，脚本自动完成：
   `npm ci` → 校验 → `db:migrate`（幂等）→ 构建（旧构建存为 `.next.rollback`）→
   `systemctl restart` → 健康检查（`/api/health`）→ 冒烟测试（`npm run smoke:prod`）。
   任一步失败自动恢复旧构建并重启，退出码 1。
4. 浏览器验证 https://sjtuai.art

## 常用运维

```bash
systemctl status personal-knowledge-web        # 服务状态
journalctl -u personal-knowledge-web -f        # 应用日志
sudo systemctl restart personal-knowledge-web  # 重启
curl http://127.0.0.1:3000/api/health          # 服务器本机健康检查
```

备份、账号管理等见项目内 `docs/OPERATIONS.md`。

## 注意事项

- **项目 README 的「部署到 ECS」章节已过时**（仍写阿里云旧路径 `/root/personal-knowledge-web`、
  旧 `git pull` 流程），以本文档和 `deploy.sh` 实际逻辑为准。
- 安全加固：systemd 单元启用 `NoNewPrivileges`、`ProtectSystem=full`，仅 `data/` 可写；
  ubuntu 账号读不了 `/opt/personal-knowledge-web` 属预期行为（需 sudo）。
- Caddy 层无静态文件：改 Caddy 配置后 `sudo systemctl reload caddy`，并同步更新本目录快照。

## 变更历史

- 2026-08-28：本地项目从 `E:\TXY\personal-knowledge-web\` 迁入 `deployment/sjtuai.art\`，
  按「deployment/<域名>/」统一归位；服务器端无任何变更。
- 2026-08-28（加固，详见仓库根 `personal-knowledge-web-architecture-review.md`）：
  SSH 改为 key-only + 禁 root 并安装 fail2ban；unattended-upgrades 启用 security pocket；
  备份脚本修复保留清理 glob（原 18 字符模式永不匹配，旧快照无限累积）；新增月度恢复演练
  （`personal-knowledge-web-restore-drill.timer`，首次演练 PASS）；备份异地化（Windows 每日拉取
  + SHA256 校验）；`kb-alert@` 告警单元接入 smoke/备份/演练/caddy 四个服务（微信主、飞书备）；
  Caddyfile 增加 HSTS + 访问文件日志（供 fail2ban 限流 `/api/auth/login`）+ 请求体 128MB 上限
  （XFO/CSP/nosniff 由应用层负责，边缘不重复设置）；DB 密码与 SESSION_SECRET 轮换
  （`rotate-db-password.sh` 重写，服务器端生成不落明文）；服务器残留 Caddyfile 片段归档至
  `~/caddyfile-archive-20260828/`。备份保留以脚本为准（30 天，非旧文档所写 14 天）。
