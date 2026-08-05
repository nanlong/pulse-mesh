import type { CollectionEntry } from 'astro:content'

export function topicSlug(topic: string): string {
  return topic.toLowerCase().normalize('NFKC').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '') || 'topic'
}

export function articleHref(id: string, base: string): string {
  return `${base}${id}/`
}

export function topicHref(topic: string, base: string): string {
  return `${base}topics/${topicSlug(topic)}/`
}

export function relatedArticles(entry: CollectionEntry<'articles'>, entries: CollectionEntry<'articles'>[], limit = 3): CollectionEntry<'articles'>[] {
  const topics = new Set(entry.data.topics.map((topic) => topic.toLowerCase()))
  return entries
    .filter((candidate) => candidate.id !== entry.id && candidate.data.language === entry.data.language)
    .map((candidate) => ({
      candidate,
      matches: candidate.data.topics.filter((topic) => topics.has(topic.toLowerCase())).length,
    }))
    .filter(({ matches }) => matches > 0)
    .sort((left, right) => right.matches - left.matches || right.candidate.data.publishedAt.valueOf() - left.candidate.data.publishedAt.valueOf())
    .slice(0, limit)
    .map(({ candidate }) => candidate)
}
