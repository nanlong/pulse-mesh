const GITHUB_API_VERSION = '2026-03-10'

async function dispatch(env) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'pulse-mesh-scheduler',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      event_type: env.GITHUB_EVENT_TYPE,
    }),
  })

  if (!response.ok) throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`)
}

export default {
  async scheduled(_controller, env) {
    await dispatch(env)
  },
}
