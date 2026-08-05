# GitHub Actions 两阶段静态发布最小方案（已实现）

> 状态：首版最小闭环已实现，并已通过本地 fixture、临时 bare Git B 仓库和 Astro production build 验收。
>
> 本地验收不执行真实 AI 付费调用或远程 push；真实 GitHub Actions 与 Pages 发布需在配置目标仓库和凭据后手动验证。

## 1. 结论

首版只保留两个运行端和两个 GitHub Actions workflow：

- **A：私有 AI 生成端**，负责采集、去重、过滤、AI 判断、文章生成、状态记录和推送；
- **B：内容发布端**，持有一个可美化的 Astro 站点，只负责构建和部署 GitHub Pages。

最短真实链路为：

```text
A workflow 定时或手动触发
  → 采集并归一化 RSS / Atom、JSON、HTML
  → AI 前确定性去重和硬过滤
  → 一次 AI Gate 判断是否值得发布
  → 仅通过时，一次生成全部目标语言
  → 校验结构、来源和 Astro build
  → 一个 commit 推送 B
  → B workflow 构建并部署 Pages
```

核心产品语义是：**触发不等于发布**。候选重复、过期、不重要、证据不足、AI 输出无效或构建失败时，都不生成公开 commit。B 完成一次性初始化后，普通运行没有合格文章时不得发生变化。

## 2. 首版范围与非目标

### 2.1 必须实现

- GitHub Actions 定时触发和手动触发；
- GitHub Variables / Secrets 优先的配置读取；
- 通用 AI 环境变量、模型配置和模型 allowlist；
- RSS / Atom、JSON HTTP API、HTML 三类公开来源；
- AI 前确定性去重、基础硬过滤和一个独立 AI Gate；
- 可配置内容指令和完整 Prompt 文件；
- 一次生成多个语言的 Markdown；
- A 的私有去重状态，重复运行不重复调用 AI；
- 空 B 仓库的 Astro 初始化；
- A 只写 B 的文章目录，B 自己拥有主题和页面；
- GitHub Pages 自动构建与部署；
- 任一关键步骤失败时 fail closed。

### 2.2 首版明确不做

- Payload、Next.js、SQLite、后台管理界面或常驻服务器；
- WebSocket、登录态浏览器、验证码、强反爬绕过；
- 任意第三方模板下载和执行；
- 多模板市场、模板自动升级和主题版本迁移；
- Gate 五维独立评分、人工 review 状态；
- Gate、写作、翻译分别选择模型；
- 独立翻译调用和 `translator.md`；
- Markdown 之外的文章输出格式；
- B 的额外 public manifest；
- 自动解决 Git push 冲突；
- 成本账单、复杂指标平台和历史决策查询服务。

这些能力可以后续增加，但不得成为首版完成条件。

## 3. A 与 B 的职责边界

### 3.1 A：私有 AI 生成端

A 保存：

- AI 和目标仓库 Secrets；
- 数据源、业务指令、Prompt、模型和语言配置；
- 候选内容、去重指纹和私有决策状态；
- 采集、判断、生成、校验和推送代码；
- 用于首次初始化 B 的单个受信任 Astro 模板。

A 是“是否发布”的唯一决策者。B 不调用 AI，也不保存拒绝候选、内部理由、Prompt、模型原始输出或 Secrets。

### 3.2 B：Astro 内容发布端

B 保存：

- Astro 核心、页面、布局、组件和样式；
- 已通过 Gate 和校验的多语言 Markdown；
- GitHub Pages workflow；
- `.pulse-mesh-site.json` 初始化标记。

B 的文章目录同时是公开内容事实源，Astro Content Collections 直接读取它生成首页、文章页和语言导航。首版不再维护第二份 public manifest。

A 日常发布只允许修改：

```text
src/content/articles/**
public/generated/**
```

A 不得覆盖 B 的页面、组件、布局、样式、依赖或 workflow。

## 4. 最简配置

### 4.1 首次运行只需四项

GitHub Repository Variables：

```env
AI_PROVIDER=deepseek
TARGET_REPOSITORY=owner/site-repo
```

GitHub Repository Secrets：

```env
AI_API_KEY=***
TARGET_REPO_TOKEN=***
```

默认配置为：

- 来源包：`crypto-default`；
- 内容方向：重要币圈政策、协议升级、安全事故和市场结构变化；
- AI 模型：所选提供方档案中的默认模型；
- 输出语言：`zh-CN`；
- 发布阈值：安全默认值；
- 输出格式：Markdown；
- B 模板：内置 `editorial` Astro 模板。

提供方档案是数据配置，负责声明兼容协议、默认 base URL 和默认模型。`deepseek` 只是一个档案，不得在运行时接口、Secret 名称或业务代码中创建 DeepSeek 专用分支。

### 4.2 常用可选配置

普通用户只需要接触以下覆盖项：

| Variable | 用途 |
| --- | --- |
| `SOURCE_URLS` | 每行一个自定义公开来源 URL；为空时使用默认币圈来源包 |
| `CONTENT_INSTRUCTIONS` | 关注主题、受众、排除内容、语气和篇幅 |
| `GATE_PROMPT` | 完整的候选筛选与发布判断 Prompt |
| `ARTICLE_PROMPT` | 完整的文章生成 Prompt；一次返回所有目标语言 |
| `OUTPUT_LANGUAGES` | 逗号分隔语言，例如 `zh-CN,en,ja` |
| `AI_MODEL` | Gate 和文章生成共用模型 |
| `AI_ALLOWED_MODELS` | 允许使用的模型列表；默认只允许最终生效模型 |
| `PUBLISH_THRESHOLD` | AI Gate 最低综合分，范围 `[0, 1]` |
| `TARGET_BRANCH` | B 发布分支，默认 `main` |
| `MAX_ITEM_AGE_HOURS` | 候选最大年龄，默认 `24` 小时 |
| `MAX_CANDIDATES_PER_RUN` | 单次运行最多进入 Gate 的候选数，默认 `5`；按发布时间从新到旧选择，超出上限的候选为保持新鲜度而跳过，不进入下一轮 backlog |
| `MAX_DECISION_RECORDS` | `state/decisions.json` 最多保留的最新决策数，默认 `1000` |
| `MINIMUM_CONTENT_LENGTH` | 正文最小长度，默认 `40` |
| `STATE_PATH` | A 决策状态路径，默认 `state/decisions.json` |
| `TEMPLATE_DIR` | A 使用的 Astro 模板目录，默认 `template/editorial` |

站点视觉也由 A 的 Variables 控制，A 会在发布 B 时生成 `src/data/site-config.generated.json`：

| Variable | 用途 |
| --- | --- |
| `SITE_NAME` / `SITE_DESCRIPTION` / `SITE_TAGLINE` | 站点品牌、描述和首页导语 |
| `SITE_THEME` | `midnight`、`editorial` 或 `light` |
| `SITE_PRIMARY_COLOR` / `SITE_ACCENT_COLOR` | 主色和强调色，使用六位十六进制颜色 |
| `SITE_BACKGROUND_COLOR` / `SITE_SURFACE_COLOR` | 页面背景和卡片表面颜色 |
| `SITE_TEXT_COLOR` / `SITE_MUTED_COLOR` | 正文和弱化文字颜色 |
| `SITE_MAX_WIDTH` / `SITE_CARD_RADIUS` / `SITE_ARTICLE_TITLE_MAX_SIZE` | 内容宽度、卡片圆角和文章标题上限 |
| `SITE_SHOW_TOPICS` / `SITE_SHOW_SCORE` / `SITE_SHOW_SOURCES` | 是否展示主题、Gate 分数和来源 |
| `SITE_FOOTER_TEXT` | 页脚文案 |

接入未内置档案的 OpenAI Chat Completions 兼容提供方时，再配置：

| Variable | 用途 |
| --- | --- |
| `AI_BASE_URL` | 自定义兼容 API 基础地址 |
| `AI_RESPONSE_FORMAT` | 提供方支持的结构化响应方式，例如 `json_schema` 或 `json_object` |

首版只承诺支持明确实现和验证过的 OpenAI Chat Completions 兼容协议，不宣称支持任意 AI API 协议。

### 4.3 覆盖优先级

```text
GitHub Actions 手动触发的非敏感输入
  > GitHub Variables / Secrets
  > 仓库默认配置

本地运行的环境变量
  > 仓库默认配置
```

Secret 只能来自 GitHub Secrets 或本地环境，不得进入默认配置、日志、artifact、A 的状态文件或 B。

GitHub Actions 的 `schedule.cron` 不能直接使用 Repository Variable 插值。首版 workflow 提供固定的保守周期和手动触发；修改真实触发周期时直接编辑 workflow。

## 5. Prompt 与多语言

两个 Prompt 只来自配置：`GATE_PROMPT` 判断候选是否重要、是否有信息增量、证据是否足够以及是否值得发布；`ARTICLE_PROMPT` 一次生成 `OUTPUT_LANGUAGES` 指定的全部语言版本。本地 `.env` 和 GitHub Variables 都可以保存多行 Prompt，代码不再读取 Prompt 文件。

这样切换到另一个内容方向时，只修改来源、业务指令、Prompt、语言和模型配置，不需要改 A 的 TypeScript。

`CONTENT_INSTRUCTIONS` 注入两个 Prompt，作为业务目标和写作要求。固定的 JSON schema、禁止编造、证据引用和安全约束由代码附加，不允许业务 Prompt 覆盖。

Prompt 内容哈希自动进入决策配置哈希。修改 Prompt 或 `CONTENT_INSTRUCTIONS` 后，相同来源内容可以形成新的可追踪决策；普通用户不需要手工维护 Prompt 版本号。

Gate 每个候选只调用一次，不按语言重复。Gate 通过后，文章生成模型一次返回全部语言：

```json
{
  "articles": [
    {
      "language": "zh-CN",
      "title": "示例标题",
      "summary": "示例摘要",
      "body": "Markdown 正文",
      "sourceUrls": ["https://example.com/source"]
    },
    {
      "language": "en",
      "title": "Example title",
      "summary": "Example summary",
      "body": "Markdown body",
      "sourceUrls": ["https://example.com/source"]
    }
  ]
}
```

所有配置语言必须存在、语言不能重复、来源 URL 必须来自候选证据。任一语言无效时，整个事件不发布，避免语言版本不一致。

## 6. A 的单进程流水线

A workflow 只有一个业务 job，并只运行一个入口：

```yaml
- run: bun src/main.ts
```

`src/main.ts` 顺序执行以下步骤，不使用 job outputs 或跨 job artifact 传递中间状态。

### 6.1 采集与归一化

`SOURCE_URLS` 每行一个 URL。采集器根据响应 `Content-Type` 和响应体特征自动识别。采集后的候选先按 `MAX_ITEM_AGE_HOURS` 排除过期内容，再按上次成功运行时间筛选新内容，按发布时间从新到旧排序，并只将前 `MAX_CANDIDATES_PER_RUN` 条交给 Gate。超出上限的候选会被本轮跳过，不会形成 backlog；下一轮只看新的内容。

- XML：RSS / Atom；
- JSON：常见 `items`、`data`、`results`、`articles` 列表；
- HTML：feed 链接、JSON-LD、语义化 `article` 或正文。

所有来源统一转换为：

```ts
interface Candidate {
  sourceId: string
  externalId: string
  canonicalUrl: string
  title: string
  content: string
  publishedAt?: string
}
```

首版只处理无需认证的公开来源，不实现 JSONPath、CSS selector、分页 DSL 或动态凭据映射。无法可靠识别的来源记录错误并跳过；单个来源失败不阻止其他来源继续。

### 6.2 AI 前去重与硬过滤

在任何收费 AI 调用前完成：

- canonical URL 规范化；
- `sourceId + externalId` 去重；
- 规范化正文内容哈希；
- 同批次重复检查；
- A 私有状态和 B 已发布文章的 decision key 检查；
- 过期、空正文、正文过短和不允许来源过滤；
- 生产模式拒绝 `example.*`、`.test`、`.invalid`、`localhost`、回环地址等保留测试来源；fixture 验收只能通过显式测试选项开启。

命中稳定键的候选直接跳过。AI 不代替 URL、external ID 和内容哈希去重。

### 6.3 单一 AI Gate

Gate 使用一个最小严格 JSON 契约：

```json
{
  "publish": true,
  "score": 0.86,
  "reason": "具有明确行业影响且存在可靠来源",
  "topics": ["security"],
  "risks": []
}
```

发布条件只有：

- JSON 能通过严格 schema；
- `publish` 为 boolean `true`；
- `score >= PUBLISH_THRESHOLD`；
- `reason` 非空；
- `risks` 不包含阻断项。

非法 JSON、字段缺失、模型超时、模型不在 allowlist、证据不足或任何契约错误都 fail closed。首版只有 `rejected`，不增加人工 `review` 状态。

### 6.4 生成与校验

只有 Gate 通过才调用文章生成。生成后执行：

- 严格 JSON schema 校验；
- 语言集合与 `OUTPUT_LANGUAGES` 完全一致；
- title、summary、body、slug 和日期等必需字段校验；
- `sourceUrls` 必须是候选来源 URL 的子集；
- Prompt 和代码都禁止把测试、演示、fixture、placeholder 或管道验证内容改写成新闻；
- slug 和输出路径不得发生路径穿越；
- Markdown 不允许危险脚本或危险协议；
- 将文章写入 B 的临时 checkout 后运行 Astro 类型检查和 production build。

不单独开发 HTML 校验器；复用 Astro Content Collections、Astro 检查和 production build 验证最终站点输入。

### 6.5 推送

A 在 B 的临时 checkout 中写入全部语言文章，验证成功后创建一个 commit 并普通推送：

- 不创建空 commit；
- 不 force push；
- 推送冲突直接失败，由后续运行重试；
- 多语言文章必须位于同一个 commit；
- B 推送成功前不得把状态标记为 `published`。

## 7. 最小状态与幂等

A 使用一个私有文件：

```text
state/decisions.json
```

决策键为：

```text
decisionKey = sourceId + externalId + contentHash + configHash
```

`configHash` 由 Gate Prompt、文章 Prompt、业务指令、模型、发布阈值和输出语言计算。相同 decision key 重复运行时：

- 不调用 Gate；
- 不调用文章生成；
- 不创建 B commit。

状态只需要记录：

- decision key；
- `rejected`、`generated`、`published` 或 `failed`；
- Gate 的最小结构化结果；
- Prompt/config hash；
- 首次和最近处理时间；
- B commit SHA（发布成功后）。

状态还记录最近一次无来源错误且完成保存的 `lastRunAt` 检查点。下一轮只处理发布时间晚于该检查点的候选；没有发布时间的来源只在尚无检查点时处理。每次保存前按 `MAX_DECISION_RECORDS` 删除最旧决策，保证 `decisions.json` 有固定上限。已发布文章的 decision key 由 B 的 front matter 保留，状态记录被裁剪后仍能防止重复发布。

B 文章 front matter 同时保存 `decisionKey`。每次运行先读取 B 已有文章的 decision key；即使 B 推送成功后 A 状态提交失败，也不会重新调用 AI 或重复发布。

## 8. B 的一次性初始化与美化边界

A 内只维护一个受信任的 `editorial` Astro 模板。用户创建空 B 后，A 的一次性 bootstrap：

1. 确认 B 确实为空；
2. 复制 Astro 模板；
3. 写入 `.pulse-mesh-site.json`；
4. 运行 production build；
5. 创建并推送初始化 commit。

若 B 非空且没有 `.pulse-mesh-site.json`，A 必须停止，不能覆盖。若标记存在，普通发布只写文章和 A 生成的站点配置，不覆盖 B 的页面、样式和 workflow。

首版模板提供：

- 美观的资讯首页和文章页；
- 响应式布局；
- 深浅色模式；
- 多语言文章导航；
- 主题标签、发布时间、重要性和来源展示；
- 基础 SEO 和 Open Graph。

初始化后，B 拥有所有样式和页面。用户直接修改 B 即可美化站点，A 不负责同步或升级主题。模板选择、多模板和自动升级延后。

## 9. 两个 workflow

### 9.1 A workflow

支持：

- `schedule`；
- `workflow_dispatch`；
- concurrency group，保证同一目标仓库只有一个运行；
- 一个业务 job；
- 运行摘要显示采集数、重复数、拒绝数、发布数和错误数。

A 使用仓库 `GITHUB_TOKEN` 更新自己的 `state/decisions.json`，使用 `TARGET_REPO_TOKEN` 只写指定 B。fork 和不可信 PR 不得获得发布 Secret。

首次 bootstrap 是一次技术初始化，不代表有文章发布。完成初始化后，`published_count=0` 的普通运行不得修改 B。

### 9.2 B workflow

B workflow 只负责：

1. checkout；
2. 使用 Astro 官方 Pages Action 安装锁定依赖、构建并上传 Pages artifact；
3. 使用 GitHub Pages 官方部署 Action 发布。

权限为：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

B 不持有 AI、来源或 A 的写入凭据。

## 10. 最小代码树

### 10.1 A

```text
A/
├── .github/workflows/publish.yml
├── src/
│   ├── main.ts
│   ├── config.ts
│   ├── sources.ts
│   ├── ai.ts
│   ├── state.ts
│   └── publish.ts
├── state/decisions.json
├── template/editorial/
└── tests/pipeline.test.ts
```

不为每个步骤建立独立目录、service、repository、provider interface 或 job。只有一个职责确实无法放入上述文件时才新增模块。

### 10.2 B

```text
B/
├── .github/workflows/pages.yml
├── .pulse-mesh-site.json
├── astro.config.mjs
├── package.json
└── src/
    ├── content.config.ts
    ├── content/
    │   └── articles/<language>/
    ├── layouts/Article.astro
    ├── pages/index.astro
    ├── pages/[...slug].astro
    └── styles/global.css
```

首页和文章页从 Astro Content Collections 直接读取文章，不维护 public manifest 或第二套内容索引。
集合 schema 定义在当前 Astro 约定的 `src/content.config.ts`，并通过 glob loader 读取 `src/content/articles/**`。

## 11. 最小验收标准

首版只要求以下闭环证据：

1. 仅配置 2 个 Variable 和 2 个 Secret，可以初始化空 B 并完成一次 A → B → Pages 发布。
2. RSS/Atom、JSON 和 HTML fixture 都能归一化为统一 Candidate；单个来源失败不阻止其他来源。
3. 相同输入连续运行两次，第二次产生 0 次 AI 调用和 0 个 B commit。
4. 硬过滤命中、Gate 拒绝、低于阈值、非法 JSON 或模型失败时，不调用文章生成且不修改已初始化的 B。
5. `AI_MODEL` 不在 `AI_ALLOWED_MODELS` 时，在 AI 调用前失败。
6. `OUTPUT_LANGUAGES=zh-CN,en,ja` 时 Gate 只调用一次，生成一次返回三个通过校验的语言文件；任一语言失败则全部不发布。
7. B 为空时能够 bootstrap；B 非空且无标记时拒绝覆盖；普通发布不修改 B 的页面、样式和 workflow。
8. 写入 B 前 Astro 检查和 production build 通过；B workflow 能独立部署 Pages。
9. 日志、状态、artifact 和 B 中不出现 Secret、私有 Prompt 或拒绝候选全文。
10. 删除旧动态链路前，使用真实 GitHub Actions 验证一次成功发布和一次正常空发布，并保留迁移与回滚证据。

本地验收使用 fixture 来源、假的外部 AI 服务和临时 bare Git B 仓库，不依赖真实 AI 费用或远程写入。真实远程推送只在明确配置目标仓库和凭据后执行。

## 12. 实施顺序

1. 建立最简配置解析、Candidate、Gate 和 Article schema；
2. 打通三类来源归一化与确定性去重；
3. 打通一次 Gate 和一次多语言生成；
4. 写入并持久化最小 decisions state；
5. 建立单个 `editorial` Astro 模板和空 B bootstrap；
6. 打通 B 临时 checkout、Astro build、单 commit 推送；
7. 建立 A、B 两个 workflow；
8. 完成十条最小验收；
9. 迁移已发布内容；
10. 单独评审并删除 Payload、Next.js 和 SQLite 旧链路。

## 13. 后续产品化能力

只有最小闭环稳定后，才评估：

- 认证来源、JSONPath、CSS selector 和分页配置；
- Gate 多维评分和人工 review；
- Gate、写作、翻译分阶段模型；
- 独立翻译和部分语言发布；
- 多种内容格式和 public manifest；
- 多个 Astro 模板、模板市场和升级机制；
- 自动处理推送冲突；
- 成本统计、决策查询和运营后台。

这些能力不是当前首版的一部分，不得提前建立抽象或依赖。

## 14. 本地模拟 GitHub Actions

为避免本地命令和线上 workflow 走两套逻辑，首版提供 `act` 本地模拟入口：

```bash
bun run configure:local
bun run action:local -- --mode=bootstrap
bun run action:local -- --mode=run --preview
```

本地入口执行的仍是 `.github/workflows/publish.yml`，支持 `workflow_dispatch` 和 `schedule` 两种事件。它把 `.env` 的非敏感配置映射为 `vars`，把 `AI_API_KEY` 和 `TARGET_REPO_TOKEN` 映射为 `secrets`，并将 B 指向 `.local/site.git`。

本地模式只跳过向 A 远程仓库的 push；`state/decisions.json` 仍会本地提交，A → B 的采集、Gate、生成、Astro build 和 B push 都照常执行。`--preview` 会克隆本地 B 并启动 Astro 开发服务器。

运行前需要启动 Docker，并使用 `act 0.2.86+`；没有 Docker 时只能执行普通 CLI 验收，不能运行容器化 workflow。
