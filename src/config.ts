import path from 'node:path'

export type ProviderProfile = {
  baseUrl: string
  defaultModel: string
}

export type SourceConfig = {
  id: string
  url: string
}

export type SiteConfig = {
  name: string
  description: string
  tagline: string
  theme: 'editorial' | 'light' | 'midnight'
  primaryColor: string
  accentColor: string
  backgroundColor: string
  surfaceColor: string
  textColor: string
  mutedColor: string
  maxWidth: string
  cardRadius: string
  articleTitleMaxSize: string
  showTopics: boolean
  showScore: boolean
  showSources: boolean
  footerText: string
}

export type AppConfig = {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  allowedModels: string[]
  responseFormat: string
  targetRepository: string
  targetToken: string
  targetBranch: string
  sourceUrls: SourceConfig[]
  contentInstructions: string
  gatePrompt: string
  articlePrompt: string
  outputLanguages: string[]
  publishThreshold: number
  maxItemAgeHours: number
  minimumContentLength: number
  statePath: string
  templateDir: string
  site: SiteConfig
}

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
}

export const DEFAULT_CRYPTO_SOURCES: SourceConfig[] = [
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
]

const DEFAULT_GATE_PROMPT = '你是生产内容发布审核器，只判断是否值得公开发布，不写文章。必须确认来源真实可核验、内容有具体事实和行业信息增量，并拒绝测试、演示、fixture、placeholder、烟雾测试、管道验证、内部日志、营销、价格喊单、传闻、重复转载和证据不足内容。example.test、example.com、localhost、127.0.0.1 等保留测试地址不得作为生产来源。只能依据候选及来源判断，返回严格 JSON。'
const DEFAULT_ARTICLE_PROMPT = '你是生产级加密行业编辑。只使用 Gate 已通过的候选和来源 URL，生成事实准确、信息密度足够、可公开发布的 Markdown 文章。标题和摘要不得夸大，正文区分事实与推断，不补充候选之外的事实、引语、数字或来源，不提供投资建议，不输出测试、演示、fixture、placeholder 或管道验证内容。返回严格 JSON。'

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function sourceId(url: string, index: number): string {
  try {
    return `${new URL(url).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'source'}-${index + 1}`
  } catch {
    return `source-${index + 1}`
  }
}

function numberValue(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}`)
  return parsed
}

function booleanValue(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === '') return fallback
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  throw new Error(`${name} must be true or false`)
}

function tokenValue(value: string | undefined, fallback: string, name: string, pattern: RegExp): string {
  const resolved = value?.trim() || fallback
  if (!pattern.test(resolved)) throw new Error(`${name} contains an unsupported value`)
  return resolved
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  options: { allowMissingCredentials?: boolean; rootDir?: string } = {},
): AppConfig {
  const rootDir = options.rootDir ?? process.cwd()
  const provider = env.AI_PROVIDER?.trim() || ''
  if (!provider) throw new Error('AI_PROVIDER is required')
  const profile = PROVIDER_PROFILES[provider]
  const model = env.AI_MODEL?.trim() || profile?.defaultModel || ''
  const allowedModels = splitList(env.AI_ALLOWED_MODELS)
  const resolvedAllowedModels = allowedModels.length > 0 ? allowedModels : [model]
  if (!model) throw new Error('AI_MODEL is required for an unknown AI_PROVIDER')
  if (!resolvedAllowedModels.includes(model)) throw new Error(`AI_MODEL ${model} is not in AI_ALLOWED_MODELS`)

  const apiKey = env.AI_API_KEY?.trim() ?? ''
  const targetRepository = env.TARGET_REPOSITORY?.trim() ?? ''
  const targetToken = env.TARGET_REPO_TOKEN?.trim() ?? ''
  if (!options.allowMissingCredentials && !apiKey) throw new Error('AI_API_KEY is required')
  if (!options.allowMissingCredentials && !targetRepository) throw new Error('TARGET_REPOSITORY is required')
  const localTarget = targetRepository.startsWith('/') || targetRepository.startsWith('.') || targetRepository.startsWith('file://')
  const githubTarget = !localTarget && (/^[^/]+\/[^/]+$/.test(targetRepository) || targetRepository.startsWith('https://github.com/'))
  if (!options.allowMissingCredentials && githubTarget && !targetToken) throw new Error('TARGET_REPO_TOKEN is required for a GitHub target')

  const configuredUrls = splitList(env.SOURCE_URLS)
  const sourceUrls = (configuredUrls.length > 0 ? configuredUrls : DEFAULT_CRYPTO_SOURCES.map((source) => source.url)).map((url, index) => ({
    id: configuredUrls.length > 0 ? sourceId(url, index) : DEFAULT_CRYPTO_SOURCES[index]?.id ?? sourceId(url, index),
    url,
  }))
  const configuredLanguages = splitList(env.OUTPUT_LANGUAGES)
  const outputLanguages = configuredLanguages.length > 0 ? configuredLanguages : ['zh-CN']
  if (new Set(outputLanguages).size !== outputLanguages.length) throw new Error('OUTPUT_LANGUAGES must not contain duplicates')

  const threshold = numberValue(env.PUBLISH_THRESHOLD, 0.75, 'PUBLISH_THRESHOLD', 0, 1)
  const responseFormat = env.AI_RESPONSE_FORMAT?.trim() || 'json_object'
  if (!['json_object', 'json_schema'].includes(responseFormat)) throw new Error(`Unsupported AI_RESPONSE_FORMAT: ${responseFormat}`)
  const site: SiteConfig = {
    name: env.SITE_NAME?.trim() || 'PulseMesh',
    description: env.SITE_DESCRIPTION?.trim() || '经过筛选、核验和语言生成的行业资讯。',
    tagline: env.SITE_TAGLINE?.trim() || '先看事实，再看叙事。',
    theme: (env.SITE_THEME?.trim() || 'midnight') as SiteConfig['theme'],
    primaryColor: tokenValue(env.SITE_PRIMARY_COLOR, '#8b5cf6', 'SITE_PRIMARY_COLOR', /^#[0-9a-fA-F]{6}$/),
    accentColor: tokenValue(env.SITE_ACCENT_COLOR, '#22d3ee', 'SITE_ACCENT_COLOR', /^#[0-9a-fA-F]{6}$/),
    backgroundColor: tokenValue(env.SITE_BACKGROUND_COLOR, '#080d18', 'SITE_BACKGROUND_COLOR', /^#[0-9a-fA-F]{6}$/),
    surfaceColor: tokenValue(env.SITE_SURFACE_COLOR, '#111827', 'SITE_SURFACE_COLOR', /^#[0-9a-fA-F]{6}$/),
    textColor: tokenValue(env.SITE_TEXT_COLOR, '#e5eefb', 'SITE_TEXT_COLOR', /^#[0-9a-fA-F]{6}$/),
    mutedColor: tokenValue(env.SITE_MUTED_COLOR, '#94a3b8', 'SITE_MUTED_COLOR', /^#[0-9a-fA-F]{6}$/),
    maxWidth: tokenValue(env.SITE_MAX_WIDTH, '1180px', 'SITE_MAX_WIDTH', /^\d{3,4}px$/),
    cardRadius: tokenValue(env.SITE_CARD_RADIUS, '20px', 'SITE_CARD_RADIUS', /^\d{1,3}px$/),
    articleTitleMaxSize: tokenValue(env.SITE_ARTICLE_TITLE_MAX_SIZE, '4.2rem', 'SITE_ARTICLE_TITLE_MAX_SIZE', /^\d{1,2}(?:\.\d+)?(?:rem|px)$/),
    showTopics: booleanValue(env.SITE_SHOW_TOPICS, true, 'SITE_SHOW_TOPICS'),
    showScore: booleanValue(env.SITE_SHOW_SCORE, false, 'SITE_SHOW_SCORE'),
    showSources: booleanValue(env.SITE_SHOW_SOURCES, true, 'SITE_SHOW_SOURCES'),
    footerText: env.SITE_FOOTER_TEXT?.trim() || 'PulseMesh · Signal over noise.',
  }
  if (!['editorial', 'light', 'midnight'].includes(site.theme)) throw new Error(`Unsupported SITE_THEME: ${site.theme}`)
  return {
    provider,
    apiKey,
    baseUrl: (env.AI_BASE_URL?.trim() || profile?.baseUrl || '').replace(/\/$/, ''),
    model,
    allowedModels: resolvedAllowedModels,
    responseFormat,
    targetRepository,
    targetToken,
    targetBranch: env.TARGET_BRANCH?.trim() || 'main',
    sourceUrls,
    contentInstructions: env.CONTENT_INSTRUCTIONS?.trim() || '关注加密行业的重要政策、协议升级、安全事件和市场结构变化，忽略价格喊单、重复转载和低价值营销内容。',
    gatePrompt: env.GATE_PROMPT?.trim() || DEFAULT_GATE_PROMPT,
    articlePrompt: env.ARTICLE_PROMPT?.trim() || DEFAULT_ARTICLE_PROMPT,
    outputLanguages,
    publishThreshold: threshold,
    maxItemAgeHours: numberValue(env.MAX_ITEM_AGE_HOURS, 72, 'MAX_ITEM_AGE_HOURS', 1, 24 * 365),
    minimumContentLength: numberValue(env.MINIMUM_CONTENT_LENGTH, 40, 'MINIMUM_CONTENT_LENGTH', 1, 100_000),
    statePath: path.resolve(rootDir, env.STATE_PATH?.trim() || 'state/decisions.json'),
    templateDir: path.resolve(rootDir, env.TEMPLATE_DIR?.trim() || 'template/editorial'),
    site,
  }
}
