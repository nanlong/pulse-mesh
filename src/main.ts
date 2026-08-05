import { createAiClient, evaluateCandidate, generateArticles, type AiClient } from './ai'
import { loadConfig, type AppConfig } from './config'
import { collectSources, type Candidate, type FetchLike } from './sources'
import { hashValue, loadState, makeDecisionKey, pruneDecisionState, saveState, type DecisionState } from './state'
import { loadTargetPublishedKeys, publishArticles, type ArticleFile } from './publish'

type PromptSet = { gate: string; article: string }

export type RunOptions = {
  config: AppConfig
  fetchFn?: FetchLike
  aiClient?: AiClient
  allowFixtureSources?: boolean
  now?: Date
  mode?: 'run' | 'bootstrap'
  publishedKeys?: Set<string>
  publish?: (config: AppConfig, articles: ArticleFile[], options?: { bootstrapOnly?: boolean }) => Promise<string | undefined>
}

function prompts(config: AppConfig): PromptSet {
  return {
    gate: config.gatePrompt,
    article: config.articlePrompt,
  }
}

function normalizedContent(candidate: Candidate): string {
  return `${candidate.title}\n${candidate.content}`.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isHardFiltered(candidate: Candidate, config: AppConfig, now: Date): string | undefined {
  if (candidate.content.trim().length < config.minimumContentLength) return 'content-too-short'
  if (!candidate.publishedAt) return undefined
  const publishedAt = Date.parse(candidate.publishedAt)
  if (!Number.isFinite(publishedAt)) return 'invalid-published-at'
  if (now.getTime() - publishedAt > config.maxItemAgeHours * 3_600_000) return 'too-old'
  return undefined
}

function isWithinProcessingWindow(candidate: Candidate, config: AppConfig, now: Date): boolean {
  if (!candidate.publishedAt) return true
  const publishedAt = Date.parse(candidate.publishedAt)
  return Number.isFinite(publishedAt) && now.getTime() - publishedAt <= config.maxItemAgeHours * 3_600_000
}

function isFreshCandidate(candidate: Candidate, config: AppConfig, now: Date, lastRunAt?: string): boolean {
  if (!isWithinProcessingWindow(candidate, config, now)) return false
  if (!lastRunAt) return true
  if (!candidate.publishedAt) return false
  const publishedAt = Date.parse(candidate.publishedAt)
  const checkpoint = Date.parse(lastRunAt)
  return Number.isFinite(publishedAt) && Number.isFinite(checkpoint) && publishedAt > checkpoint
}

function publishedTimestamp(candidate: Candidate): number {
  if (!candidate.publishedAt) return Number.NEGATIVE_INFINITY
  const publishedAt = Date.parse(candidate.publishedAt)
  return Number.isFinite(publishedAt) ? publishedAt : Number.NEGATIVE_INFINITY
}

function latestDecisionAt(state: DecisionState): string | undefined {
  const timestamps = Object.values(state.decisions).map((decision) => Date.parse(decision.updatedAt)).filter(Number.isFinite)
  if (timestamps.length === 0) return undefined
  return new Date(Math.max(...timestamps)).toISOString()
}

function isReservedFixtureSource(candidate: Candidate): boolean {
  try {
    const hostname = new URL(candidate.canonicalUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '0.0.0.0'
      || hostname === 'example'
      || hostname.endsWith('.example')
      || hostname === 'invalid'
      || hostname.endsWith('.invalid')
      || hostname === 'test'
      || hostname.endsWith('.test')
  } catch {
    return false
  }
}

function configHash(config: AppConfig, promptSet: PromptSet): string {
  return hashValue(JSON.stringify({ provider: config.provider, model: config.model, threshold: config.publishThreshold, languages: config.outputLanguages, instructions: config.contentInstructions, prompts: promptSet }))
}

export async function runPipeline(options: RunOptions): Promise<{ collected: number; skipped: number; filtered: number; rejected: number; generated: number; published: number; sourceErrors: number; bCommitSha?: string }> {
  const { config } = options
  const now = options.now ?? new Date()
  const promptSet = prompts(config)
  const currentConfigHash = configHash(config, promptSet)
  const state = await loadState(config.statePath)
  const publishedKeys = options.publishedKeys ?? await loadTargetPublishedKeys(config)
  if (options.mode === 'bootstrap') {
    const commit = await (options.publish ?? publishArticles)(config, [], { bootstrapOnly: true })
    return { collected: 0, skipped: 0, filtered: 0, rejected: 0, generated: 0, published: 0, sourceErrors: 0, bCommitSha: commit }
  }
  const aiClient = options.aiClient ?? createAiClient(config)
  const collection = await collectSources(config.sourceUrls, options.fetchFn)
  const candidates = new Map<string, Candidate>()
  for (const candidate of collection.candidates) {
    const key = `${candidate.sourceId}:${candidate.externalId}:${hashValue(normalizedContent(candidate))}`
    if (!candidates.has(key)) candidates.set(key, candidate)
  }
  const lastRunAt = state.lastRunAt ?? latestDecisionAt(state)
  const orderedCandidates = [...candidates.values()]
    .filter((candidate) => isFreshCandidate(candidate, config, now, lastRunAt))
    .sort((left, right) => {
      const timestampDifference = publishedTimestamp(right) - publishedTimestamp(left)
      if (timestampDifference !== 0) return timestampDifference
      return `${left.sourceId}:${left.externalId}`.localeCompare(`${right.sourceId}:${right.externalId}`)
    })
  const candidatesForRun = orderedCandidates.slice(0, config.maxCandidatesPerRun)
  const skipped = Math.max(0, orderedCandidates.length - candidatesForRun.length)
  let filtered = 0
  let rejected = 0
  let generated = 0
  let hasFailures = false
  const articles: ArticleFile[] = []
  const seenKeys = new Set<string>()
  for (const candidate of candidatesForRun) {
    const contentHash = hashValue(normalizedContent(candidate))
    const decisionKey = makeDecisionKey(candidate.sourceId, candidate.externalId, contentHash, currentConfigHash)
    const existingDecision = state.decisions[decisionKey]
    if ((existingDecision && existingDecision.status !== 'failed') || publishedKeys.has(decisionKey) || seenKeys.has(decisionKey)) continue
    seenKeys.add(decisionKey)
    const filterReason = !options.allowFixtureSources && isReservedFixtureSource(candidate)
      ? 'reserved-test-source'
      : isHardFiltered(candidate, config, now)
    if (filterReason) {
      filtered += 1
      state.decisions[decisionKey] = { decisionKey, status: 'rejected', reason: filterReason, configHash: currentConfigHash, updatedAt: now.toISOString() }
      continue
    }
    const decision = await evaluateCandidate(config, aiClient, candidate, promptSet.gate)
    if (!decision.publish) {
      rejected += 1
      state.decisions[decisionKey] = { decisionKey, status: 'rejected', reason: decision.reason, score: decision.score, configHash: currentConfigHash, updatedAt: now.toISOString() }
      continue
    }
    try {
      const generatedArticles = await generateArticles(config, aiClient, candidate, decision, promptSet.article)
      for (const article of generatedArticles) articles.push({ ...article, decisionKey, publishedAt: now.toISOString(), score: decision.score, topics: decision.topics })
      generated += generatedArticles.length
      state.decisions[decisionKey] = { decisionKey, status: 'generated', reason: decision.reason, score: decision.score, configHash: currentConfigHash, updatedAt: now.toISOString() }
    } catch (error) {
      hasFailures = true
      state.decisions[decisionKey] = { decisionKey, status: 'failed', reason: error instanceof Error ? error.message : String(error), configHash: currentConfigHash, updatedAt: now.toISOString() }
    }
  }
  let commit: string | undefined
  if (articles.length > 0) {
    try {
      commit = await (options.publish ?? publishArticles)(config, articles)
      if (!commit) throw new Error('B publish produced no commit')
      for (const article of articles) {
        state.decisions[article.decisionKey] = { ...state.decisions[article.decisionKey], decisionKey: article.decisionKey, status: 'published', configHash: currentConfigHash, updatedAt: now.toISOString(), bCommitSha: commit }
      }
    } catch (error) {
      for (const article of articles) state.decisions[article.decisionKey] = { ...state.decisions[article.decisionKey], decisionKey: article.decisionKey, status: 'failed', reason: error instanceof Error ? error.message : String(error), configHash: currentConfigHash, updatedAt: now.toISOString() }
      pruneDecisionState(state, config.maxDecisionRecords)
      await saveState(config.statePath, state)
      throw error
    }
  }
  if (!hasFailures && collection.errors.length === 0) state.lastRunAt = now.toISOString()
  pruneDecisionState(state, config.maxDecisionRecords)
  await saveState(config.statePath, state)
  return { collected: collection.candidates.length, skipped, filtered, rejected, generated, published: commit ? articles.length : 0, sourceErrors: collection.errors.length, bCommitSha: commit }
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--bootstrap') ? 'bootstrap' : 'run'
  const config = loadConfig()
  const summary = await runPipeline({ config, mode })
  console.log(JSON.stringify(summary))
}

if (import.meta.main) await main()
