import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfig } from '../src/config'
import type { AiClient } from '../src/ai'
import { runPipeline } from '../src/main'
import { publishArticles } from '../src/publish'
import type { FetchLike } from '../src/sources'

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`${args.join(' ')} failed: ${stderr.trim()}`)
  return stdout.trim()
}

const root = await mkdtemp(path.join(tmpdir(), 'pulse-mesh-acceptance-'))
const bareRepository = path.join(root, 'site.git')
const templateDir = path.resolve('template/editorial')
await command(['git', 'init', '--bare', bareRepository], root)

const fetchFixture: FetchLike = async (input) => {
  const url = String(input)
  if (url.endsWith('/feed.xml')) return new Response('<?xml version="1.0"?><rss version="2.0"><channel><item><guid>rss-1</guid><title>RSS signal</title><link>https://example.test/rss-1</link><description>A reliable RSS signal with enough context for an important crypto publication.</description></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } })
  if (url.endsWith('/items.json')) return new Response(JSON.stringify({ data: [{ id: 'json-1', title: 'JSON signal', content: 'A reliable JSON signal with enough context for an important crypto publication.', url: 'https://example.test/json-1' }] }), { headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/page.html')) return new Response('<article><h1>HTML signal</h1><p>A reliable HTML signal with enough context for an important crypto publication.</p></article>', { headers: { 'content-type': 'text/html' } })
  throw new Error(`fixture unavailable: ${url}`)
}

const calls = { count: 0 }
const aiClient: AiClient = {
  async complete(request) {
    calls.count += 1
    const user = JSON.parse(request.user) as { candidate?: { canonicalUrl?: string }; languages?: string[]; task?: string }
    if (user.task) return { choices: [{ message: { content: JSON.stringify({ publish: true, score: 0.95, reason: 'important and sourced', topics: ['crypto'], risks: [] }) } }] }
    return { choices: [{ message: { content: JSON.stringify({ articles: (user.languages ?? ['zh-CN']).map((language) => ({ language, title: `Validated ${language}`, summary: 'Validated summary', body: 'Validated body with source-backed facts.', sourceUrls: [user.candidate?.canonicalUrl] })) }) } }] }
  },
}

const config = loadConfig({
  AI_PROVIDER: 'deepseek',
  AI_API_KEY: 'fake-key',
  AI_ALLOWED_MODELS: 'deepseek-v4-flash',
  TARGET_REPOSITORY: bareRepository,
  SOURCE_URLS: 'https://example.test/feed.xml\nhttps://example.test/items.json\nhttps://example.test/page.html\nhttps://example.test/unavailable',
  OUTPUT_LANGUAGES: 'zh-CN,en',
  PUBLISH_THRESHOLD: '0.75',
}, { rootDir: root })
const testConfig = { ...config, templateDir }
const first = await runPipeline({ config: testConfig, fetchFn: fetchFixture, aiClient, allowFixtureSources: true, publishedKeys: new Set() })
if (first.published !== 6 || first.sourceErrors !== 1 || calls.count !== 6) throw new Error(`first run did not publish 6 language files: ${JSON.stringify({ first, calls: calls.count })}`)

const stateAfterFirst = JSON.parse(await readFile(testConfig.statePath, 'utf8')) as { decisions: Record<string, { status: string }> }
if (Object.values(stateAfterFirst.decisions).some((decision) => decision.status !== 'published')) throw new Error('first run did not persist published decisions')

const second = await runPipeline({ config: { ...testConfig, statePath: path.join(root, 'second-run-state.json') }, fetchFn: fetchFixture, aiClient, allowFixtureSources: true })
if (second.published !== 0 || calls.count !== 6) throw new Error(`second run was not idempotent: ${JSON.stringify({ second, calls: calls.count })}`)

const checkout = path.join(root, 'checkout')
await command(['git', 'clone', bareRepository, checkout], root)
const articleFiles = await command(['git', 'ls-tree', '-r', '--name-only', 'HEAD'], checkout)
const articleCount = articleFiles.split('\n').filter((file) => file.startsWith('src/content/articles/') && file.endsWith('.md')).length
if (articleCount !== 6) throw new Error(`expected 6 article files, found ${articleCount}`)
for (const requiredFile of ['.gitignore', 'tsconfig.json', '.github/workflows/pages.yml', 'src/content.config.ts', 'src/layouts/Article.astro', 'src/styles/global.css']) {
  if (!articleFiles.split('\n').includes(requiredFile)) throw new Error(`bootstrap missing ${requiredFile}`)
}
const marker = JSON.parse(await readFile(path.join(checkout, '.pulse-mesh-site.json'), 'utf8')) as { template?: string }
if (marker.template !== 'editorial') throw new Error('Astro template marker missing')

const unknownBare = path.join(root, 'unknown.git')
const unknownWork = path.join(root, 'unknown-work')
await command(['git', 'init', '--bare', unknownBare], root)
await command(['git', 'clone', unknownBare, unknownWork], root)
await writeFile(path.join(unknownWork, 'README.md'), 'user-owned content\n', 'utf8')
await command(['git', 'config', 'user.name', 'fixture'], unknownWork)
await command(['git', 'config', 'user.email', 'fixture@example.test'], unknownWork)
await command(['git', 'add', 'README.md'], unknownWork)
await command(['git', 'commit', '-m', 'fixture'], unknownWork)
await command(['git', 'push', 'origin', 'HEAD:main'], unknownWork)
let unknownRepositoryError = ''
try {
  await publishArticles({ ...testConfig, targetRepository: unknownBare }, [], { bootstrapOnly: true })
} catch (error) {
  unknownRepositoryError = error instanceof Error ? error.message : String(error)
}
if (!unknownRepositoryError.includes('non-empty')) throw new Error('non-empty unknown B was not rejected')

await rm(root, { recursive: true, force: true })
console.log(JSON.stringify({ first, second, aiCalls: calls.count, articleFiles: articleCount, astroTemplate: marker.template }))
