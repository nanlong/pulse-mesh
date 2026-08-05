import { z } from 'zod'
import type { AppConfig } from './config'
import type { Candidate } from './sources'

export type AiRequest = {
  system: string
  user: string
  model: string
  responseFormat: string
}

export interface AiClient {
  complete(request: AiRequest): Promise<unknown>
}

export type GateDecision = z.infer<typeof gateSchema>
export type GeneratedArticle = z.infer<typeof articleSchema>

const gateSchema = z.object({
  publish: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  topics: z.array(z.string()),
  risks: z.array(z.string()),
}).strict()

const articleSchema = z.object({
  language: z.string().min(2),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  sourceUrls: z.array(z.url()).min(1),
}).strict()

const generationSchema = z.object({ articles: z.array(articleSchema) }).strict()

const blockingRisks = new Set(['block', 'unsafe', 'insufficient-evidence', 'no-evidence'])

function responseContent(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('AI response must be an object')
  const choices = (value as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') throw new Error('AI response has no choices')
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') throw new Error('AI response has no message')
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string') throw new Error('AI response content must be a JSON string')
  return content
}

function parseJson<T>(value: unknown, schema: z.ZodType<T>, normalize: (parsed: unknown) => unknown = (parsed) => parsed): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseContent(value)) as unknown
  } catch {
    throw new Error('AI response is not valid JSON')
  }
  return schema.parse(normalize(parsed))
}

function normalizeGate(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const score = (value as { score?: unknown }).score
  if (typeof score === 'number' && score > 1 && score <= 100) return { ...value, score: score / 100 }
  return value
}

function ensureModel(config: AppConfig): void {
  if (!config.allowedModels.includes(config.model)) throw new Error(`AI_MODEL ${config.model} is not in AI_ALLOWED_MODELS`)
}

export function createAiClient(config: AppConfig, fetchFn: typeof fetch = fetch): AiClient {
  ensureModel(config)
  if (!config.apiKey) throw new Error('AI_API_KEY is required')
  if (!config.baseUrl) throw new Error('AI_BASE_URL is required for this AI_PROVIDER')
  return {
    async complete(request): Promise<unknown> {
      if (!config.allowedModels.includes(request.model)) throw new Error(`Model ${request.model} is not in AI_ALLOWED_MODELS`)
      const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
          response_format: request.responseFormat === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'pulse_mesh_output', strict: false, schema: { type: 'object', additionalProperties: true } } },
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`AI API failed with HTTP ${response.status}`)
      return await response.json()
    },
  }
}

export function gateSystemPrompt(config: AppConfig, template: string): string {
  return [template, config.contentInstructions, 'Return only strict JSON with publish, score, reason, topics, risks. score must be a number from 0 to 1, never a percentage from 0 to 100. Do not write an article. Do not invent facts.'].join('\n\n')
}

export async function evaluateCandidate(config: AppConfig, client: AiClient, candidate: Candidate, template: string): Promise<GateDecision> {
  ensureModel(config)
  const decision = parseJson(await client.complete({
    model: config.model,
    responseFormat: config.responseFormat,
    system: gateSystemPrompt(config, template),
    user: JSON.stringify({ candidate, task: 'Decide whether this candidate is important and worth publishing for the configured audience.' }),
  }), gateSchema, normalizeGate)
  if (!decision.publish || decision.score < config.publishThreshold || decision.risks.some((risk) => blockingRisks.has(risk.toLowerCase()))) return { ...decision, publish: false }
  return decision
}

export async function generateArticles(config: AppConfig, client: AiClient, candidate: Candidate, decision: GateDecision, template: string): Promise<GeneratedArticle[]> {
  ensureModel(config)
  const generated = parseJson(await client.complete({
    model: config.model,
    responseFormat: config.responseFormat,
    system: [template, config.contentInstructions, `Return exactly one JSON object with an articles array containing one object for every requested language (${config.outputLanguages.join(', ')}). Each article object must use exactly these keys: language, title, summary, body, sourceUrls. body must be Markdown text and sourceUrls must be an array of URLs. Use only the candidate and its source URL. Do not use a content key. Return strict JSON and no Markdown code fence.`].join('\n\n'),
    user: JSON.stringify({ candidate, gate: decision, languages: config.outputLanguages }),
  }), generationSchema)
  const expected = new Set(config.outputLanguages)
  const actual = new Set(generated.articles.map((article) => article.language))
  if (generated.articles.length !== expected.size || actual.size !== expected.size || [...expected].some((language) => !actual.has(language))) throw new Error('AI output languages do not match OUTPUT_LANGUAGES')
  if (generated.articles.some((article) => article.sourceUrls.some((url) => url !== candidate.canonicalUrl))) throw new Error('AI output contains an unknown source URL')
  if (generated.articles.some((article) => /<script\b|javascript:|data:text\/html/i.test(`${article.title}\n${article.summary}\n${article.body}`))) throw new Error('AI output contains unsafe markup or protocol')
  return generated.articles
}
