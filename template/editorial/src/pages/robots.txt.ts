import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL('https://example.invalid')
  const base = import.meta.env.BASE_URL
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${base}sitemap-index.xml`, origin).href}\n`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
