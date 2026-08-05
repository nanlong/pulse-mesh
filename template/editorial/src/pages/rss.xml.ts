import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'
import { siteConfig } from '../data/site-config'

export const GET: APIRoute = async (context) => {
  const entries = (await getCollection('articles')).sort((left, right) => right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf())
  const base = import.meta.env.BASE_URL
  return rss({
    title: siteConfig.name,
    description: siteConfig.description,
    site: context.site ?? new URL('https://example.invalid'),
    customData: `<language>${siteConfig.locale}</language>`,
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.publishedAt,
      link: `${base}${entry.id}/`,
      categories: entry.data.topics,
    })),
  })
}
