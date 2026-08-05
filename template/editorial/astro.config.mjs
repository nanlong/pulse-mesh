import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

const repository = process.env.GITHUB_REPOSITORY?.split('/')
const repositoryName = repository?.[1]
const owner = repository?.[0]
const site = process.env.SITE_BASE_URL || (owner ? `https://${owner}.github.io` : 'https://example.invalid')
const base = process.env.SITE_BASE_PATH || (repositoryName && !repositoryName.endsWith('.github.io') ? `/${repositoryName}` : '/')
const basePath = `${base.replace(/^\/?/, '/').replace(/\/?$/, '/')}`

export default defineConfig({
  output: 'static',
  site,
  base,
  integrations: [sitemap({ customSitemaps: [new URL(`${basePath}news-sitemap.xml`, site).href] })],
})
