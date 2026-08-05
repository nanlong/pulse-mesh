import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'
import { siteConfig } from '../data/site-config'

const DAY_MS = 24 * 60 * 60 * 1000

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character)
}

export const GET: APIRoute = async ({ site }) => {
  const now = Date.now()
  const origin = site ?? new URL('https://example.invalid')
  const base = import.meta.env.BASE_URL
  const entries = (await getCollection('articles'))
    .filter((entry) => now - entry.data.publishedAt.valueOf() <= 2 * DAY_MS)
    .sort((left, right) => right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf())
  const urls = entries.map((entry) => `  <url>
    <loc>${escapeXml(new URL(`${base}${entry.id}/`, origin).href)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(siteConfig.publisherName)}</news:name>
        <news:language>${escapeXml(entry.data.language.toLowerCase())}</news:language>
      </news:publication>
      <news:publication_date>${entry.data.publishedAt.toISOString()}</news:publication_date>
      <news:title>${escapeXml(entry.data.title)}</news:title>
    </news:news>
  </url>`).join('\n')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>\n`
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
