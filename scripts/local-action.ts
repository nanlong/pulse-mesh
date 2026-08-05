import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type CommandOptions = { cwd?: string; stdout?: 'inherit' | 'pipe' | 'ignore'; stderr?: 'inherit' | 'pipe' | 'ignore' }

async function command(args: string[], options: CommandOptions = {}): Promise<number> {
  const child = Bun.spawn(args, {
    cwd: options.cwd,
    stdin: 'inherit',
    stdout: options.stdout ?? 'inherit',
    stderr: options.stderr ?? 'inherit',
  })
  const drains: Promise<string>[] = []
  if (options.stdout === 'pipe') drains.push(new Response(child.stdout).text())
  if (options.stderr === 'pipe') drains.push(new Response(child.stderr).text())
  const [exitCode] = await Promise.all([child.exited, ...drains])
  return exitCode
}

async function ensureDocker(): Promise<void> {
  if (!Bun.which('act')) throw new Error('act is required; install nektos/act first')
  if (!Bun.which('docker')) throw new Error('Docker is required by act; start Docker Desktop first')
  if (await command(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }) !== 0) throw new Error('Docker is not running; start Docker Desktop first')
}

async function main(): Promise<void> {
  const argumentsList = new Set(process.argv.slice(2))
  const schedule = argumentsList.has('--schedule')
  const preview = argumentsList.has('--preview')
  const bootstrap = argumentsList.has('--bootstrap') || process.argv.includes('--mode=bootstrap')
  const mode = bootstrap ? 'bootstrap' : 'run'
  await ensureDocker()

  const root = process.cwd()
  const repository = '.local/site.git'
  const repositoryPath = path.resolve(root, repository)
  await mkdir(path.dirname(repositoryPath), { recursive: true })
  if (await command(['git', 'rev-parse', '--is-bare-repository'], { cwd: repositoryPath, stdout: 'pipe', stderr: 'pipe' }) !== 0) {
    const initialized = await command(['git', 'init', '--bare', repositoryPath])
    if (initialized !== 0) throw new Error('Unable to initialize .local/site.git')
  }

  const apiKey = process.env.AI_API_KEY || ''
  if (!apiKey) throw new Error('AI_API_KEY is missing; run bun run configure:local first')
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'pulse-mesh-act-'))
  const secretsPath = path.join(temporaryDirectory, 'secrets')
  const emptyEnvPath = path.join(temporaryDirectory, 'env')
  await Bun.write(secretsPath, `AI_API_KEY=${apiKey}\nTARGET_REPO_TOKEN=${process.env.TARGET_REPO_TOKEN || ''}\n`)
  await chmod(secretsPath, 0o600)
  await Bun.write(emptyEnvPath, '')

  const variables: Array<[string, string]> = [
    ['AI_PROVIDER', process.env.AI_PROVIDER || 'deepseek'],
    ['AI_BASE_URL', process.env.AI_BASE_URL || 'https://api.deepseek.com'],
    ['AI_MODEL', process.env.AI_MODEL || 'deepseek-v4-flash'],
    ['AI_ALLOWED_MODELS', process.env.AI_ALLOWED_MODELS || 'deepseek-v4-flash'],
    ['AI_RESPONSE_FORMAT', process.env.AI_RESPONSE_FORMAT || 'json_object'],
    ['TARGET_REPOSITORY', repository],
    ['SOURCE_URLS', process.env.SOURCE_URLS || ''],
    ['CONTENT_INSTRUCTIONS', process.env.CONTENT_INSTRUCTIONS || ''],
    ['GATE_PROMPT', process.env.GATE_PROMPT || ''],
    ['ARTICLE_PROMPT', process.env.ARTICLE_PROMPT || ''],
    ['OUTPUT_LANGUAGES', process.env.OUTPUT_LANGUAGES || 'zh-CN'],
    ['PUBLISH_THRESHOLD', process.env.PUBLISH_THRESHOLD || '0.75'],
    ['TARGET_BRANCH', process.env.TARGET_BRANCH || 'main'],
    ['MAX_ITEM_AGE_HOURS', process.env.MAX_ITEM_AGE_HOURS || '24'],
    ['MAX_CANDIDATES_PER_RUN', process.env.MAX_CANDIDATES_PER_RUN || '5'],
    ['MINIMUM_CONTENT_LENGTH', process.env.MINIMUM_CONTENT_LENGTH || '40'],
    ['STATE_PATH', process.env.STATE_PATH || 'state/decisions.json'],
    ['TEMPLATE_DIR', process.env.TEMPLATE_DIR || 'template/editorial'],
    ['SITE_NAME', process.env.SITE_NAME || 'PulseMesh'],
    ['SITE_DESCRIPTION', process.env.SITE_DESCRIPTION || '经过筛选、核验和语言生成的加密行业资讯。'],
    ['SITE_TAGLINE', process.env.SITE_TAGLINE || '先看事实，再看叙事。'],
    ['SITE_THEME', process.env.SITE_THEME || 'midnight'],
    ['SITE_PRIMARY_COLOR', process.env.SITE_PRIMARY_COLOR || '#8b5cf6'],
    ['SITE_ACCENT_COLOR', process.env.SITE_ACCENT_COLOR || '#22d3ee'],
    ['SITE_BACKGROUND_COLOR', process.env.SITE_BACKGROUND_COLOR || '#080d18'],
    ['SITE_SURFACE_COLOR', process.env.SITE_SURFACE_COLOR || '#111827'],
    ['SITE_TEXT_COLOR', process.env.SITE_TEXT_COLOR || '#e5eefb'],
    ['SITE_MUTED_COLOR', process.env.SITE_MUTED_COLOR || '#94a3b8'],
    ['SITE_MAX_WIDTH', process.env.SITE_MAX_WIDTH || '1180px'],
    ['SITE_CARD_RADIUS', process.env.SITE_CARD_RADIUS || '20px'],
    ['SITE_ARTICLE_TITLE_MAX_SIZE', process.env.SITE_ARTICLE_TITLE_MAX_SIZE || '2.8rem'],
    ['SITE_SHOW_TOPICS', process.env.SITE_SHOW_TOPICS || 'true'],
    ['SITE_SHOW_SCORE', process.env.SITE_SHOW_SCORE || 'false'],
    ['SITE_SHOW_SOURCES', process.env.SITE_SHOW_SOURCES || 'true'],
    ['SITE_FOOTER_TEXT', process.env.SITE_FOOTER_TEXT || 'PulseMesh · Signal over noise.'],
    ['PULSE_MESH_LOCAL', 'true'],
  ]
  const actArguments = [
    schedule ? 'schedule' : 'workflow_dispatch',
    '--workflows', '.github/workflows/publish.yml',
    '--bind',
    '--secret-file', secretsPath,
    '--env-file', emptyEnvPath,
    '--rm',
  ]
  if (!schedule) actArguments.push('--input', `mode=${mode}`)
  for (const [key, value] of variables) actArguments.push('--var', `${key}=${value}`)

  try {
    const exitCode = await command(['act', ...actArguments])
    if (exitCode !== 0) throw new Error(`Local GitHub Actions run failed with exit code ${exitCode}`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }

  console.log(`Local B repository: ${repositoryPath}`)
  if (!preview) return
  const sitePath = path.resolve(root, '.local/site')
  if (await command(['git', 'clone', repositoryPath, sitePath], { stdout: 'inherit', stderr: 'inherit' }) !== 0) {
    await command(['git', '-C', sitePath, 'fetch', 'origin', 'main'])
    await command(['git', '-C', sitePath, 'checkout', '-B', 'main', 'origin/main'])
  }
  if (await command(['bun', 'install', '--frozen-lockfile'], { cwd: sitePath }) !== 0) throw new Error('B dependency installation failed')
  console.log('Preview: http://127.0.0.1:4321/')
  const server = Bun.spawn(['bunx', 'astro', 'dev', '--host', '127.0.0.1'], { cwd: sitePath, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  await server.exited
}

if (import.meta.main) await main()
