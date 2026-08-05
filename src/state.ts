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
  sourceCheckpoints: Record<string, string>
  lastRunAt?: string
}

export function pruneDecisionState(state: DecisionState, maxRecords: number): void {
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error('maxRecords must be a positive integer')
  const timestamp = (record: DecisionRecord): number => {
    const parsed = Date.parse(record.updatedAt)
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  const entries = Object.entries(state.decisions).sort(([leftKey, left], [rightKey, right]) => {
    const difference = timestamp(right) - timestamp(left)
    return difference !== 0 ? difference : rightKey.localeCompare(leftKey)
  })
  state.decisions = Object.fromEntries(entries.slice(0, maxRecords))
}

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function makeDecisionKey(sourceId: string, externalId: string, contentHash: string, configHash: string): string {
  return hashValue([sourceId, externalId, contentHash, configHash].join('\n'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadState(filePath: string): Promise<DecisionState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.decisions)) throw new Error('invalid decisions state')
    if (parsed.lastRunAt !== undefined && (typeof parsed.lastRunAt !== 'string' || !Number.isFinite(Date.parse(parsed.lastRunAt)))) throw new Error('invalid decisions state')
    if (parsed.sourceCheckpoints !== undefined && !isRecord(parsed.sourceCheckpoints)) throw new Error('invalid decisions state')
    const sourceCheckpoints = parsed.sourceCheckpoints ?? {}
    if (Object.entries(sourceCheckpoints).some(([sourceUrl, checkpoint]) => !sourceUrl || typeof checkpoint !== 'string' || !Number.isFinite(Date.parse(checkpoint)))) throw new Error('invalid decisions state')
    return { version: 1, decisions: parsed.decisions as Record<string, DecisionRecord>, sourceCheckpoints: sourceCheckpoints as Record<string, string>, ...(parsed.lastRunAt ? { lastRunAt: parsed.lastRunAt } : {}) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, decisions: {}, sourceCheckpoints: {} }
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
