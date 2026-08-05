import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppConfig } from './config'
import type { GeneratedArticle } from './ai'
import { readPublishedDecisionKeys } from './state'

export type ArticleFile = GeneratedArticle & { decisionKey: string; publishedAt: string; score?: number; topics?: string[] }

type CommandResult = { stdout: string; stderr: string; code: number }

async function command(args: string[], cwd: string, env?: Record<string, string>): Promise<CommandResult> {
  const processEnv = { ...process.env, ...env }
  const child = Bun.spawn(args, { cwd, env: processEnv, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}

async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const result = await command(['git', ...args], cwd, env)
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

function remoteUrl(repository: string): string {
  if (/^(https?|file):\/\//.test(repository)) return repository
  if (repository.startsWith('/') || repository.startsWith('.')) return path.resolve(repository)
  return `https://github.com/${repository}.git`
}

function gitAuthEnv(config: AppConfig): Record<string, string> {
  if (!config.targetToken || !remoteUrl(config.targetRepository).startsWith('https://github.com/')) return {}
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${config.targetToken}`,
  }
}

async function isEmptyTarget(directory: string): Promise<boolean> {
  return (await readdir(directory)).filter((entry) => entry !== '.git').length === 0
}

async function ensureTargetTemplate(config: AppConfig, directory: string): Promise<boolean> {
  if (await isEmptyTarget(directory)) {
    await cp(config.templateDir, directory, {
      recursive: true,
      force: true,
      filter: (source) => ![`${path.sep}node_modules`, `${path.sep}.astro`, `${path.sep}dist`].some((segment) => source === `${config.templateDir}${segment}` || source.startsWith(`${config.templateDir}${segment}${path.sep}`)),
    })
    return true
  }
  const markerPath = path.join(directory, '.pulse-mesh-site.json')
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { template?: string }
    if (marker.template !== 'editorial') throw new Error('B template marker is not compatible')
  } catch (error) {
    if (error instanceof Error && error.message.includes('not compatible')) throw error
    throw new Error('B is non-empty and has no compatible .pulse-mesh-site.json')
  }
  return false
}

async function writeSiteConfig(config: AppConfig, directory: string): Promise<void> {
  const filePath = path.join(directory, 'src/data/site-config.generated.json')
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config.site, null, 2)}\n`, 'utf8')
}

function safeSlug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || 'article'
}

async function buildTarget(directory: string): Promise<void> {
  const install = await command(['bun', 'install', '--frozen-lockfile'], directory)
  if (install.code !== 0) throw new Error(`B dependency installation failed: ${install.stderr.trim()}`)
  const build = await command(['bun', 'run', 'build'], directory)
  if (build.code !== 0) throw new Error(`B Astro build failed: ${build.stderr.trim()}`)
}

function articleMarkdown(article: ArticleFile): string {
  const urls = article.sourceUrls.map((url) => `  - ${JSON.stringify(url)}`).join('\n')
  const topics = (article.topics ?? []).map((topic) => `  - ${JSON.stringify(topic)}`).join('\n')
  return ['---', `decisionKey: ${JSON.stringify(article.decisionKey)}`, `language: ${JSON.stringify(article.language)}`, `title: ${JSON.stringify(article.title)}`, `summary: ${JSON.stringify(article.summary)}`, `publishedAt: ${JSON.stringify(article.publishedAt)}`, ...(article.score === undefined ? [] : [`score: ${article.score}`]), 'topics:', topics || '  []', 'sourceUrls:', urls, '---', '', article.body.trim(), ''].join('\n')
}

async function checkoutTarget(config: AppConfig): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pulse-mesh-b-'))
  const clone = await command(['git', 'clone', remoteUrl(config.targetRepository), directory], process.cwd(), gitAuthEnv(config))
  if (clone.code !== 0) {
    await rm(directory, { recursive: true, force: true })
    throw new Error(`B clone failed: ${clone.stderr.trim()}`)
  }
  await git(['checkout', '-B', config.targetBranch], directory)
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

export async function loadTargetPublishedKeys(config: AppConfig): Promise<Set<string>> {
  const target = await checkoutTarget(config)
  try {
    return await readPublishedDecisionKeys(target.directory)
  } finally {
    await target.cleanup()
  }
}

export async function publishArticles(config: AppConfig, articles: ArticleFile[], options: { bootstrapOnly?: boolean } = {}): Promise<string | undefined> {
  const target = await checkoutTarget(config)
  try {
    const bootstrapped = await ensureTargetTemplate(config, target.directory)
    await writeSiteConfig(config, target.directory)
    if (!options.bootstrapOnly) {
      for (const article of articles) {
        const filePath = path.join(target.directory, 'src/content/articles', article.language, `${safeSlug(article.title)}-${article.decisionKey.slice(0, 10)}.md`)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, articleMarkdown(article), 'utf8')
      }
    }
    await buildTarget(target.directory)
    await git(['config', 'user.name', 'pulse-mesh[bot]'], target.directory)
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], target.directory)
    const paths = options.bootstrapOnly || bootstrapped
      ? ['.gitignore', 'tsconfig.json', '.pulse-mesh-site.json', 'astro.config.mjs', 'package.json', 'bun.lock', 'src', 'public', '.github']
      : ['src/content/articles', 'src/data/site-config.generated.json']
    try {
      await readdir(path.join(target.directory, 'public/generated'))
      if (!options.bootstrapOnly) paths.push('public/generated')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await git(['add', ...paths], target.directory)
    const staged = await git(['diff', '--cached', '--name-only'], target.directory)
    if (!staged) return undefined
    await git(['commit', '-m', options.bootstrapOnly ? 'chore: bootstrap Astro site' : 'content: publish validated articles'], target.directory)
    await git(['push', 'origin', `HEAD:${config.targetBranch}`], target.directory, gitAuthEnv(config))
    return await git(['rev-parse', 'HEAD'], target.directory)
  } finally {
    await target.cleanup()
  }
}
