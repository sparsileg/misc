// Pure helpers, kept apart from the hooks so tests can reach them.

import type { TrackerItem } from '../types'

/** The first `"version": "..."` in a JSON file (package.json, tauri.conf.json) */
export const parseJsonVersion = (text: string): string | null =>
  /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null

export const setJsonVersion = (text: string, version: string): string =>
  text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`)

/** package-lock.json holds the app's version twice: at the top and under packages[""] */
export const setPackageLockVersion = (text: string, name: string, version: string): string =>
  text.replace(new RegExp(`("name"\\s*:\\s*"${name}",\\s*"version"\\s*:\\s*")[^"]+(")`, 'g'), `$1${version}$2`)

/** The first `version = "..."` in Cargo.toml, which sits under [workspace.package] */
export const parseCargoVersion = (text: string): string | null =>
  /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null

export const setCargoVersion = (text: string, version: string): string =>
  text.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)

/** The version line right under a package's [[package]] entry in Cargo.lock */
export const setLockVersion = (text: string, name: string, version: string): string =>
  text.replace(
    new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`),
    `$1${version}$2`,
  )

/** The version src/lib/version.test.ts pins: `it("is 0.12.0"` and `toBe("0.12.0")` */
export const parseVersionTest = (text: string): string | null =>
  /toBe\("([^"]+)"\)/.exec(text)?.[1] ?? null

export const setVersionTest = (text: string, version: string): string =>
  text.replace(/(it\("is )[^"]+(")/, `$1${version}$2`).replace(/(toBe\(")[^"]+("\))/, `$1${version}$2`)

/** The versions found, file by file; they agree when every file has the same one */
export const versionsAgree = (versions: (string | null)[]): string | null => {
  const [first] = versions
  return first !== undefined && first !== null && versions.every(v => v === first) ? first : null
}

/** The full check only: `just check`, not `just test-rust`; a 2>&1 is allowed */
export const isFullTestCommand = (command: string): boolean =>
  /^\s*just\s+check\s*(2>&1\s*)?$/.test(command)

/** The large-book timings: `just perf` */
export const isPerfCommand = (command: string): boolean =>
  /^\s*just\s+perf\s*(2>&1\s*)?$/.test(command)

/** `git ls-files -s` lines -> path -> blob hash */
export const parseStagedHashes = (text: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const hash = line.slice(0, tab).split(' ')[1]
    if (hash !== undefined) map.set(line.slice(tab + 1), hash)
  }
  return map
}

/** Order-independent text of path -> hash, ready to digest */
export const fingerprintText = (hashes: Map<string, string>): string =>
  [...hashes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, hash]) => `${hash} ${path}`)
    .join('\n')

export const clockTime = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type BumpKind = 'patch' | 'minor'

export const isBumpKind = (text: string): text is BumpKind =>
  text === 'patch' || text === 'minor'

/** 0.10.0 + patch -> 0.10.1; + minor -> 0.11.0; null if not x.y.z */
export const nextVersion = (version: string, kind: BumpKind): string | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (m === null) return null
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return kind === 'patch' ? `${major}.${minor}.${patch + 1}` : `${major}.${minor + 1}.0`
}

/** Any `git ... push` in a command line, whatever comes before it
 *  (&&, ;, timeout, an env var), but not quoted as text */
export const isGitPush = (command: string): boolean =>
  /(^|[^\w"'\-])git\s+(-[Cc]\s+\S+\s+|-\S+\s+)*push(?![\w-])/.test(command)

/** A command line without its heredoc bodies, which are text, not commands */
const stripHeredocs = (command: string): string => {
  const out: string[] = []
  let end: string | null = null
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    out.push(line)
    end = /<<-?\s*['"]?(\w+)['"]?/.exec(line)?.[1] ?? null
  }
  return out.join('\n')
}

/** A push that only deletes remote refs (--delete, -d, :ref) ships nothing */
const isDeleteOnlyPush = (segment: string): boolean => {
  const words = segment.replace(/^[\s\S]*?\bpush\b/, '').trim().split(/\s+/).filter(Boolean)
  if (words.includes('--delete') || words.includes('-d')) return true
  const refspecs = words.filter(w => !w.startsWith('-')).slice(1)
  return refspecs.length > 0 && refspecs.every(r => r.startsWith(':'))
}

/** A push the guard must hold: any push in the line that sends commits or tags */
export const isGuardedPush = (command: string): boolean =>
  stripHeredocs(command)
    .split(/&&|\|\||[;|\n]/)
    .some(segment => isGitPush(segment) && !isDeleteOnlyPush(segment))

/**
 * Whether a push needs passing just perf and just check: it sends a tag, or
 * its commits touch tested code. `outgoing` is the files the unpushed commits
 * change, or null when git could not tell (no upstream): then tests are needed.
 */
export const pushNeedsTests = (outgoing: string[] | null, testedPaths: string[], tag: string | null): boolean =>
  tag !== null ||
  outgoing === null ||
  outgoing.some(file => testedPaths.some(path => file === path || file.startsWith(`${path}/`)))

/** /ship's arguments: nothing, or the bump to make first; null for anything else */
export const parseShipArgs = (args: string): { bump: BumpKind | null } | null => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { bump: null }
  const [bump] = words
  return words.length === 1 && bump !== undefined && isBumpKind(bump) ? { bump } : null
}

/** The release tag CI builds from: tauri-action names the release v + the version */
export const releaseTag = (version: string): string => `v${version}`

/** The version tag a push command sends (v0.10.1, v0.11.0-beta.1), or null */
export const pushedTag = (command: string): string | null =>
  /(?:^|[\s:/])(v\d+\.\d+\.\d+(?:-[\w.]+)?)(?=\s|$)/.exec(command)?.[1] ?? null

/** Stan's go-ahead after /ship's checks */
export const isShipIt = (text: string): boolean => /^\s*ship it[.!]?\s*$/i.test(text)

/** The last n non-empty lines of a command's output */
export const lastLines = (text: string, n: number): string[] =>
  text.split('\n').filter(line => line.trim() !== '').slice(-n)

// Rule linter: CLAUDE.md's hard rules, checked on the lines an edit added
const isRust = (path: string) => /^(crates\/[^/]+\/src|src-tauri\/src)\/.*\.rs$/.test(path)
const isCore = (path: string) => path.startsWith('crates/kansha-core/src/')
const isPersistence = (path: string) => path.startsWith('crates/kansha-core/src/persistence/')
// Where SystemClock reads the real time
const CLOCK_FILE = 'crates/kansha-core/src/date.rs'
const isFront = (path: string) => /^src\/.*\.(ts|svelte)$/.test(path) && !/\.test\.ts$/.test(path)

/** A schema file: once committed it is released and never edited */
export const isMigration = (path: string): boolean =>
  /^crates\/kansha-core\/src\/persistence\/migrations\/[^/]+\.sql$/.test(path)

const LINT_RULES: { applies: (path: string) => boolean; pattern: RegExp; message: string }[] = [
  { applies: isRust, pattern: /\.unwrap\(\)/, message: '.unwrap() outside tests: return an error' },
  { applies: isRust, pattern: /\.expect\(/, message: '.expect() outside tests: only for a documented invariant' },
  { applies: isRust, pattern: /\bunsafe\s*(\{|fn\b|impl\b)/, message: 'unsafe: not allowed' },
  { applies: isRust, pattern: /\bf(32|64)\b/, message: 'float: money is i64 cents; qty/price/rate i64 x1e6' },
  { applies: isRust, pattern: /\bdbg!/, message: 'dbg!: remove it' },
  {
    applies: p => isRust(p) && !isPersistence(p),
    pattern: /\.(execute|execute_batch|prepare|prepare_cached|query_row|query_map)\(/,
    message: 'SQL outside persistence: only persistence issues SQL',
  },
  {
    applies: p => isCore(p) && p !== CLOCK_FILE,
    pattern: /\b(Local::now|Utc::now|SystemTime::now|now_utc|now_local)\b/,
    message: 'the real time: "today" comes from the injected Clock',
  },
  { applies: isFront, pattern: /\bnew Date\(/, message: 'JS Date: financial dates are ISO strings from Rust' },
  { applies: isFront, pattern: /\bconsole\.log\(/, message: 'console.log: remove it' },
]

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|<!--)/.test(line)

/** The rules one line of a repo file breaks; Rust test code may unwrap */
export const lintLine = (path: string, line: string, isTestCode = false): string[] =>
  isComment(line) || (isRust(path) && isTestCode)
    ? []
    : LINT_RULES.filter(r => r.applies(path) && r.pattern.test(line)).map(r => r.message)

/** Line numbers (1-based) of `after` whose text was not in `before`: what an edit added */
export const addedLines = (before: string, after: string): number[] => {
  const old = new Set(before.split('\n'))
  return after
    .split('\n')
    .flatMap((line, i) => (old.has(line) || line.trim() === '' ? [] : [i + 1]))
}

/** The first line of a Rust file's #[cfg(test)] module, or Infinity when there is none */
export const rustTestStart = (text: string): number => {
  const i = text.split('\n').findIndex(line => line.trim() === '#[cfg(test)]')
  return i === -1 ? Infinity : i + 1
}

// Tracker: things awaiting Stan's test, and dated reminders
/** The tracker file's items; anything unreadable reads as none */
export const parseTracker = (text: string): TrackerItem[] => {
  try {
    const items = (JSON.parse(text) as { items?: unknown }).items
    return Array.isArray(items)
      ? (items as TrackerItem[]).filter(i => typeof i?.id === 'string' && typeof i?.text === 'string')
      : []
  } catch {
    return []
  }
}

/** A local calendar date, YYYY-MM-DD, n days after the instant ms */
export const localDate = (ms: number, days = 0): string => {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Due reminders (undated ones count), tests awaiting Stan, reminders still ahead, and items to decide */
export const splitTracker = (items: TrackerItem[], today: string) => ({
  due: items.filter(i => i.kind === 'reminder' && (i.due ?? today) <= today),
  waiting: items.filter(i => i.kind === 'test'),
  later: items
    .filter(i => i.kind === 'reminder' && (i.due ?? today) > today)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')),
  decide: items.filter(i => i.kind === 'decide'),
})

/** An issue on the GitHub project board, in its Status column */
export type BoardIssue = { number: number; title: string; labels: string[]; status: string }

/** gh project item-list --format json; null when it can't be read */
export const parseBoard = (json: string): BoardIssue[] | null => {
  try {
    const items = (JSON.parse(json) as { items?: unknown }).items
    if (!Array.isArray(items)) return null
    return (items as { content?: { number?: number }; title?: string; labels?: string[]; status?: string }[])
      .filter(i => typeof i.content?.number === 'number')
      .map(i => ({ number: i.content?.number ?? 0, title: i.title ?? '', labels: i.labels ?? [], status: i.status ?? '' }))
  } catch {
    return null
  }
}

/** A line word-wrapped to width, continuation lines indented past the line's own indent */
export const wrapHanging = (line: string, width: number, extra: number): string[] => {
  const indent = ' '.repeat((line.match(/^ */)?.[0].length ?? 0) + extra)
  const lines: string[] = []
  let current = ''
  for (const word of line.trimStart().split(' ')) {
    const start = lines.length === 0 ? line.slice(0, line.length - line.trimStart().length) : indent
    if (current === '') current = start + word
    else if (current.length + 1 + word.length <= width) current += ` ${word}`
    else {
      lines.push(current)
      current = indent + word
    }
  }
  return [...lines, current]
}

/** What's open, as text wrapped to width: tracker sections, then the board's listed
 *  columns in order, then a count for each other column (Done aside) */
export const openItemsText = (
  tracker: ReturnType<typeof splitTracker>,
  board: BoardIssue[] | null,
  columns: string[],
  done: string,
  width: number,
): string => {
  const section = (title: string, lines: string[]) =>
    lines.length === 0 ? [] : [`${title} (${lines.length})`, ...lines.map(l => `  ${l}`), '']
  const issue = (i: BoardIssue) => `#${i.number} ${i.title}${i.labels.length > 0 ? `  [${i.labels.join(', ')}]` : ''}`
  const others = new Map<string, number>()
  for (const i of board ?? [])
    if (!columns.includes(i.status) && i.status !== done) others.set(i.status, (others.get(i.status) ?? 0) + 1)
  return [
    ...section('[!] DUE', tracker.due.map(i => `${i.due ?? 'undated'}  ${i.label}: ${i.text}`)),
    ...section('AWAITING YOUR TEST', tracker.waiting.map(i => `${i.label}: ${i.text}`)),
    ...section('LATER', tracker.later.map(i => `${i.due}  ${i.label}: ${i.text}`)),
    ...(board === null
      ? ['GITHUB ISSUES: could not read the project board (gh project item-list failed)']
      : [
          ...columns.flatMap(c =>
            section(`ISSUES: ${c.toUpperCase()}`, board.filter(i => i.status === c).sort((a, b) => b.number - a.number).map(issue)),
          ),
          ...(others.size > 0
            ? [`Not listed: ${[...others].map(([status, n]) => `${status || 'no column'} (${n})`).join(', ')}`]
            : []),
        ]),
  ]
    .flatMap(line => wrapHanging(line, width, 2))
    .join('\n')
    .trimEnd()
}

/** One feature of the mod, as /list-mods shows it */
export interface ModFeature {
  name: string
  does: string
  runs: string
}

/** The mod's features as text wrapped to width, descriptions aligned past the longest name */
export const listModsText = (features: ModFeature[], width: number): string => {
  const nameWidth = Math.max(...features.map(f => f.name.length))
  return [
    `KANSHA MODS (${features.length})`,
    ...features.flatMap(f => wrapHanging(`  ${f.name.padEnd(nameWidth)}  ${f.does} [${f.runs}]`, width, nameWidth + 2)),
  ].join('\n')
}
