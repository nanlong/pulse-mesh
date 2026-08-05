import { defineConfig } from 'astro/config'

const repository = process.env.GITHUB_REPOSITORY?.split('/')
const repositoryName = repository?.[1]
const owner = repository?.[0]

export default defineConfig({
  output: 'static',
  site: process.env.SITE_BASE_URL || (owner ? `https://${owner}.github.io` : undefined),
  base: process.env.SITE_BASE_PATH || (repositoryName && !repositoryName.endsWith('.github.io') ? `/${repositoryName}` : undefined),
})
