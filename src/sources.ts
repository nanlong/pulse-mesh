import { load } from 'cheerio'
import Parser from 'rss-parser'
import type { SourceConfig } from './config'

export type Candidate = {
  sourceId: string
  externalId: string
  canonicalUrl: string
  title: string
  content: string
  publishedAt?: string
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type CollectionResult = {
  candidates: Candidate[]
  errors: Array<{ sourceId: string; error: string }>
}

const rssParser = new Parser()

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return undefined
}

export function canonicalUrl(value: string, base?: string): string {
  try {
    const url = new URL(value, base)
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid', 'ref'].includes(key.toLowerCase())) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

function asCandidate(sourceId: string, item: { externalId?: unknown; url?: unknown; title?: unknown; content?: unknown; publishedAt?: unknown }, base?: string): Candidate | undefined {
  const url = canonicalUrl(stringValue(item.url) || base || '', base)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url, base)
  } catch {
    return undefined
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) return undefined
  const title = stringValue(item.title) || url
  const content = stringValue(item.content) || title
  if (!url || !title || !content) return undefined
  return {
    sourceId,
    externalId: stringValue(item.externalId) || url,
    canonicalUrl: url,
    title,
    content,
    publishedAt: stringValue(item.publishedAt),
  }
}

async function feedCandidates(sourceId: string, text: string, sourceUrl: string): Promise<Candidate[]> {
  const parsed = await rssParser.parseString(text)
  return parsed.items.flatMap((item, index) => {
    const link = typeof item.link === 'string' ? item.link : `${sourceUrl}#item-${index}`
    return asCandidate(sourceId, {
      externalId: item.guid || item.id || link,
      url: link,
      title: item.title,
      content: item.contentSnippet || item.content || item.summary,
      publishedAt: item.isoDate || item.pubDate,
    }, sourceUrl) ?? []
  })
}

function findObjectArray(value: unknown, depth = 0): unknown[] | undefined {
  if (depth > 4 || value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object')) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findObjectArray(item, depth + 1)
      if (nested) return nested
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of ['items', 'data', 'results', 'articles', 'entries']) {
    const nested = findObjectArray(record[key], depth + 1)
    if (nested) return nested
  }
  for (const child of Object.values(record)) {
    const nested = findObjectArray(child, depth + 1)
    if (nested) return nested
  }
  return undefined
}

function objectField(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key]
  }
  return undefined
}

function jsonCandidates(sourceId: string, document: unknown, sourceUrl: string): Candidate[] {
  const items = findObjectArray(document) ?? []
  return items.flatMap((value, index) => {
    const item = value as Record<string, unknown>
    const url = objectField(item, ['url', 'link', 'href', 'html_url']) || `${sourceUrl}#item-${index}`
    return asCandidate(sourceId, {
      externalId: objectField(item, ['id', 'guid', 'uuid', 'slug']) || url,
      url,
      title: objectField(item, ['title', 'headline', 'name']) || url,
      content: objectField(item, ['content', 'body', 'description', 'summary', 'text']) || objectField(item, ['title', 'headline', 'name']),
      publishedAt: objectField(item, ['publishedAt', 'published_at', 'datePublished', 'created_at', 'date']),
    }, sourceUrl) ?? []
  })
}

function jsonLdCandidates(sourceId: string, document: string, sourceUrl: string): Candidate[] {
  const $ = load(document)
  const candidates: Candidate[] = []
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const value = JSON.parse($(element).text()) as unknown
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const type = stringValue(record['@type']) || ''
        if (!/article|news|blog/i.test(type)) continue
        const candidate = asCandidate(sourceId, {
          externalId: record.url,
          url: record.url || sourceUrl,
          title: record.headline || record.name,
          content: record.articleBody || record.description,
          publishedAt: record.datePublished,
        }, sourceUrl)
        if (candidate) candidates.push(candidate)
      }
    } catch {
      // Ignore malformed JSON-LD and continue with semantic HTML extraction.
    }
  })
  return candidates
}

function htmlCandidates(sourceId: string, document: string, sourceUrl: string): Candidate[] {
  const $ = load(document)
  const structured = jsonLdCandidates(sourceId, document, sourceUrl)
  if (structured.length > 0) return structured
  const candidates: Candidate[] = []
  $('article').each((index, element) => {
    const node = $(element)
    const link = node.find('a[href]').first().attr('href') || sourceUrl
    const title = node.find('h1,h2,h3,[itemprop="headline"]').first().text().trim() || $('title').text().trim() || link
    const content = node.find('[itemprop="articleBody"],p').text().trim() || node.text().trim()
    const candidate = asCandidate(sourceId, { externalId: link || index, url: link, title, content }, sourceUrl)
    if (candidate) candidates.push(candidate)
  })
  if (candidates.length > 0) return candidates
  const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || sourceUrl
  const content = $('main').text().trim() || $('body').text().trim()
  const fallback = asCandidate(sourceId, { externalId: sourceUrl, url: sourceUrl, title, content }, sourceUrl)
  return fallback ? [fallback] : []
}

async function fetchText(fetchFn: FetchLike, url: string): Promise<{ text: string; contentType: string }> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { text: await response.text(), contentType: response.headers.get('content-type')?.toLowerCase() || '' }
}

export async function collectSource(source: SourceConfig, fetchFn: FetchLike = fetch): Promise<Candidate[]> {
  const { text, contentType } = await fetchText(fetchFn, source.url)
  const isFeed = /xml|rss|atom/.test(contentType) || /<(rss|feed|rdf)/i.test(text.slice(0, 500))
  if (isFeed) return feedCandidates(source.id, text, source.url)
  if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) return jsonCandidates(source.id, JSON.parse(text) as unknown, source.url)
  const $ = load(text)
  const feedHref = $('link[rel="alternate"][type*="rss"],link[rel="alternate"][type*="atom"]').first().attr('href')
  if (feedHref) {
    const feed = await fetchText(fetchFn, canonicalUrl(feedHref, source.url))
    return feedCandidates(source.id, feed.text, source.url)
  }
  return htmlCandidates(source.id, text, source.url)
}

export async function collectSources(sources: SourceConfig[], fetchFn: FetchLike = fetch): Promise<CollectionResult> {
  const candidates: Candidate[] = []
  const errors: CollectionResult['errors'] = []
  for (const source of sources) {
    try {
      candidates.push(...await collectSource(source, fetchFn))
    } catch (error) {
      errors.push({ sourceId: source.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { candidates, errors }
}
