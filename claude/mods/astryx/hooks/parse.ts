// Pure helpers, kept apart from the hooks so tests can reach them.

import type { SnapshotChange, SnapshotDiff, TrackerItem } from '../types'

/** APP_VERSION: '1.16.4' in src/js/config.js */
export const parseAppVersion = (text: string): string | null =>
  /APP_VERSION:\s*'([^']+)'/.exec(text)?.[1] ?? null

/** The first `version = "..."` in Cargo.toml, which sits under [package] */
export const parseCargoVersion = (text: string): string | null =>
  /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null

/** The full suite only: `just test` or `just check`, not `just test-js` */
export const isFullTestCommand = (command: string): boolean =>
  /^\s*just\s+(test|check)\s*$/.test(command)

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

/** 1.16.4 + patch -> 1.16.5; + minor -> 1.17.0; null if not x.y.z */
export const nextVersion = (version: string, kind: BumpKind): string | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (m === null) return null
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return kind === 'patch' ? `${major}.${minor}.${patch + 1}` : `${major}.${minor + 1}.0`
}

export const setAppVersion = (text: string, version: string): string =>
  text.replace(/(APP_VERSION:\s*')[^']+(')/, `$1${version}$2`)

export const setCargoVersion = (text: string, version: string): string =>
  text.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)

/** The package's own `name = "..."` in Cargo.toml */
export const parseCargoName = (text: string): string | null =>
  /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null

/** The version line right under the package's [[package]] entry in Cargo.lock */
export const setLockVersion = (text: string, name: string, version: string): string =>
  text.replace(
    new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`),
    `$1${version}$2`,
  )

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

/** The directory each guarded push in the line runs in: its `git -C <dir>`,
 *  else the last `cd <dir>` before it, else null (the shell's own directory).
 *  Lets the guard skip pushes to other repos, such as astryx-home. */
export const pushDirs = (command: string): (string | null)[] => {
  const dirs: (string | null)[] = []
  let cd: string | null = null
  for (const segment of stripHeredocs(command).split(/&&|\|\||[;|\n]/)) {
    const cdTo = /^\s*cd\s+(?:--\s+)?(['"]?)([^'"\s]+)\1\s*$/.exec(segment)?.[2]
    if (cdTo !== undefined) cd = cdTo
    if (isGitPush(segment) && !isDeleteOnlyPush(segment)) {
      dirs.push(/\bgit\s+(?:-\S+\s+)*?-C\s+(['"]?)([^'"\s]+)\1/.exec(segment)?.[2] ?? cd)
    }
  }
  return dirs
}

/** `just update-snapshots`, or the env var it sets, wherever it sits */
export const isSnapshotUpdate = (command: string): boolean =>
  /(^|[^\w"'\-])just\s+update-snapshots(?![\w-])/.test(command) ||
  /(^|\s)UPDATE_SNAPSHOTS=1\s/.test(command)

const SHOWN_CHANGES = 5
const SHOWN_VALUE_CHARS = 40

const show = (value: unknown): string => {
  const text = value === undefined ? '(none)' : JSON.stringify(value)
  return text.length > SHOWN_VALUE_CHARS ? `${text.slice(0, SHOWN_VALUE_CHARS)}...` : text
}

/** Every leaf of a JSON value by path: targets[0].subs -> 44 */
export const flatten = (value: unknown, path = '', out = new Map<string, unknown>()) => {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(path, value)
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out))
  } else if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) out.set(path, value)
    for (const [k, v] of entries) flatten(v, path === '' ? k : `${path}.${k}`, out)
  } else {
    out.set(path, value)
  }
  return out
}

/** Snapshot-by-snapshot differences between two versions of one file */
export const diffSnapshotFile = (file: string, beforeText: string, afterText: string): SnapshotDiff[] => {
  const parse = (text: string): Record<string, unknown> => {
    try {
      return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
    } catch {
      return {}
    }
  }
  const before = parse(beforeText)
  const after = parse(afterText)
  const diffs: SnapshotDiff[] = []
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(name in before)) {
      diffs.push({ file, name, kind: 'added', changes: [], total: 0 })
      continue
    }
    if (!(name in after)) {
      diffs.push({ file, name, kind: 'removed', changes: [], total: 0 })
      continue
    }
    const a = flatten(before[name])
    const b = flatten(after[name])
    const changes: SnapshotChange[] = []
    for (const path of new Set([...a.keys(), ...b.keys()])) {
      if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path)))
        changes.push({ path: path || '(whole value)', before: show(a.get(path)), after: show(b.get(path)) })
    }
    if (changes.length > 0)
      diffs.push({ file, name, kind: 'changed', changes: changes.slice(0, SHOWN_CHANGES), total: changes.length })
  }
  return diffs
}

/** Number of named snapshots in a file's text */
export const countSnapshots = (text: string): number => {
  try {
    return Object.keys(JSON.parse(text) as object).length
  } catch {
    return 0
  }
}

// /ship: where to ship, and an optional bump on the way
export type ShipTarget = 'web' | 'desktop' | 'both'
export type ShipArgs = { target: ShipTarget; bump: BumpKind | null }

const isShipTarget = (text: string | undefined): text is ShipTarget =>
  text === 'web' || text === 'desktop' || text === 'both'

/** "web", "desktop patch", "both minor"; null for anything else */
export const parseShipArgs = (args: string): ShipArgs | null => {
  const [target, bump, ...rest] = args.trim().split(/\s+/)
  if (!isShipTarget(target) || rest.length > 0) return null
  if (bump === undefined) return { target, bump: null }
  return isBumpKind(bump) ? { target, bump } : null
}

/** The release tag CI builds from: tauri-action names the release v + Cargo's version */
export const releaseTag = (version: string): string => `v${version}`

/** The version tag a push command sends (v1.16.5, v1.7.0-beta.1), or null */
export const pushedTag = (command: string): string | null =>
  /(?:^|[\s:/])(v\d+\.\d+\.\d+(?:-[\w.]+)?)(?=\s|$)/.exec(command)?.[1] ?? null

/** Stan's go-ahead after /ship's checks */
export const isShipIt = (text: string): boolean => /^\s*ship it[.!]?\s*$/i.test(text)

/** The last n non-empty lines of a command's output */
export const lastLines = (text: string, n: number): string[] =>
  text.split('\n').filter(line => line.trim() !== '').slice(-n)

// Rule linter: CLAUDE.md's coding rules, checked on the lines an edit added
const isAppJs = (path: string) => path.startsWith('src/js/') && path.endsWith('.js')
const isAppMarkup = (path: string) =>
  path.startsWith('src/') &&
  !path.startsWith('src/include/') &&
  !path.startsWith('src/help/') &&
  (path.endsWith('.js') || path.endsWith('.html'))
const isRust = (path: string) => path.startsWith('src-tauri/src/') && path.endsWith('.rs')

const LINT_RULES: { applies: (path: string) => boolean; pattern: RegExp; message: string }[] = [
  {
    applies: isAppJs,
    pattern: /\|\|\s*(['"`]|-?\d|\[|\{|null\b|undefined\b|true\b|false\b)/,
    message: 'use ?? for a default, not ||',
  },
  { applies: isAppJs, pattern: /\bconsole\.log\(/, message: 'console.log: use Log.debug' },
  { applies: isAppMarkup, pattern: /\sstyle\s*=\s*["']/, message: "inline style: put it in the module's CSS file" },
  {
    applies: isAppMarkup,
    pattern: /\.style\.\w+\s*=\s*(['"])[^'"]*\1/,
    message: 'style set to a fixed value: use a CSS class',
  },
  { applies: isAppMarkup, pattern: /<select[\s>]/, message: 'native <select>: use an .astryx-dropdown' },
  { applies: isRust, pattern: /\.unwrap\(\)/, message: '.unwrap(): propagate with .map_err(|e| e.to_string())?' },
  { applies: isRust, pattern: /\bprintln!/, message: 'println!: use log::' },
]

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)

/** The rules one line of a repo file breaks; Rust test code may unwrap and print */
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

// Tutorial selector check: steps target elements by CSS selector
export type TutorialTarget = { tutorial: string; step: number; stepId: string; selector: string }

/** Every step target in one tutorial file, numbered from 1 in step order */
export const parseTutorialTargets = (text: string): TutorialTarget[] => {
  let tutorial = '?'
  let stepId = '?'
  let step = 0
  const targets: TutorialTarget[] = []
  for (const line of text.split('\n')) {
    const top = /^ {4}id:\s*'([^']+)'/.exec(line)
    if (top !== null) tutorial = top[1] ?? '?'
    const own = /^\s{8,}id:\s*'([^']+)'/.exec(line)
    if (own !== null) stepId = own[1] ?? '?'
    const target = /^\s*target:\s*(?:'([^']*)'|null)/.exec(line)
    if (target === null) continue
    step++
    if (target[1] !== undefined) targets.push({ tutorial, step, stepId, selector: target[1] })
  }
  return targets
}

/** The IDs, classes and attribute values a selector needs to exist */
export const selectorNames = (selector: string): string[] => [
  ...[...selector.matchAll(/#([\w-]+)/g)].map(m => m[1] ?? ''),
  ...[...selector.replace(/"[^"]*"/g, '""').matchAll(/\.([\w-]+)/g)].map(m => m[1] ?? ''),
  ...[...selector.matchAll(/\[[\w-]+="([^"]+)"\]/g)].map(m => m[1] ?? ''),
].filter(Boolean)

/** A name as a whole word: theme-dropdown is not found in theme-dropdown-menu */
export const hasName = (text: string, name: string): boolean =>
  new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(text)

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

/** Due reminders (undated ones count), tests awaiting Stan, and reminders still ahead */
export const splitTracker = (items: TrackerItem[], today: string) => ({
  due: items.filter(i => i.kind === 'reminder' && (i.due ?? today) <= today),
  waiting: items.filter(i => i.kind === 'test'),
  later: items
    .filter(i => i.kind === 'reminder' && (i.due ?? today) > today)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')),
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
    `ASTRYX MODS (${features.length})`,
    ...features.flatMap(f => wrapHanging(`  ${f.name.padEnd(nameWidth)}  ${f.does} [${f.runs}]`, width, nameWidth + 2)),
  ].join('\n')
}
