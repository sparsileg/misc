import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LintFinding, PushState, ReleaseWatch, RepoStatus, ShipStep, SnapshotDiff, TestsState, TrackerItem, TutorialFinding } from '../types'
import type { ModFeature, ShipArgs } from './parse'
import {
  addedLines,
  clockTime,
  countSnapshots,
  diffSnapshotFile,
  fingerprintText,
  hasName,
  isBumpKind,
  isFullTestCommand,
  isGuardedPush,
  pushDirs,
  isShipIt,
  isSnapshotUpdate,
  lastLines,
  lintLine,
  listModsText,
  localDate,
  nextVersion,
  openItemsText,
  parseAppVersion,
  parseCargoName,
  parseCargoVersion,
  parseBoard,
  parseShipArgs,
  parseStagedHashes,
  parseTracker,
  parseTutorialTargets,
  pushedTag,
  releaseTag,
  rustTestStart,
  selectorNames,
  splitTracker,
  setAppVersion,
  setCargoVersion,
  setLockVersion,
} from './parse'

const PANE = 'astryx'
const TITLE = 'Astryx'
const REFRESH_MS = 15_000
// Code whose change means the suite has to run again
const TESTED_PATHS = ['src/js', 'src-tauri/src', 'tests']
const STORE_FINGERPRINT = 'testedFingerprint'
const STORE_TESTED_AT = 'testedAt'
const CONFIG_JS = 'src/js/config.js'
const CARGO_TOML = 'src-tauri/Cargo.toml'
const CARGO_LOCK = 'src-tauri/Cargo.lock'
// A push of this branch deploys the web app
const DEPLOY_BRANCH = 'main'
const PUSH_APPROVAL_MS = 5 * 60_000
const SNAPSHOT_DIR = 'tests/snapshots'
// The files as they were before an update, kept across sessions until reviewed
const STORE_SNAPSHOT_BACKUP = 'snapshotBackup'
// just test compiles and runs the Rust tests too; ten minutes is process.run's limit
const SHIP_TEST_TIMEOUT_MS = 10 * 60_000
// Output lines shown under a failed /ship step
const SHIP_FAILURE_LINES = 15
// How long to wait for GitHub (release tag check, project board)
const TAG_CHECK_TIMEOUT_MS = 15_000
// The GitHub Actions workflow a pushed v* tag starts: deb + exe into a draft release
const RELEASE_WORKFLOW = 'release.yml'
// The GitHub project /open-items reads, and the columns it lists (Stan: ignore Deferred for now)
const PROJECT_OWNER = 'sparsileg'
const PROJECT_NUMBER = '4'
const PROJECT_COLUMNS = ['In progress', 'To Do']
const PROJECT_DONE = 'Done'
// Above the board's item count, Done included
const PROJECT_ITEM_LIMIT = 1000
// Cells a docked pane takes beyond its body (frame and gap), and the transcript's own
// margin around command output, so wrapped lines never reach the edge
const DOCK_FRAME_COLUMNS = 4
const OUTPUT_MARGIN_COLUMNS = 4
// Narrower than this, wrapping would leave a word or two per line
const MIN_WRAP_COLUMNS = 40
// The release being built, kept across sessions until Stan dismisses it
const STORE_RELEASE = 'release'
const TUTORIAL_DIR = 'src/js/tutorials/'
// App code a tutorial target can live in; built help pages and vendored libraries can't
const APP_SOURCE = /^src\/(?!include\/|help\/|js\/tutorials\/).*\.(js|html)$/

// What /list-mods shows; a new feature adds its row here
const FEATURES: ModFeature[] = [
  { name: 'Pane status', does: 'Version sync (config.js vs Cargo.toml), branch, uncommitted and unpushed changes, test status', runs: 'automatic; /astryx opens the pane' },
  { name: '/bump', does: 'Bumps the version in config.js, Cargo.toml and Cargo.lock together', runs: '/bump patch|minor' },
  { name: 'Push guard', does: 'Refuses a push to main with mismatched versions, stale tests or a dirty tree; holds a good one for approval', runs: 'automatic; Approve push or /push-ok' },
  { name: 'Snapshot guard', does: 'Backs up snapshots before just update-snapshots, then Keep/Revert review; pushes wait for it', runs: 'automatic' },
  { name: '/ship', does: 'Checks and tests, then ships: web pushes main, desktop pushes a release tag and watches CI', runs: '/ship web|desktop|both [patch|minor], then "ship it"' },
  { name: 'Rule linter', does: 'Flags rule breaks in lines an edit adds (|| defaults, console.log, inline styles, <select>, unwrap/println!)', runs: 'automatic' },
  { name: 'Tutorial check', does: 'Flags tutorial targets an edit removes from the app, or new targets missing from src/', runs: 'automatic' },
  { name: 'Test tracker', does: 'Changes awaiting your test and dated reminders, with a briefing at session start', runs: 'automatic; pane buttons' },
  { name: '/open-items', does: 'Due reminders, tests awaiting you, In progress and To Do issues', runs: '/open-items' },
  { name: '/list-mods', does: 'This list', runs: '/list-mods' },
]

const status = atom({ plugin: 'astryx', key: 'status' } as const, null)
const push = atom({ plugin: 'astryx', key: 'push' } as const, {
  waiting: null,
  approved: null,
} as PushState)
const snapshots = atom({ plugin: 'astryx', key: 'snapshots' } as const, null)
const ship = atom({ plugin: 'astryx', key: 'ship' } as const, null)
const release = atom({ plugin: 'astryx', key: 'release' } as const, null)
const lint = atom({ plugin: 'astryx', key: 'lint' } as const, [] as LintFinding[])
const tutorials = atom({ plugin: 'astryx', key: 'tutorials' } as const, [] as TutorialFinding[])
const tracker = atom({ plugin: 'astryx', key: 'tracker' } as const, [] as TrackerItem[])
// Set once the session's first prompt carried the tracker briefing
let isBriefed = false
// The pane's body width while docked beside the transcript, from its last render; null inline
let dockColumns: number | null = null

const git = async ($: EngineInterface, args: string[]): Promise<string> => {
  const run = await $.process.run(['git', ...args])
  return run.exitCode === 0 ? run.stdout : ''
}

// The top of the repo a directory sits in ('' outside one); null is the
// shell's own directory, and a leading ~ is the home folder
const repoOf = async ($: EngineInterface, dir: string | null): Promise<string> => {
  const script = 'd=${1:-.}; case $d in "~"*) d=$HOME${d#"~"};; esac; cd -- "$d" 2>/dev/null && git rev-parse --show-toplevel'
  const run = await $.process.run(['sh', '-c', script, 'sh', dir ?? ''])
  return run.exitCode === 0 ? run.stdout.trim() : ''
}

// Whether any push in the line goes out from the Astryx repo (the session's
// root); pushes from other repos, such as astryx-home, aren't guarded
const pushesAstryx = async ($: EngineInterface, command: string): Promise<boolean> => {
  const astryx = await repoOf($, await $.session.root())
  for (const dir of pushDirs(command)) if ((await repoOf($, dir)) === astryx) return true
  return false
}

// Content hash of the tested paths as they stand on disk: unchanged by a
// commit, changed by any edit, add or delete, whoever made it.
const fingerprint = async ($: EngineInterface): Promise<string> => {
  const hashes = parseStagedHashes(await git($, ['ls-files', '-s', '--', ...TESTED_PATHS]))
  const changed = (
    await git($, ['ls-files', '-m', '-o', '--exclude-standard', '--', ...TESTED_PATHS])
  )
    .split('\n')
    .filter(Boolean)
  const present: string[] = []
  for (const path of new Set(changed)) {
    if (await $.fs.exists(path)) present.push(path)
    else hashes.set(path, 'deleted')
  }
  if (present.length > 0) {
    const objects = (await git($, ['hash-object', '--', ...present])).split('\n')
    present.forEach((path, i) => hashes.set(path, objects[i] ?? 'unreadable'))
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fingerprintText(hashes)),
  )
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// The transcript is the terminal less a shown, docked pane; the terminal wraps
// without the indent, so command output is wrapped here first
const outputWidth = async ($: EngineInterface, columns: number): Promise<number> => {
  const isDocked = dockColumns !== null && (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
  return Math.max(MIN_WRAP_COLUMNS, columns - (isDocked ? (dockColumns ?? 0) + DOCK_FRAME_COLUMNS : 0) - OUTPUT_MARGIN_COLUMNS)
}

const readText = async ($: EngineInterface, path: string): Promise<string> =>
  (await $.fs.read(path).catch(() => '')) as string

// Rule linter: findings on the lines an edit added, kept until fixed
const repoPath = async ($: EngineInterface, path: string): Promise<string> => {
  const root = (await git($, ['rev-parse', '--show-toplevel'])).trim()
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

const findingsIn = (file: string, text: string, lines: number[]): LintFinding[] => {
  const all = text.split('\n')
  const testsFrom = file.endsWith('.rs') ? rustTestStart(text) : Infinity
  return lines.flatMap(n =>
    lintLine(file, all[n - 1] ?? '', n > testsFrom).map(message => ({
      file,
      line: n,
      text: (all[n - 1] ?? '').trim(),
      message,
    })),
  )
}

/** Check an edit; returns the note Claude reads, or null when it is clean */
const lintEdit = async ($: EngineInterface, path: string, before: string): Promise<string | null> => {
  const file = await repoPath($, path)
  const after = await readText($, path)
  const fresh = findingsIn(file, after, addedLines(before, after))
  // Earlier findings in this file stay while their line still breaks the rule
  await update($, lint, all => {
    const others = all.filter(f => f.file !== file)
    const still = all
      .filter(f => f.file === file)
      .flatMap(f => {
        const i = after.split('\n').findIndex(line => line.trim() === f.text)
        return i === -1 || fresh.some(n => n.line === i + 1) ? [] : findingsIn(file, after, [i + 1]).filter(n => n.message === f.message)
      })
    return [...others, ...still, ...fresh]
  })
  if (fresh.length === 0) return null
  return (
    `Astryx rule check (CLAUDE.md coding rules) on lines this edit added to ${file}:\n` +
    fresh.map(f => `  line ${f.line}: ${f.message}: ${f.text}`).join('\n') +
    '\nFix these unless the rule truly does not apply; Stan sees them in the Astryx pane.'
  )
}

/** Drop findings whose line was fixed or deleted since, by whoever */
const recheckLint = async ($: EngineInterface): Promise<void> => {
  const all = await read($, lint)
  if (all.length === 0) return
  const root = (await git($, ['rev-parse', '--show-toplevel'])).trim()
  const next: LintFinding[] = []
  for (const file of new Set(all.map(f => f.file))) {
    const text = await readText($, `${root}/${file}`)
    const lines = text.split('\n')
    for (const f of all.filter(x => x.file === file)) {
      const i = lines.findIndex(line => line.trim() === f.text)
      if (i !== -1) next.push(...findingsIn(file, text, [i + 1]).filter(n => n.message === f.message))
    }
  }
  if (next.length !== all.length || next.some((f, i) => f.line !== all[i]?.line))
    await update($, lint, () => next)
}

// Tutorial selector check: a step whose target's ID, class or attribute is gone from src/
const readTutorials = async ($: EngineInterface) => {
  const files = (await git($, ['ls-files', '-co', '--exclude-standard', TUTORIAL_DIR])).split('\n').filter(Boolean)
  const targets = []
  for (const file of files) targets.push(...parseTutorialTargets(await readText($, file)))
  return targets
}

const readAppSource = async ($: EngineInterface): Promise<string> => {
  const files = (await git($, ['ls-files', '-co', '--exclude-standard', 'src'])).split('\n')
  const texts = await Promise.all(files.filter(f => APP_SOURCE.test(f)).map(f => readText($, f)))
  return texts.join('\n')
}

const missingFor = (
  targets: ReturnType<typeof parseTutorialTargets>,
  names: Set<string>,
  source: string,
): TutorialFinding[] =>
  targets.flatMap(t =>
    selectorNames(t.selector)
      .filter(name => names.has(name) && !hasName(source, name))
      .map(name => ({ ...t, name })),
  )

/** Check an edit to src/; returns the note Claude reads, or null when no step broke */
const checkTutorials = async ($: EngineInterface, file: string, before: string): Promise<string | null> => {
  const isTutorial = file.startsWith(TUTORIAL_DIR)
  if (!isTutorial && !APP_SOURCE.test(file)) return null
  const after = await readText($, file)
  const targets = await readTutorials($)
  // An app edit can only break names it removed; a tutorial edit, targets it added
  const suspects = new Set(
    isTutorial
      ? parseTutorialTargets(after)
          .filter(t => !parseTutorialTargets(before).some(b => b.selector === t.selector))
          .flatMap(t => selectorNames(t.selector))
      : targets.flatMap(t => selectorNames(t.selector)).filter(n => hasName(before, n) && !hasName(after, n)),
  )
  const kept = await read($, tutorials)
  if (suspects.size === 0 && kept.length === 0) return null
  const source = await readAppSource($)
  const fresh = missingFor(isTutorial ? parseTutorialTargets(after) : targets, suspects, source)
  const still = missingFor(targets, new Set(kept.map(f => f.name)), source)
  const key = (f: TutorialFinding) => `${f.tutorial}:${f.step}:${f.name}`
  const all = [...new Map([...still, ...fresh].map(f => [key(f), f])).values()]
  await update($, tutorials, () => all)
  if (fresh.length === 0) return null
  return (
    `Astryx tutorial check: after this edit to ${file}, these tutorial steps target names found nowhere in src/:\n` +
    fresh.map(f => `  ${f.tutorial} step ${f.step} (${f.stepId}): ${f.selector} needs "${f.name}"`).join('\n') +
    `\nUpdate the tutorial (${TUTORIAL_DIR}) or restore the name, unless the name is built at runtime; Stan sees these in the Astryx pane.`
  )
}

// Tracker: a file outside the repo (never committed) that Claude edits and the pane's buttons change
const trackerPath = async ($: EngineInterface): Promise<string> => {
  const root = (await git($, ['rev-parse', '--show-toplevel'])).trim()
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/projects/${root.replace(/\//g, '-')}/astryx-tracker.json`
}

const readTracker = async ($: EngineInterface): Promise<TrackerItem[]> =>
  parseTracker(await readText($, await trackerPath($)))

const refreshTracker = async ($: EngineInterface): Promise<void> => {
  const items = await readTracker($)
  if (JSON.stringify(items) !== JSON.stringify(await read($, tracker))) await update($, tracker, () => items)
}

const changeTracker = async (
  $: EngineInterface,
  change: (items: TrackerItem[]) => TrackerItem[],
  message: string,
): Promise<void> => {
  const items = change(await readTracker($))
  await $.fs.write(await trackerPath($), `${JSON.stringify({ items }, null, 2)}\n`)
  await update($, tracker, () => items)
  $.ui.toast(message)
}

const closeItem = ($: EngineInterface, item: TrackerItem) =>
  changeTracker($, items => items.filter(i => i.id !== item.id), `${item.label}: ${item.kind === 'test' ? 'tested' : 'done'}`)

const snoozeItem = async ($: EngineInterface, item: TrackerItem) => {
  const due = localDate(await $.clock.now(), 1)
  await changeTracker($, items => items.map(i => (i.id === item.id ? { ...i, due } : i)), `${item.label}: moved to ${due}`)
}

const shipItNote = async ($: EngineInterface, text: string): Promise<string | null> => {
  if (!isShipIt(text)) return null
  const run = await read($, ship)
  return run?.plan ?? 'No /ship run is ready (none ran, or its checks did not all pass). Tell Stan to run /ship first.'
}

const briefing = async ($: EngineInterface): Promise<string | null> => {
  if (isBriefed) return null
  isBriefed = true
  const { due, waiting } = splitTracker(await readTracker($), localDate(await $.clock.now()))
  if (due.length === 0 && waiting.length === 0) return null
  return (
    `Astryx tracker (${await trackerPath($)}; edit it to add or close items):\n` +
    (due.length > 0
      ? `Due reminders, remind Stan: ${due.map(i => `${i.label} (${i.due ?? 'undated'}): ${i.text}`).join('; ')}\n`
      : '') +
    (waiting.length > 0 ? `Awaiting Stan's test: ${waiting.map(i => i.label).join(', ')}` : '')
  )
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const [config, cargo, branch, porcelain, unpushed, current, tested, testedAt] =
    await Promise.all([
      readText($, CONFIG_JS),
      readText($, CARGO_TOML),
      git($, ['branch', '--show-current']),
      git($, ['status', '--porcelain']),
      git($, ['rev-list', '--count', '@{u}..HEAD']),
      fingerprint($),
      $.store.get(STORE_FINGERPRINT),
      $.store.get(STORE_TESTED_AT),
    ])
  const tests: TestsState =
    tested === undefined ? 'never' : tested === current ? 'ok' : 'stale'
  const next: RepoStatus = {
    appVersion: parseAppVersion(config),
    cargoVersion: parseCargoVersion(cargo),
    branch: branch.trim() || '(detached)',
    uncommitted: porcelain.split('\n').filter(Boolean).length,
    unpushed: Number(unpushed.trim()) || 0,
    tests,
    testedAt: typeof testedAt === 'number' ? testedAt : null,
    checkedAt: await $.clock.now(),
  }
  await update($, status, () => next)
}

// /bump: both version numbers (and Cargo.lock's copy) move together
const bump = async ($: EngineInterface, args: string): Promise<string> => {
  const kind = args.trim()
  if (!isBumpKind(kind)) return 'Usage: /bump patch | /bump minor'
  const [config, cargo, lock] = await Promise.all([
    readText($, CONFIG_JS),
    readText($, CARGO_TOML),
    readText($, CARGO_LOCK),
  ])
  const app = parseAppVersion(config)
  const crate = parseCargoVersion(cargo)
  const name = parseCargoName(cargo)
  if (app === null || crate === null || name === null)
    return `Not bumped: could not read the version from ${CONFIG_JS} or ${CARGO_TOML}.`
  if (app !== crate)
    return `Not bumped: ${CONFIG_JS} says ${app} but ${CARGO_TOML} says ${crate}. Make them match first.`
  const version = nextVersion(app, kind)
  if (version === null) return `Not bumped: ${app} is not x.y.z.`
  const newLock = setLockVersion(lock, name, version)
  await $.fs.write(CONFIG_JS, setAppVersion(config, version))
  await $.fs.write(CARGO_TOML, setCargoVersion(cargo, version))
  if (newLock !== lock) await $.fs.write(CARGO_LOCK, newLock)
  await refresh($)
  const files = newLock !== lock ? `${CONFIG_JS}, ${CARGO_TOML}, ${CARGO_LOCK}` : `${CONFIG_JS}, ${CARGO_TOML}`
  return `Bumped ${app} -> ${version} (${kind}) in ${files}.`
}

// Push guard: the reasons a push to main must not go out, checked fresh
const pushProblems = async ($: EngineInterface): Promise<string[]> => {
  const [config, cargo, porcelain, current, tested] = await Promise.all([
    readText($, CONFIG_JS),
    readText($, CARGO_TOML),
    git($, ['status', '--porcelain']),
    fingerprint($),
    $.store.get(STORE_FINGERPRINT),
  ])
  const app = parseAppVersion(config)
  const crate = parseCargoVersion(cargo)
  const dirty = porcelain.split('\n').filter(Boolean).length
  const problems: string[] = []
  if (app === null || app !== crate)
    problems.push(`versions differ: ${CONFIG_JS} ${app ?? '?'}, ${CARGO_TOML} ${crate ?? '?'}`)
  if (tested === undefined) problems.push('no recorded pass of just test')
  else if (tested !== current) problems.push('code changed since the last passing just test')
  if ((await read($, snapshots)) !== null) problems.push('snapshot changes not reviewed (Keep or Revert in the Astryx pane)')
  if (dirty > 0) problems.push(`${dirty} uncommitted file${dirty === 1 ? '' : 's'}; commit first, then push on its own`)
  return problems
}

// Snapshot guard: back up before an update, then show what moved for review
type SnapshotFiles = Record<string, string>

const readSnapshotFiles = async ($: EngineInterface): Promise<SnapshotFiles> => {
  const entries = await $.fs.list(SNAPSHOT_DIR).catch(() => [])
  const files: SnapshotFiles = {}
  for (const entry of entries)
    if (entry.kind === 'file' && entry.name.endsWith('.json'))
      files[`${SNAPSHOT_DIR}/${entry.name}`] = await readText($, `${SNAPSHOT_DIR}/${entry.name}`)
  return files
}

const reviewSnapshots = async ($: EngineInterface, before: SnapshotFiles): Promise<void> => {
  const after = await readSnapshotFiles($)
  const diffs: SnapshotDiff[] = []
  let snapshotCount = 0
  for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
    diffs.push(...diffSnapshotFile(file, before[file] ?? '', after[file] ?? ''))
    snapshotCount += countSnapshots(after[file] ?? '')
  }
  if (diffs.length === 0) {
    await $.store.delete(STORE_SNAPSHOT_BACKUP)
    await update($, snapshots, () => null)
    $.ui.toast('Snapshots unchanged')
    return
  }
  await update($, snapshots, () => ({ diffs, snapshotCount }))
  void $.ui.open({ id: PANE, title: TITLE })
}

const keepSnapshots = async ($: EngineInterface): Promise<void> => {
  await $.store.delete(STORE_SNAPSHOT_BACKUP)
  await update($, snapshots, () => null)
  $.ui.toast('New snapshots kept')
}

const revertSnapshots = async ($: EngineInterface): Promise<void> => {
  const before = ((await $.store.get(STORE_SNAPSHOT_BACKUP)) ?? {}) as SnapshotFiles
  for (const file of Object.keys(await readSnapshotFiles($)))
    if (!(file in before)) await $.process.run(['rm', '--', file])
  for (const [file, text] of Object.entries(before)) await $.fs.write(file, text)
  await $.store.delete(STORE_SNAPSHOT_BACKUP)
  await update($, snapshots, () => null)
  await refresh($)
  $.ui.toast('Snapshots reverted to before the update')
}

const head = async ($: EngineInterface): Promise<string> =>
  (await git($, ['rev-parse', 'HEAD'])).trim()

// Approve the waiting push, if HEAD and the tree are still what was held back
const approvePush = async ($: EngineInterface): Promise<string> => {
  const { waiting } = await read($, push)
  if (waiting === null) return 'No push is waiting for approval.'
  const problems = await pushProblems($)
  if (problems.length > 0 || (await head($)) !== waiting.head) {
    await update($, push, p => ({ ...p, waiting: null }))
    return 'Not approved: the code changed since the push was held back. Ask Claude to push again.'
  }
  const expiresAt = (await $.clock.now()) + PUSH_APPROVAL_MS
  await update($, push, () => ({ waiting: null, approved: { ...waiting, expiresAt } }))
  return `Push of v${waiting.version} approved until ${clockTime(expiresAt)}. Tell Claude to push.`
}

const recordPass = async ($: EngineInterface): Promise<void> => {
  await $.store.set(STORE_FINGERPRINT, await fingerprint($))
  await $.store.set(STORE_TESTED_AT, await $.clock.now())
  await refresh($)
}

// /ship web: run every check; Stan's "ship it" then has Claude commit and push
const SHIP_MARK = { todo: '[  ]', running: '[..]', ok: '[ok]', failed: '[X] ' } as const

const setStep = (
  $: EngineInterface,
  index: number,
  state: ShipStep['state'],
  detail: string | null = null,
  output: string[] = [],
) =>
  update($, ship, run =>
    run === null
      ? null
      : { ...run, output, steps: run.steps.map((s, i) => (i === index ? { ...s, state, detail } : s)) },
  )

// Desktop release: follow the CI run a pushed tag started, then publish on Stan's press
const watchRelease = async ($: EngineInterface): Promise<void> => {
  const r = await read($, release)
  if (r === null || r.state !== 'building') return
  const runs = await $.process
    .run(['gh', 'run', 'list', '--workflow', RELEASE_WORKFLOW, '--branch', r.tag, '--limit', '1', '--json', 'status,conclusion,url'])
    .catch(() => null)
  if (runs === null || runs.exitCode !== 0) return
  const [run] = JSON.parse(runs.stdout) as { status: string; conclusion: string; url: string }[]
  if (run === undefined) return
  const next: ReleaseWatch =
    run.status !== 'completed'
      ? { ...r, url: run.url }
      : { ...r, url: run.url, state: run.conclusion === 'success' ? 'built' : 'failed' }
  await $.store.set(STORE_RELEASE, next)
  await update($, release, () => next)
  if (next.state === 'built') $.ui.toast(`Desktop release ${r.tag} built: a draft until you publish it`)
  if (next.state === 'failed') $.ui.toast(`Desktop release ${r.tag}: the CI build failed`)
}

const publishRelease = async ($: EngineInterface): Promise<void> => {
  const r = await read($, release)
  if (r === null || r.state !== 'built') return
  const done = await $.process.run(['gh', 'release', 'edit', r.tag, '--draft=false']).catch(() => null)
  if (done === null || done.exitCode !== 0) {
    $.ui.toast(`Not published: ${done?.stderr.trim() || 'gh did not run'}`)
    return
  }
  const next: ReleaseWatch = { ...r, state: 'published' }
  await $.store.set(STORE_RELEASE, next)
  await update($, release, () => next)
  $.ui.toast(`Release ${r.tag} published`)
}

const dismissRelease = async ($: EngineInterface): Promise<void> => {
  await $.store.delete(STORE_RELEASE)
  await update($, release, () => null)
}

const runShip = async ($: EngineInterface, args: ShipArgs): Promise<void> => {
  const labels = [
    ...(args.bump === null ? [] : [`Bump version (${args.bump})`]),
    'Versions match',
    ...(args.target === 'web' ? [] : ['Release tag free']),
    'Snapshots reviewed',
    'Changes to ship',
    'Full tests (just test)',
    'Ready to ship',
  ]
  await update($, ship, () => ({
    target: args.target,
    steps: labels.map(label => ({ label, state: 'todo' as const, detail: null })),
    output: [],
    plan: null,
  }))
  void $.ui.open({ id: PANE, title: TITLE })
  let step = 0
  const fail = async (detail: string, output: string[] = []): Promise<void> => {
    await setStep($, step, 'failed', detail, output)
    $.ui.toast(`Ship stopped: ${detail}`)
  }

  if (args.bump !== null) {
    await setStep($, step, 'running')
    const result = await bump($, args.bump)
    if (!result.startsWith('Bumped')) return fail(result)
    await setStep($, step++, 'ok', result.replace(/ in .*$/, ''))
  }

  await setStep($, step, 'running')
  const [config, cargo] = await Promise.all([readText($, CONFIG_JS), readText($, CARGO_TOML)])
  const version = parseAppVersion(config)
  if (version === null || version !== parseCargoVersion(cargo))
    return fail(`${CONFIG_JS} ${version ?? '?'}, ${CARGO_TOML} ${parseCargoVersion(cargo) ?? '?'}`)
  await setStep($, step++, 'ok', `v${version}`)

  const tag = releaseTag(version)
  if (args.target !== 'web') {
    await setStep($, step, 'running')
    if ((await git($, ['tag', '-l', tag])).trim() !== '') return fail(`tag ${tag} already exists here; bump first`)
    const remote = await $.process
      .run(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { timeoutMs: TAG_CHECK_TIMEOUT_MS })
      .catch(() => null)
    if (remote === null || remote.exitCode !== 0) return fail('could not reach GitHub to check the tag')
    if (remote.stdout.trim() !== '') return fail(`tag ${tag} already exists on GitHub; bump first`)
    await setStep($, step++, 'ok', tag)
  }

  await setStep($, step, 'running')
  if ((await read($, snapshots)) !== null) return fail('press Keep or Revert above first')
  await setStep($, step++, 'ok')

  await setStep($, step, 'running')
  const [porcelain, unpushed] = await Promise.all([
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--count', '@{u}..HEAD']),
  ])
  const files = porcelain.split('\n').filter(Boolean).length
  const commits = Number(unpushed.trim()) || 0
  // A desktop release of what is already pushed needs no new commit
  if (files === 0 && commits === 0 && args.target === 'web') return fail('nothing to commit or push')
  await setStep($, step++, 'ok', `${files} uncommitted file${files === 1 ? '' : 's'}, ${commits} unpushed commit${commits === 1 ? '' : 's'}`)

  await setStep($, step, 'running', 'running, this takes a while')
  const tests = await $.process
    .run(['just', 'test'], { timeoutMs: SHIP_TEST_TIMEOUT_MS })
    .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  if (tests.exitCode !== 0)
    return fail('tests failed', lastLines(`${tests.stdout}\n${tests.stderr}`, SHIP_FAILURE_LINES))
  await recordPass($)
  await setStep($, step++, 'ok', 'passed')

  // A mod's $.prompt.submit never reached Claude here, so Stan hands over
  const commit =
    files > 0 ? "Review the uncommitted changes, write a commit message in this repo's style, and commit. " : ''
  const pushes = {
    web: { said: 'pushes main', how: 'Push main (git push origin main) as a command of its own.' },
    desktop: {
      said: `tags ${tag}, pushes only the tag`,
      how: `Tag the commit (git tag ${tag}), then push only the tag (git push origin ${tag}) as a command of its own, so the web app is not deployed.`,
    },
    both: {
      said: `tags ${tag}, pushes main and the tag`,
      how: `Tag the commit (git tag ${tag}), then push main and the tag together (git push origin main ${tag}) as a command of its own.`,
    },
  }[args.target]
  const plan =
    `/ship ${args.target} passed every check for v${version}, and just test passed just now. ${commit}${pushes.how} ` +
    'The push guard holds the push until Stan presses Approve push in the Astryx pane; push again once he has.'
  await update($, ship, run => (run === null ? null : { ...run, plan }))
  await setStep($, step, 'ok', `type "ship it": Claude ${files > 0 ? 'commits, ' : ''}${pushes.said}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'astryx',
      description: 'Open the Astryx pane: version sync, changes, test status',
    })
    await $.command.register({
      name: 'bump',
      description: 'Bump the Astryx version in config.js and Cargo.toml together',
      argumentHint: 'patch | minor',
    })
    await $.command.register({
      name: 'ship',
      description: 'Check and test, then ship: web (push main), desktop (release tag), or both',
      argumentHint: 'web | desktop | both [patch | minor]',
    })
    await $.command.register({
      name: 'open-items',
      description: 'List what is open: due reminders, tests awaiting you, In progress and To Do issues',
    })
    await $.command.register({
      name: 'list-mods',
      description: 'List the Astryx mod features and how each one runs',
    })
    await $.command.register({
      name: 'push-ok',
      description: 'Approve the push to main that the Astryx push guard is holding',
    })
    const started = await next(e)
    // A review left open in an earlier session comes back
    const backup = (await $.store.get(STORE_SNAPSHOT_BACKUP)) as SnapshotFiles | undefined
    if (backup !== undefined) await reviewSnapshots($, backup)
    const kept = (await $.store.get(STORE_RELEASE)) as ReleaseWatch | undefined
    if (kept !== undefined) await update($, release, () => kept)
    await refresh($)
    await refreshTracker($)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
      void refreshTracker($)
      void recheckLint($)
      void watchRelease($)
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'astryx' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Astryx pane opened.' }
  })

  on('command.run', { command: 'open-items' }, async ($, e) => {
    const gh = await $.process.run(
      ['gh', 'project', 'item-list', PROJECT_NUMBER, '--owner', PROJECT_OWNER, '--limit', String(PROJECT_ITEM_LIMIT), '--format', 'json'],
      { timeoutMs: TAG_CHECK_TIMEOUT_MS },
    )
    const board = gh.exitCode === 0 ? parseBoard(gh.stdout) : null
    const tracked = splitTracker(await readTracker($), localDate(await $.clock.now()))
    return { text: openItemsText(tracked, board, PROJECT_COLUMNS, PROJECT_DONE, await outputWidth($, e.presentation.columns)) }
  })

  on('command.run', { command: 'list-mods' }, async ($, e) => ({
    text: listModsText(FEATURES, await outputWidth($, e.presentation.columns)),
  }))

  on('command.run', { command: 'push-ok' }, async $ => ({ text: await approvePush($) }))

  on('command.run', { command: 'ship' }, async ($, e) => {
    const args = parseShipArgs(e.args)
    if (args === null) return { text: 'Usage: /ship web | desktop | both, optionally followed by patch or minor' }
    const current = await read($, ship)
    if (current !== null && current.steps.some(s => s.state === 'running'))
      return { text: 'A ship is already running; see the Astryx pane.' }
    void runShip($, args).catch((err: unknown) => $.ui.toast(`Ship stopped: ${String(err)}`))
    return { text: `Shipping ${args.target}: progress in the Astryx pane.` }
  })

  // Notes on Stan's prompts: on "ship it", what the checked ship is (Claude
  // can't read the pane); on the session's first, what is due and awaits his test
  on('prompt.submit', async ($, e, next) => {
    const notes = [await shipItNote($, e.text), await briefing($)].filter((n): n is string => n !== null)
    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'bump' }, async ($, e) => ({ text: await bump($, e.args) }))

  // Push guard: refuse a bad push; hold a good one until Stan approves it.
  // A permission "ask" is decided by auto mode, not Stan, hence the approval.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = (e.input as { command?: string }).command ?? ''
    if (!isGuardedPush(command) || !(await pushesAstryx($, command))) return next(e)
    const branch = (await git($, ['branch', '--show-current'])).trim()
    if (branch !== DEPLOY_BRANCH && !command.includes(DEPLOY_BRANCH)) return next(e)
    const problems = await pushProblems($)
    const version = parseAppVersion(await readText($, CONFIG_JS)) ?? '?'
    const tag = pushedTag(command)
    if (tag !== null && tag !== releaseTag(version))
      problems.push(`tag ${tag} does not match the version ${version}; CI names the release ${releaseTag(version)}`)
    if (problems.length > 0) {
      await update($, push, p => ({ ...p, waiting: null }))
      $.ui.toast(`Push refused: ${problems.join('; ')}`)
      return {
        decision: 'deny' as const,
        reason: `Push guard: not pushing to ${DEPLOY_BRANCH}: ${problems.join('; ')}.`,
      }
    }
    const current = await head($)
    const { approved } = await read($, push)
    const now = await $.clock.now()
    // The check can run more than once per call, so the approval is used up
    // in tool.call, when the push actually runs
    if (approved !== null && approved.head === current && now < approved.expiresAt) {
      await update($, push, p => ({ ...p, waiting: null }))
      return next(e)
    }
    await update($, push, () => ({ waiting: { version, head: current }, approved: null }))
    void $.ui.open({ id: PANE, title: TITLE })
    $.ui.toast('Push held: press Approve push in the Astryx pane')
    return {
      decision: 'deny' as const,
      reason:
        `Push guard: this push ${tag === null ? `deploys v${version} to the live web app` : `starts the ${tag} desktop release build`} and needs Stan's approval. ` +
        'Ask Stan to press Approve push in the Astryx pane (or type /push-ok), then push again.',
    }
  }).catch(() => ({ decision: 'deny' as const, reason: 'Push guard: its checks failed to run.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const isUpdate = isSnapshotUpdate(e.command)
    // A second update before review keeps the first backup: Revert goes all the way back
    let before: SnapshotFiles = {}
    if (isUpdate) {
      const kept = (await $.store.get(STORE_SNAPSHOT_BACKUP)) as SnapshotFiles | undefined
      before = kept ?? (await readSnapshotFiles($))
      if (kept === undefined) await $.store.set(STORE_SNAPSHOT_BACKUP, before)
    }
    const ran = await next(e)
    if (isUpdate && ran.deny === undefined) await reviewSnapshots($, before)
    const passed = ran.deny === undefined && ran.isError !== true
    if (isGuardedPush(e.command) && ran.deny === undefined && (await pushesAstryx($, e.command))) {
      await update($, push, p => ({ ...p, approved: null }))
      // The push went out: the ship is done, and a pushed tag starts the release build
      if (ran.isError !== true) {
        await update($, ship, () => null)
        const tag = pushedTag(e.command)
        if (tag !== null) {
          const watch: ReleaseWatch = { tag, state: 'building', url: null }
          await $.store.set(STORE_RELEASE, watch)
          await update($, release, () => watch)
        }
      }
    }
    if (isFullTestCommand(e.command) && passed) await recordPass($)
    else void refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    const path = (e as { file_path?: string }).file_path ?? ''
    const before = await readText($, path)
    const ran = await next(e)
    void refresh($)
    if (ran.deny !== undefined || ran.isError === true || path === '') return ran
    const notes = [
      await lintEdit($, path, before),
      await checkTutorials($, await repoPath($, path), before),
    ].filter((n): n is string => n !== null)
    return notes.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...notes] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    dockColumns = e.props.placement === 'dock' ? e.props.bodyColumns : null
    const s = await read($, status)
    if (s === null) return <Text dimColor>Reading the repo...</Text>
    const { waiting, approved } = await read($, push)
    const review = await read($, snapshots)
    const shipping = await read($, ship)
    const building = await read($, release)
    const findings = await read($, lint)
    const brokenSteps = await read($, tutorials)
    const { due, waiting: awaiting, later } = splitTracker(await read($, tracker), localDate(s.checkedAt))

    const isMismatch = s.appVersion !== s.cargoVersion
    const passedAt = s.testedAt === null ? '' : ` (last pass ${clockTime(s.testedAt)})`
    const testsLine =
      s.tests === 'ok'
        ? `OK: passed${passedAt}, code unchanged since`
        : s.tests === 'stale'
          ? `STALE: code changed since last pass${passedAt}`
          : 'NOT RUN: no recorded pass of just test'

    return (
      <Box flexDirection="column">
        {due.length > 0 && (
          <Box flexDirection="column">
            <Text bold>&gt;&gt; DUE ({due.length})</Text>
            {due.map(i => (
              <Box key={`due-${i.id}`}>
                <Text>
                  {'  '}[!] {i.due ?? 'undated'}  {i.label}: {i.text}{' '}
                </Text>
                <Button key={`done-${i.id}`} label="Done" onPress={() => closeItem($, i)} />
                <Text> </Text>
                <Button key={`snooze-${i.id}`} label="Tomorrow" onPress={() => snoozeItem($, i)} />
              </Box>
            ))}
            <Text> </Text>
          </Box>
        )}
        {awaiting.length > 0 && (
          <Box flexDirection="column">
            <Text bold>AWAITING YOUR TEST ({awaiting.length})</Text>
            {awaiting.map(i => (
              <Box key={`test-${i.id}`}>
                <Text>
                  {'  '}
                  {i.label}  {i.text}{' '}
                </Text>
                <Button key={`tested-${i.id}`} label="Tested" onPress={() => closeItem($, i)} />
              </Box>
            ))}
            <Text> </Text>
          </Box>
        )}
        {later.length > 0 && (
          <Box flexDirection="column">
            <Text bold>LATER</Text>
            {later.map(i => (
              <Text key={`later-${i.id}`} dimColor>
                {'  '}
                {i.due}  {i.label}: {i.text}
              </Text>
            ))}
            <Text> </Text>
          </Box>
        )}
        {shipping !== null && (
          <Box flexDirection="column">
            <Text bold>&gt;&gt; SHIP {shipping.target.toUpperCase()}</Text>
            {shipping.steps.map(st => (
              <Text key={st.label}>
                {'  '}
                {SHIP_MARK[st.state]} {st.label}
                {st.detail === null ? '' : `: ${st.detail}`}
              </Text>
            ))}
            {shipping.output.map((line, i) => (
              <Text key={`out-${i}`} dimColor>
                {'    '}
                {line}
              </Text>
            ))}
            <Button key="dismiss-ship" label="Dismiss" onPress={() => update($, ship, () => null)} />
            <Text> </Text>
          </Box>
        )}
        {building !== null && (
          <Box flexDirection="column">
            <Text bold>&gt;&gt; DESKTOP RELEASE {building.tag}</Text>
            <Text>
              {'  '}
              {building.state === 'building'
                ? '[..] CI building the Ubuntu .deb and Windows .exe'
                : building.state === 'built'
                  ? '[ok] Built: a draft release, not public yet'
                  : building.state === 'failed'
                    ? '[X]  CI build FAILED'
                    : '[ok] Published'}
            </Text>
            {building.url !== null && <Text dimColor>  {building.url}</Text>}
            {building.state === 'built' && <Text>  Run both installers first, then publish.</Text>}
            <Box>
              {building.state === 'built' && (
                <Button key="publish-release" label="Publish release" variant="primary" onPress={() => publishRelease($)} />
              )}
              {building.state === 'built' && <Text> </Text>}
              <Button key="dismiss-release" label="Dismiss" onPress={() => dismissRelease($)} />
            </Box>
            <Text> </Text>
          </Box>
        )}
        {findings.length > 0 && (
          <Box flexDirection="column">
            <Text bold>
              &gt;&gt; RULES: {findings.length} break{findings.length === 1 ? '' : 's'} in lines Claude added
            </Text>
            {findings.map(f => (
              <Box key={`${f.file}:${f.line}:${f.message}`} flexDirection="column">
                <Text>
                  {'  '}
                  {f.file}:{f.line}  {f.message}
                </Text>
                <Text dimColor>    {f.text.length > 70 ? `${f.text.slice(0, 70)}...` : f.text}</Text>
              </Box>
            ))}
            <Button key="clear-rules" label="Clear" onPress={() => update($, lint, () => [])} />
            <Text> </Text>
          </Box>
        )}
        {brokenSteps.length > 0 && (
          <Box flexDirection="column">
            <Text bold>
              &gt;&gt; TUTORIALS: {brokenSteps.length} step{brokenSteps.length === 1 ? '' : 's'} target missing elements
            </Text>
            {brokenSteps.map(f => (
              <Text key={`${f.tutorial}:${f.step}:${f.name}`}>
                {'  '}
                {f.tutorial} step {f.step} ({f.stepId}): {f.selector}
              </Text>
            ))}
            <Button key="clear-tutorials" label="Clear" onPress={() => update($, tutorials, () => [])} />
            <Text> </Text>
          </Box>
        )}
        {waiting !== null && (
          <Box flexDirection="column">
            <Text bold>&gt;&gt; PUSH WAITING: deploys v{waiting.version}</Text>
            <Box>
              <Button
                key="approve-push"
                label="Approve push"
                variant="primary"
                onPress={async () => $.ui.toast(await approvePush($))}
              />
              <Text> </Text>
              <Button
                key="cancel-push"
                label="Cancel"
                onPress={() => update($, push, p => ({ ...p, waiting: null }))}
              />
            </Box>
            <Text> </Text>
          </Box>
        )}
        {approved !== null && approved.expiresAt > s.checkedAt && (
          <Box flexDirection="column">
            <Text bold>
              Push of v{approved.version} approved until {clockTime(approved.expiresAt)}
            </Text>
            <Text> </Text>
          </Box>
        )}
        {review !== null && (
          <Box flexDirection="column">
            <Text bold>
              &gt;&gt; SNAPSHOTS CHANGED: {review.diffs.length} of {review.snapshotCount}
            </Text>
            {review.diffs.map(d => (
              <Box key={`${d.file}:${d.name}`} flexDirection="column">
                <Text>
                  {'  '}
                  {d.name}
                  {d.kind === 'added' ? ' (new snapshot)' : d.kind === 'removed' ? ' (removed)' : ''}
                </Text>
                {d.changes.map(c => (
                  <Text dimColor>
                    {'    '}
                    {c.path}: {c.before} -&gt; {c.after}
                  </Text>
                ))}
                {d.total > d.changes.length && (
                  <Text dimColor>    + {d.total - d.changes.length} more</Text>
                )}
              </Box>
            ))}
            <Box>
              <Button key="keep-snapshots" label="Keep" onPress={() => keepSnapshots($)} />
              <Text> </Text>
              <Button key="revert-snapshots" label="Revert" onPress={() => revertSnapshots($)} />
            </Box>
            <Text> </Text>
          </Box>
        )}
        <Text bold>Version</Text>
        <Text>  config.js   {s.appVersion ?? '(not found)'}</Text>
        <Text>  Cargo.toml  {s.cargoVersion ?? '(not found)'}</Text>
        {isMismatch && <Text bold>  ! MISMATCH: the two must match</Text>}
        <Text> </Text>
        <Text bold>Git</Text>
        <Text>  Branch      {s.branch}</Text>
        <Text>  Uncommitted {s.uncommitted} file{s.uncommitted === 1 ? '' : 's'}</Text>
        <Text>
          {'  '}Unpushed    {s.unpushed} commit{s.unpushed === 1 ? '' : 's'}
          {s.unpushed > 0 && s.branch === 'main' ? ' (push deploys)' : ''}
        </Text>
        <Text> </Text>
        <Text bold>Tests (just test / just check)</Text>
        <Text>  {testsLine}</Text>
        <Text> </Text>
        <Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Text dimColor>  checked {clockTime(s.checkedAt)}</Text>
        </Box>
      </Box>
    )
  })
}
