# PulseMesh

PulseMesh 是一个由 GitHub Actions 驱动的两阶段静态内容发布器：A 私有生成端负责采集、去重、AI 判断和文章生成，B Astro 内容发布端负责构建并部署 GitHub Pages。

## 最小配置

A 仓库的 Repository Variables：

```env
AI_PROVIDER=deepseek
TARGET_REPOSITORY=owner/site-repo
```

A 仓库的 Repository Secrets：

```env
AI_API_KEY=***
TARGET_REPO_TOKEN=***
```

默认使用内置币圈来源包、简体中文、Markdown 和 `editorial` Astro 模板。常用覆盖项包括 `SOURCE_URLS`、`CONTENT_INSTRUCTIONS`、`GATE_PROMPT`、`ARTICLE_PROMPT`、`OUTPUT_LANGUAGES`、`AI_MODEL`、`AI_ALLOWED_MODELS`、`PUBLISH_THRESHOLD`、过滤阈值、模板路径和 `SITE_*` 视觉配置。换内容方向或站点风格时只需替换这些 Variables，不需要修改业务代码。

## 本地运行

需要 Bun 1.3+：

```bash
bun install
test -f .env || cp .env.example .env
bun run typecheck
bun test
bun run acceptance
```

`bun run acceptance` 使用本地 fixture、假的 AI 客户端和临时 bare Git 仓库，验证 RSS/Atom、JSON、HTML、去重、多语言、Astro bootstrap、production build 和幂等推送。真实 AI 或远程 B 推送只有在明确配置凭据后才会发生。

生产模式会拒绝 `example.*`、`.test`、`.invalid`、`localhost` 和回环地址等测试来源；fixture 只在验收脚本的显式测试模式中允许，不能进入正式 B 页面。

## 本地模拟 GitHub Actions

需要本机安装并启动 Docker，以及 `act`（建议使用 `0.2.86+`）。本地配置命令会保留原有环境变量和密钥，把已有 `DEEPSEEK_API_KEY` 映射为通用 `AI_API_KEY`，并把当前 Prompt 写入 `GATE_PROMPT` / `ARTICLE_PROMPT`，不会打印密钥：

```bash
bun run configure:local
bun run action:local -- --mode=bootstrap
bun run action:local -- --mode=run --preview
```

`action:local` 使用 `act workflow_dispatch` 执行与线上相同的 `.github/workflows/publish.yml`；`--schedule` 可以模拟定时触发。B 会写入 `.local/site.git`，`--preview` 会启动 Astro 开发服务器并打开 `http://127.0.0.1:4321/`。本地模式只跳过远程 push，决策状态仍会在本地提交。

## 工作流

`.github/workflows/publish.yml` 是 A 的唯一业务 workflow，支持定时和手动触发。空 B 初始化可使用 `workflow_dispatch` 的 `bootstrap` 模式；普通运行按以下顺序工作：

```text
采集 → 归一化 → 确定性去重 → 硬过滤 → AI Gate → 多语言生成 → 校验 → 推送 B
```

触发不等于发布。候选被拒绝、重复或校验失败时，运行可以成功结束，但不会创建 B 内容 commit。

B 由 A 从 `template/editorial` 初始化。初始化后，B 自己拥有页面、布局和样式；A 日常只写 `src/content/articles/**` 和 `public/generated/**`。B 的 `.github/workflows/pages.yml` 使用 Astro 官方 Action 构建并部署 GitHub Pages。

## 设计与边界

完整的首版实现契约见 [`docs/GitHub-Actions-两阶段静态发布方案.md`](./docs/GitHub-Actions-两阶段静态发布方案.md)。

首版不包含 Payload、Next.js、SQLite、常驻服务、后台管理、WebSocket、登录态浏览器、任意第三方模板和多模板升级机制。`.env` 与现有 `data/` 数据文件不会被本地命令删除。
