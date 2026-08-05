import { describe, expect, it } from 'bun:test'
import { loadConfig } from '../src/config'
import { runPipeline } from '../src/main'
import type { AiClient } from '../src/ai'
import type { FetchLike } from '../src/sources'

const fetchFixture: FetchLike = async (input) => {
  const url = String(input)
  if (url.endsWith('/feed.xml')) return new Response('<?xml version="1.0"?><rss version="2.0"><channel><item><guid>pipeline-1</guid><title>Pipeline signal</title><link>https://example.test/pipeline-1</link><description>A useful signal with enough context for publication.</description></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } })
  return new Response('{}', { headers: { 'content-type': 'application/json' } })
}

function fakeAi(calls: { count: number }): AiClient {
  return {
    async complete(request) {
      calls.count += 1
      const user = JSON.parse(request.user) as { candidate?: { canonicalUrl?: string }; languages?: string[] }
      if (request.user.includes('Decide whether')) return { choices: [{ message: { content: JSON.stringify({ publish: true, score: 0.9, reason: 'important', topics: ['security'], risks: [] }) } }] }
      return { choices: [{ message: { content: JSON.stringify({ articles: (user.languages ?? ['zh-CN']).map((language) => ({ language, title: `Article ${language}`, summary: 'Summary', body: 'Body with verified source context.', sourceUrls: [user.candidate?.canonicalUrl] })) }) } }] }
    },
  }
}

describe('pipeline idempotence', () => {
  it('does not call AI or publish again for the same decision key', async () => {
    const root = `/tmp/pulse-mesh-pipeline-${Date.now()}-${Math.random()}`
    const config = loadConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'key', TARGET_REPOSITORY: 'owner/site', TARGET_REPO_TOKEN: 'token', AI_ALLOWED_MODELS: 'deepseek-v4-flash', SOURCE_URLS: 'https://example.test/feed.xml', OUTPUT_LANGUAGES: 'zh-CN,en' }, { rootDir: root })
    const calls = { count: 0 }
    let publishes = 0
    const publish = async () => { publishes += 1; return 'commit-1' }
    const first = await runPipeline({ config, fetchFn: fetchFixture, aiClient: fakeAi(calls), allowFixtureSources: true, publishedKeys: new Set(), publish })
    const second = await runPipeline({ config, fetchFn: fetchFixture, aiClient: fakeAi(calls), allowFixtureSources: true, publishedKeys: new Set(), publish })
    expect(first.published).toBe(2)
    expect(second.published).toBe(0)
    expect(calls.count).toBe(2)
    expect(publishes).toBe(1)
  })

  it('does not generate or publish when the Gate rejects a candidate', async () => {
    const root = `/tmp/pulse-mesh-reject-${Date.now()}-${Math.random()}`
    const config = loadConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'key', TARGET_REPOSITORY: 'owner/site', TARGET_REPO_TOKEN: 'token', AI_ALLOWED_MODELS: 'deepseek-v4-flash', SOURCE_URLS: 'https://example.test/feed.xml' }, { rootDir: root })
    let calls = 0
    let publishes = 0
    const aiClient: AiClient = { async complete() { calls += 1; return { choices: [{ message: { content: JSON.stringify({ publish: false, score: 0.1, reason: 'not important', topics: [], risks: [] }) } }] } } }
    const result = await runPipeline({ config, fetchFn: fetchFixture, aiClient, allowFixtureSources: true, publishedKeys: new Set(), publish: async () => { publishes += 1; return 'never' } })
    expect(result.rejected).toBe(1)
    expect(result.generated).toBe(0)
    expect(result.published).toBe(0)
    expect(calls).toBe(1)
    expect(publishes).toBe(0)
  })

  it('blocks reserved fixture sources in production mode before AI evaluation', async () => {
    const root = `/tmp/pulse-mesh-reserved-source-${Date.now()}-${Math.random()}`
    const config = loadConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'key', TARGET_REPOSITORY: 'owner/site', TARGET_REPO_TOKEN: 'token', AI_ALLOWED_MODELS: 'deepseek-v4-flash', SOURCE_URLS: 'https://example.test/feed.xml' }, { rootDir: root })
    let calls = 0
    const aiClient: AiClient = { async complete() { calls += 1; throw new Error('AI must not receive fixture sources') } }
    const result = await runPipeline({ config, fetchFn: fetchFixture, aiClient, publishedKeys: new Set(), publish: async () => 'never' })
    expect(result.filtered).toBe(1)
    expect(result.generated).toBe(0)
    expect(result.published).toBe(0)
    expect(calls).toBe(0)
  })

  it('processes newest candidates first and defers the rest when the run cap is reached', async () => {
    const root = `/tmp/pulse-mesh-pipeline-cap-${Date.now()}-${Math.random()}`
    const config = loadConfig({
      AI_PROVIDER: 'deepseek',
      AI_API_KEY: 'key',
      TARGET_REPOSITORY: 'owner/site',
      TARGET_REPO_TOKEN: 'token',
      AI_ALLOWED_MODELS: 'deepseek-v4-flash',
      SOURCE_URLS: 'https://example.test/multiple.xml',
      MAX_ITEM_AGE_HOURS: '24',
      MAX_CANDIDATES_PER_RUN: '2',
    }, { rootDir: root })
    const fetchFn: FetchLike = async () => new Response(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item><guid>old</guid><title>Old signal</title><link>https://example.test/old</link><pubDate>Tue, 04 Aug 2026 00:00:00 GMT</pubDate><description>Old signal with enough context for publication.</description></item>
      <item><guid>recent-1</guid><title>Recent one</title><link>https://example.test/recent-1</link><pubDate>Wed, 05 Aug 2026 11:00:00 GMT</pubDate><description>Recent signal one with enough context for publication.</description></item>
      <item><guid>recent-2</guid><title>Recent two</title><link>https://example.test/recent-2</link><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate><description>Recent signal two with enough context for publication.</description></item>
      <item><guid>recent-3</guid><title>Recent three</title><link>https://example.test/recent-3</link><pubDate>Wed, 05 Aug 2026 09:00:00 GMT</pubDate><description>Recent signal three with enough context for publication.</description></item>
    </channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })
    const calls = { count: 0 }
    const result = await runPipeline({
      config,
      fetchFn,
      aiClient: fakeAi(calls),
      allowFixtureSources: true,
      now: new Date('2026-08-05T12:00:00Z'),
      publishedKeys: new Set(),
      publish: async (_config, articles) => {
        expect(articles).toHaveLength(2)
        return 'commit-1'
      },
    })
    expect(result.collected).toBe(4)
    expect(result.deferred).toBe(1)
    expect(result.published).toBe(2)
    expect(calls.count).toBe(4)
  })
})
