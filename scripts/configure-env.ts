import { readFile, writeFile } from 'node:fs/promises'

const envPath = '.env'

function parseEnv(lines: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string
      } catch {
        // Keep the original value when an existing .env uses non-JSON quoting.
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    values.set(match[1], value)
  }
  return values
}

function envLiteral(value: string): string {
  return /^[A-Za-z0-9_./:@%+,=-]*$/.test(value) ? value : JSON.stringify(value)
}

async function main(): Promise<void> {
  const source = await readFile(envPath, 'utf8')
  const lines = source.split(/\r?\n/)
  const values = parseEnv(lines)
  const apiKey = values.get('AI_API_KEY') || values.get('DEEPSEEK_API_KEY') || ''
  if (!apiKey) throw new Error('AI_API_KEY or DEEPSEEK_API_KEY is required in .env')
  const siteName = values.get('SITE_NAME') || 'PulseMesh'
  const gatePrompt = values.get('GATE_PROMPT') || '你是生产内容发布审核器，只判断是否值得公开发布，不写文章。必须确认来源真实可核验、内容有具体事实和行业信息增量，并拒绝测试、演示、fixture、placeholder、烟雾测试、管道验证、内部日志、营销、价格喊单、传闻、重复转载和证据不足内容。example.test、example.com、localhost、127.0.0.1 等保留测试地址不得作为生产来源。只能依据候选及来源判断，返回严格 JSON。'
  const articlePrompt = values.get('ARTICLE_PROMPT') || '你是生产级加密行业编辑。只使用 Gate 已通过的候选和来源 URL，生成事实准确、信息密度足够、可公开发布的 Markdown 文章。标题和摘要不得夸大，正文区分事实与推断，不补充候选之外的事实、引语、数字或来源，不提供投资建议，不输出测试、演示、fixture、placeholder 或管道验证内容。返回严格 JSON。'

  const updates = new Map<string, string>([
    ['AI_PROVIDER', values.get('AI_PROVIDER') || 'deepseek'],
    ['AI_API_KEY', apiKey],
    ['AI_BASE_URL', values.get('AI_BASE_URL') || 'https://api.deepseek.com'],
    ['AI_MODEL', values.get('AI_MODEL') || 'deepseek-v4-flash'],
    ['AI_ALLOWED_MODELS', values.get('AI_ALLOWED_MODELS') || 'deepseek-v4-flash'],
    ['AI_RESPONSE_FORMAT', values.get('AI_RESPONSE_FORMAT') || 'json_object'],
    ['TARGET_REPOSITORY', '.local/site.git'],
    ['TARGET_REPO_TOKEN', values.get('TARGET_REPO_TOKEN') || ''],
    ['SOURCE_URLS', values.get('SOURCE_URLS') || ''],
    ['CONTENT_INSTRUCTIONS', values.get('CONTENT_INSTRUCTIONS') || '关注加密行业的重要政策、协议升级、安全事件和市场结构变化，忽略价格喊单、重复转载和低价值营销内容。'],
    ['GATE_PROMPT', gatePrompt],
    ['ARTICLE_PROMPT', articlePrompt],
    ['OUTPUT_LANGUAGES', values.get('OUTPUT_LANGUAGES') || 'zh-CN'],
    ['PUBLISH_THRESHOLD', values.get('PUBLISH_THRESHOLD') || '0.75'],
    ['TARGET_BRANCH', values.get('TARGET_BRANCH') || 'main'],
    ['MAX_ITEM_AGE_HOURS', values.get('MAX_ITEM_AGE_HOURS') || '24'],
    ['MAX_CANDIDATES_PER_RUN', values.get('MAX_CANDIDATES_PER_RUN') || '5'],
    ['MAX_DECISION_RECORDS', values.get('MAX_DECISION_RECORDS') || '1000'],
    ['MINIMUM_CONTENT_LENGTH', values.get('MINIMUM_CONTENT_LENGTH') || '40'],
    ['STATE_PATH', values.get('STATE_PATH') || 'state/decisions.json'],
    ['TEMPLATE_DIR', values.get('TEMPLATE_DIR') || 'template/editorial'],
    ['SITE_NAME', siteName],
    ['SITE_DESCRIPTION', values.get('SITE_DESCRIPTION') || '经过筛选、核验和语言生成的加密行业资讯。'],
    ['SITE_TAGLINE', values.get('SITE_TAGLINE') || '先看事实，再看叙事。'],
    ['SITE_LOCALE', values.get('SITE_LOCALE') || 'zh-CN'],
    ['SITE_PUBLISHER_NAME', values.get('SITE_PUBLISHER_NAME') || siteName],
    ['SITE_AUTHOR_NAME', values.get('SITE_AUTHOR_NAME') || siteName],
    ['SITE_CONTACT_URL', values.get('SITE_CONTACT_URL') || ''],
    ['SITE_AI_DISCLOSURE', values.get('SITE_AI_DISCLOSURE') || '内容由自动化流程辅助整理，保留可核验来源；事实、来源观点与推断应明确区分。'],
    ['SITE_SOCIAL_IMAGE_URL', values.get('SITE_SOCIAL_IMAGE_URL') || ''],
    ['SITE_NEWSLETTER_URL', values.get('SITE_NEWSLETTER_URL') || ''],
    ['SITE_SPONSOR_URL', values.get('SITE_SPONSOR_URL') || ''],
    ['SITE_THEME', values.get('SITE_THEME') || 'midnight'],
    ['SITE_PRIMARY_COLOR', values.get('SITE_PRIMARY_COLOR') || '#8b5cf6'],
    ['SITE_ACCENT_COLOR', values.get('SITE_ACCENT_COLOR') || '#22d3ee'],
    ['SITE_BACKGROUND_COLOR', values.get('SITE_BACKGROUND_COLOR') || '#080d18'],
    ['SITE_SURFACE_COLOR', values.get('SITE_SURFACE_COLOR') || '#111827'],
    ['SITE_TEXT_COLOR', values.get('SITE_TEXT_COLOR') || '#e5eefb'],
    ['SITE_MUTED_COLOR', values.get('SITE_MUTED_COLOR') || '#94a3b8'],
    ['SITE_MAX_WIDTH', values.get('SITE_MAX_WIDTH') || '1180px'],
    ['SITE_CARD_RADIUS', values.get('SITE_CARD_RADIUS') || '20px'],
    ['SITE_ARTICLE_TITLE_MAX_SIZE', values.get('SITE_ARTICLE_TITLE_MAX_SIZE') || '2.8rem'],
    ['SITE_SHOW_TOPICS', values.get('SITE_SHOW_TOPICS') || 'true'],
    ['SITE_SHOW_SCORE', values.get('SITE_SHOW_SCORE') || 'false'],
    ['SITE_SHOW_SOURCES', values.get('SITE_SHOW_SOURCES') || 'true'],
    ['SITE_FOOTER_TEXT', values.get('SITE_FOOTER_TEXT') || 'PulseMesh · Signal over noise.'],
  ])

  for (const [key, value] of updates) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line))
    const line = `${key}=${envLiteral(value)}`
    if (index >= 0) lines[index] = line
    else lines.push(line)
  }
  await writeFile(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
  console.log(`Configured .env for local PulseMesh runs: ${[...updates.keys()].join(', ')}`)
}

if (import.meta.main) await main()
