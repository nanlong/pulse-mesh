import { describe, expect, it } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { loadConfig } from '../src/config'
import { collectSources, canonicalUrl, type FetchLike } from '../src/sources'
import { hashValue, loadState, makeDecisionKey, pruneDecisionState, saveState } from '../src/state'

const response = (body: string, contentType: string) => new Response(body, { headers: { 'content-type': contentType } })

const fixtureFetch: FetchLike = async (input) => {
  const url = String(input)
  if (url.endsWith('/feed.xml')) return response('<?xml version="1.0"?><rss version="2.0"><channel><item><guid>rss-1</guid><title>RSS signal</title><link>https://example.test/rss-1</link><description>A reliable RSS signal with enough useful context.</description></item></channel></rss>', 'application/rss+xml')
  if (url.endsWith('/items.json')) return response(JSON.stringify({ data: [{ id: 'json-1', headline: 'JSON signal', body: 'A reliable JSON signal with enough useful context.', url: 'https://example.test/json-1' }] }), 'application/json')
  return response('<article><h1>HTML signal</h1><p>A reliable HTML signal with enough useful context.</p></article>', 'text/html')
}

describe('minimal configuration and source boundary', () => {
  it('uses generic AI variables and defaults', () => {
    const config = loadConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'key', TARGET_REPOSITORY: 'owner/site', TARGET_REPO_TOKEN: 'token', AI_ALLOWED_MODELS: 'deepseek-v4-flash' }, { rootDir: '/tmp/pulse-mesh-test' })
    expect(config.model).toBe('deepseek-v4-flash')
    expect(config.outputLanguages).toEqual(['zh-CN'])
    expect(config.sourceUrls.length).toBeGreaterThan(0)
    expect(config.maxCandidatesPerRun).toBe(5)
    expect(config.maxDecisionRecords).toBe(1000)
  })

  it('fails closed for a model outside the allowlist', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'deepseek', AI_API_KEY: 'key', TARGET_REPOSITORY: 'owner/site', TARGET_REPO_TOKEN: 'token', AI_MODEL: 'not-allowed', AI_ALLOWED_MODELS: 'deepseek-v4-flash' })).toThrow('not in AI_ALLOWED_MODELS')
  })

  it('normalizes RSS, JSON and HTML without type-specific caller configuration', async () => {
    const result = await collectSources([
      { id: 'rss', url: 'https://example.test/feed.xml' },
      { id: 'json', url: 'https://example.test/items.json' },
      { id: 'html', url: 'https://example.test/page' },
    ], fixtureFetch)
    expect(result.errors).toEqual([])
    expect(result.candidates.map((candidate) => candidate.externalId)).toEqual(['rss-1', 'json-1', 'https://example.test/page'])
  })

  it('keeps URL and decision hashes deterministic', () => {
    expect(canonicalUrl('https://example.test/a?utm_source=x&keep=1#part')).toBe('https://example.test/a?keep=1')
    expect(hashValue('same')).toBe(hashValue('same'))
    expect(makeDecisionKey('s', 'e', 'c', 'config')).toBe(makeDecisionKey('s', 'e', 'c', 'config'))
  })

  it('writes decisions atomically and reads a missing state as empty', async () => {
    const file = `/tmp/pulse-mesh-state-${Date.now()}-${Math.random()}/decisions.json`
    const state = await loadState(file)
    state.decisions.example = { decisionKey: 'example', status: 'rejected', configHash: 'config', updatedAt: new Date().toISOString() }
    await saveState(file, state)
    expect((await loadState(file)).decisions.example?.status).toBe('rejected')
  })

  it('loads legacy state without source checkpoints', async () => {
    const file = `/tmp/pulse-mesh-legacy-state-${Date.now()}-${Math.random()}.json`
    await writeFile(file, JSON.stringify({ version: 1, decisions: {}, lastRunAt: '2026-08-05T12:00:00.000Z' }))
    const state = await loadState(file)
    expect(state.sourceCheckpoints).toEqual({})
    expect(state.lastRunAt).toBe('2026-08-05T12:00:00.000Z')
  })

  it('prunes old decision records while preserving the run checkpoint', () => {
    const state = {
      version: 1 as const,
      lastRunAt: '2026-08-05T12:00:00.000Z',
      sourceCheckpoints: { 'https://example.test/feed.xml': '2026-08-05T12:00:00.000Z' },
      decisions: {
        old: { decisionKey: 'old', status: 'rejected' as const, configHash: 'config', updatedAt: '2026-08-05T10:00:00.000Z' },
        recent: { decisionKey: 'recent', status: 'published' as const, configHash: 'config', updatedAt: '2026-08-05T11:00:00.000Z' },
      },
    }
    pruneDecisionState(state, 1)
    expect(Object.keys(state.decisions)).toEqual(['recent'])
    expect(state.lastRunAt).toBe('2026-08-05T12:00:00.000Z')
    expect(state.sourceCheckpoints).toEqual({ 'https://example.test/feed.xml': '2026-08-05T12:00:00.000Z' })
  })
})
