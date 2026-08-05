import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type DecisionStatus = 'rejected' | 'generated' | 'published' | 'failed'

export type DecisionRecord = {
  decisionKey: string
  status: DecisionStatus
  reason?: string
  score?: number
  configHash: string
  updatedAt: string
  bCommitSha?: string
}

export type DecisionState = {
  version: 1
  decisions: Record<string, DecisionRecord>
}

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function makeDecisionKey(sourceId: string, externalId: string, contentHash: string, configHash: string): string {
  return hashValue([sourceId, externalId, contentHash, configHash].join('\n'))
}

export async function loadState(filePath: string): Promise<DecisionState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<DecisionState>
    if (parsed.version !== 1 || !parsed.decisions || typeof parsed.decisions !== 'object') throw new Error('invalid decisions state')
    return { version: 1, decisions: parsed.decisions as Record<string, DecisionRecord> }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, decisions: {} }
    throw error
  }
}

export async function saveState(filePath: string, state: DecisionState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export async function readPublishedDecisionKeys(rootDir: string): Promise<Set<string>> {
  const keys = new Set<string>()
  async function visit(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const text = await readFile(entryPath, 'utf8')
      const rawDecisionKey = text.match(/^decisionKey:\s*(.+?)\s*$/m)?.[1]
      if (rawDecisionKey) {
        let decisionKey = rawDecisionKey
        if (rawDecisionKey.startsWith('"')) {
          try {
            const parsed = JSON.parse(rawDecisionKey) as unknown
            if (typeof parsed !== 'string') continue
            decisionKey = parsed
          } catch {
            continue
          }
        }
        if (decisionKey) keys.add(decisionKey)
      }
    }
  }
  await visit(path.join(rootDir, 'src/content/articles'))
  return keys
}
