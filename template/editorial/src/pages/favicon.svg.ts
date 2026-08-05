import type { APIRoute } from 'astro'
import { siteConfig } from '../data/site-config'

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character)
}

export const GET: APIRoute = () => {
  const mark = escapeXml(siteConfig.name.slice(0, 1).toUpperCase())
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${siteConfig.primaryColor}"/><text x="32" y="43" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="800" fill="white">${mark}</text></svg>`
  return new Response(body, { headers: { 'Content-Type': 'image/svg+xml' } })
}
