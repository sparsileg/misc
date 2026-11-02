import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LintFinding, PushState, ReleaseWatch, RepoStatus, ShipStep, TestsState, TrackerItem, VersionFile } from '../types'
import type { BumpKind, ModFeature } from './parse'
import {
  addedLines,
  clockTime,
  fingerprintText,
  isBumpKind,
  isFullTestCommand,
  isGuardedPush,
  isMigration,
  isPerfCommand,
  isShipIt,
  lastLines,
  lintLine,
  listModsText,
  localDate,
  nextVersion,
  openItemsText,
  parseBoard,
  parseCargoVersion,
  parseJsonVersion,
  parseShipArgs,
  parseVersionTest,
  parseStagedHashes,
  parseTracker,
  pushedTag,
  pushNeedsTests,
  releaseTag,
  rustTestStart,
  setCargoVersion,
  setJsonVersion,
  setLockVersion,
  setPackageLockVersion,
  setVersionTest,
  splitTracker,
  versionsAgree,
} from './parse'

const PANE = 'kansha'
const TITLE = 'Kansha'
const REFRESH_MS = 15_000
// Code whose change means perf and the check have to run again
const TESTED_PATHS = ['crates', 'src-tauri', 'src', 'tests', 'package.json', 'Cargo.toml', 'justfile']
const STORE_FINGERPRINT = 'testedFingerprint'
const STORE_TESTED_AT = 'testedAt'
const STORE_PERF_FINGERPRINT = 'perfFingerprint'
const STORE_PERF_AT = 'perfAt'
// Every file that carries the app's version; they move together
const PACKAGE_JSON = 'package.json'
const PACKAGE_LOCK = 'package-lock.json'
const TAURI_CONF = 'src-tauri/tauri.conf.json'
const CARGO_TOML = 'Cargo.toml'
const CARGO_LOCK = 'Cargo.lock'
const VERSION_TEST = 'src/lib/version.test.ts'
const NPM_NAME = 'kansha'
const CRATES = ['kansha', 'kansha-core']
const PUSH_APPROVAL_MS = 5 * 60_000
// just check and just perf each compile and run a lot; ten minutes is process.run's limit
const SHIP_RUN_TIMEOUT_MS = 10 * 60_000
// Output lines shown under a failed /ship step
const SHIP_FAILURE_LINES = 15
// How long to wait for GitHub (release tag check, project board)
const GITHUB_TIMEOUT_MS = 15_000
// The GitHub Actions workflow a pushed v* tag starts: deb + exe into a draft release
const RELEASE_WORKFLOW = 'release.yml'
const RELEASE_WORKFLOW_PATH = `.github/workflows/${RELEASE_WORKFLOW}`
// The GitHub project /open-items reads, and the columns it lists
const PROJECT_OWNER = 'sparsileg'
const PROJECT_NUMBER = '16'
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

// What /list-mods shows; a new feature adds its row here
const FEATURES: ModFeature[] = [
  { name: 'Pane status', does: 'Version sync (package.json, package-lock.json, tauri.conf.json, Cargo.toml, version.test.ts), branch, uncommitted and unpushed changes, whether just perf and just check passed since the code last changed', runs: 'automatic; /kansha opens the pane' },
  { name: '/bump', does: 'Bumps the version in every version file, Cargo.lock, and version.test.ts together', runs: '/bump patch|minor' },
  { name: 'Push guard', does: 'Refuses a push with mismatched versions, stale perf or check (not needed when the commits touch no code and no tag goes), or a dirty tree; holds a good one for approval', runs: 'automatic; Approve push or /push-ok' },
  { name: '/ship', does: 'Checks, just perf, just check, then ships: commit, tag, push main and the tag; watches the release build and offers Publish', runs: '/ship [patch|minor], then "ship it"' },
  { name: 'Rule linter', does: 'Flags hard-rule breaks in lines an edit adds (unwrap/expect, unsafe, floats, SQL outside persistence, real time outside the Clock, JS Date, console.log) and edits to released migrations', runs: 'automatic' },
  { name: 'Test tracker', does: 'Changes awaiting your test, dated reminders, and items to decide (not in the briefing), with a briefing at session start', runs: 'automatic; pane buttons' },
  { name: '/open-items', does: 'Due reminders, tests awaiting you, In progress and To Do issues (project 16)', runs: '/open-items' },
  { name: '/list-mods', does: 'This list', runs: '/list-mods' },
]

const status = atom({ plugin: 'kansha', key: 'status' } as const, null)
const push = atom({ plugin: 'kansha', key: 'push' } as const, {
  waiting: null,
  approved: null,
} as PushState)
const ship = atom({ plugin: 'kansha', key: 'ship' } as const, null)
const release = atom({ plugin: 'kansha', key: 'release' } as const, null)
const lint = atom({ plugin: 'kansha', key: 'lint' } as const, [] as LintFinding[])
const tracker = atom({ plugin: 'kansha', key: 'tracker' } as const, [] as TrackerItem[])
// Set once the session's first prompt carried the tracker briefing
let isBriefed = false
// The pane's body width while docked beside the transcript, from its last render; null inline
let dockColumns: number | null = null

const git = async ($: EngineInterface, args: string[]): Promise<string> => {
  const run = await $.process.run(['git', ...args])
  return run.exitCode === 0 ? run.stdout : ''
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

const readVersions = async ($: EngineInterface): Promise<VersionFile[]> => {
  const [pkg, lock, conf, cargo, versionTest] = await Promise.all([
    readText($, PACKAGE_JSON),
    readText($, PACKAGE_LOCK),
    readText($, TAURI_CONF),
    readText($, CARGO_TOML),
    readText($, VERSION_TEST),
  ])
  return [
    { path: PACKAGE_JSON, version: parseJsonVersion(pkg) },
    { path: PACKAGE_LOCK, version: parseJsonVersion(lock) },
    { path: TAURI_CONF, version: parseJsonVersion(conf) },
    { path: CARGO_TOML, version: parseCargoVersion(cargo) },
    { path: VERSION_TEST, version: parseVersionTest(versionTest) },
  ]
}

const versionsText = (versions: VersionFile[]): string =>
  versions.map(v => `${v.path} ${v.version ?? '?'}`).join(', ')

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

const RELEASED_MIGRATION = 'released migration edited: add a new migration instead'

/** Check an edit; returns the note Claude reads, or null when it is clean */
const lintEdit = async ($: EngineInterface, path: string, before: string): Promise<string | null> => {
  const file = await repoPath($, path)
  const after = await readText($, path)
  // A migration in HEAD is released; one not yet committed may still change
  if (isMigration(file) && before !== after) {
    const released = (await $.process.run(['git', 'cat-file', '-e', `HEAD:${file}`])).exitCode === 0
    if (released) {
      await update($, lint, all => [
        ...all.filter(f => !(f.file === file && f.message === RELEASED_MIGRATION)),
        { file, line: 1, text: file, message: RELEASED_MIGRATION },
      ])
      return `Kansha rule check: ${file} is a released migration (it is in HEAD). Never edit one; restore it (git checkout -- ${file}) and add a new migration instead.`
    }
  }
  const fresh = findingsIn(file, after, addedLines(before, after))
  // Earlier findings in this file stay while their line still breaks the rule
  await update($, lint, all => {
    const others = all.filter(f => f.file !== file || f.message === RELEASED_MIGRATION)
    const still = all
      .filter(f => f.file === file && f.message !== RELEASED_MIGRATION)
      .flatMap(f => {
        const i = after.split('\n').findIndex(line => line.trim() === f.text)
        return i === -1 || fresh.some(n => n.line === i + 1) ? [] : findingsIn(file, after, [i + 1]).filter(n => n.message === f.message)
      })
    return [...others, ...still, ...fresh]
  })
  if (fresh.length === 0) return null
  return (
    `Kansha rule check (CLAUDE.md hard rules) on lines this edit added to ${file}:\n` +
    fresh.map(f => `  line ${f.line}: ${f.message}: ${f.text}`).join('\n') +
    '\nFix these unless the rule truly does not apply (a documented invariant, a clock time); Stan sees them in the Kansha pane.'
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
      if (f.message === RELEASED_MIGRATION) {
        // Gone once the file matches HEAD again
        const diff = await $.process.run(['git', 'diff', '--quiet', 'HEAD', '--', file])
        if (diff.exitCode !== 0) next.push(f)
        continue
      }
      const i = lines.findIndex(line => line.trim() === f.text)
      if (i !== -1) next.push(...findingsIn(file, text, [i + 1]).filter(n => n.message === f.message))
    }
  }
  if (next.length !== all.length || next.some((f, i) => f.line !== all[i]?.line))
    await update($, lint, () => next)
}

// Tracker: a file outside the repo (never committed) that Claude edits and the pane's buttons change
const trackerPath = async ($: EngineInterface): Promise<string> => {
  const root = (await git($, ['rev-parse', '--show-toplevel'])).trim()
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/projects/${root.replace(/\//g, '-')}/kansha-tracker.json`
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
  changeTracker($, items => items.filter(i => i.id !== item.id), `${item.label}: ${item.kind === 'test' ? 'tested' : item.kind === 'decide' ? 'resolved' : 'done'}`)

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
    `Kansha tracker (${await trackerPath($)}; edit it to add or close items):\n` +
    (due.length > 0
      ? `Due reminders, remind Stan: ${due.map(i => `${i.label} (${i.due ?? 'undated'}): ${i.text}`).join('; ')}\n`
      : '') +
    (waiting.length > 0 ? `Awaiting Stan's test: ${waiting.map(i => i.label).join(', ')}` : '')
  )
}

const state = (passed: unknown, current: string): TestsState =>
  passed === undefined ? 'never' : passed === current ? 'ok' : 'stale'

const refresh = async ($: EngineInterface): Promise<void> => {
  const [versions, branch, porcelain, unpushed, current, tested, testedAt, perfed, perfAt] =
    await Promise.all([
      readVersions($),
      git($, ['branch', '--show-current']),
      git($, ['status', '--porcelain']),
      git($, ['rev-list', '--count', '@{u}..HEAD']),
      fingerprint($),
      $.store.get(STORE_FINGERPRINT),
      $.store.get(STORE_TESTED_AT),
      $.store.get(STORE_PERF_FINGERPRINT),
      $.store.get(STORE_PERF_AT),
    ])
  const next: RepoStatus = {
    versions,
    branch: branch.trim() || '(detached)',
    uncommitted: porcelain.split('\n').filter(Boolean).length,
    unpushed: Number(unpushed.trim()) || 0,
    tests: state(tested, current),
    testedAt: typeof testedAt === 'number' ? testedAt : null,
    perf: state(perfed, current),
    perfAt: typeof perfAt === 'number' ? perfAt : null,
    checkedAt: await $.clock.now(),
  }
  await update($, status, () => next)
}

// /bump: every version file (and Cargo.lock's copies) move together
const bump = async ($: EngineInterface, args: string): Promise<string> => {
  const kind = args.trim()
  if (!isBumpKind(kind)) return 'Usage: /bump patch | /bump minor'
  return bumpTo($, kind)
}

const bumpTo = async ($: EngineInterface, kind: BumpKind): Promise<string> => {
  const versions = await readVersions($)
  const now = versionsAgree(versions.map(v => v.version))
  if (now === null) return `Not bumped: the versions differ (${versionsText(versions)}). Make them match first.`
  const version = nextVersion(now, kind)
  if (version === null) return `Not bumped: ${now} is not x.y.z.`
  const [pkg, lock, conf, cargo, cargoLock, versionTest] = await Promise.all([
    readText($, PACKAGE_JSON),
    readText($, PACKAGE_LOCK),
    readText($, TAURI_CONF),
    readText($, CARGO_TOML),
    readText($, CARGO_LOCK),
    readText($, VERSION_TEST),
  ])
  await $.fs.write(PACKAGE_JSON, setJsonVersion(pkg, version))
  await $.fs.write(PACKAGE_LOCK, setPackageLockVersion(lock, NPM_NAME, version))
  await $.fs.write(TAURI_CONF, setJsonVersion(conf, version))
  await $.fs.write(CARGO_TOML, setCargoVersion(cargo, version))
  await $.fs.write(CARGO_LOCK, CRATES.reduce((text, name) => setLockVersion(text, name, version), cargoLock))
  await $.fs.write(VERSION_TEST, setVersionTest(versionTest, version))
  await refresh($)
  return `Bumped ${now} -> ${version} (${kind}) in ${[PACKAGE_JSON, PACKAGE_LOCK, TAURI_CONF, CARGO_TOML, CARGO_LOCK, VERSION_TEST].join(', ')}.`
}

// Files the unpushed commits change; null when git cannot tell (no upstream)
const outgoingFiles = async ($: EngineInterface): Promise<string[] | null> => {
  const run = await $.process.run(['git', 'diff', '--name-only', '@{upstream}..HEAD'])
  return run.exitCode === 0 ? run.stdout.split('\n').filter(Boolean) : null
}

// Push guard: the reasons a push must not go out, checked fresh. A push whose
// commits touch no tested code (docs only) and sends no tag skips perf and check.
const pushProblems = async ($: EngineInterface, tag: string | null = null): Promise<string[]> => {
  const [versions, porcelain, current, tested, perfed, outgoing] = await Promise.all([
    readVersions($),
    git($, ['status', '--porcelain']),
    fingerprint($),
    $.store.get(STORE_FINGERPRINT),
    $.store.get(STORE_PERF_FINGERPRINT),
    outgoingFiles($),
  ])
  const dirty = porcelain.split('\n').filter(Boolean).length
  const problems: string[] = []
  if (versionsAgree(versions.map(v => v.version)) === null) problems.push(`versions differ: ${versionsText(versions)}`)
  if (pushNeedsTests(outgoing, TESTED_PATHS, tag)) {
    if (perfed === undefined) problems.push('no recorded pass of just perf')
    else if (perfed !== current) problems.push('code changed since the last passing just perf')
    if (tested === undefined) problems.push('no recorded pass of just check')
    else if (tested !== current) problems.push('code changed since the last passing just check')
  }
  if (dirty > 0) problems.push(`${dirty} uncommitted file${dirty === 1 ? '' : 's'}; commit first, then push on its own`)
  return problems
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

const recordPerf = async ($: EngineInterface): Promise<void> => {
  await $.store.set(STORE_PERF_FINGERPRINT, await fingerprint($))
  await $.store.set(STORE_PERF_AT, await $.clock.now())
  await refresh($)
}

// /ship: run every check; Stan's "ship it" then has Claude commit, tag and push
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

// Release: follow the CI run a pushed tag started, then publish on Stan's press
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
  if (next.state === 'built') $.ui.toast(`Release ${r.tag} built: a draft until you publish it`)
  if (next.state === 'failed') $.ui.toast(`Release ${r.tag}: the CI build failed`)
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

const runLong = ($: EngineInterface, command: string[]) =>
  $.process
    .run(command, { timeoutMs: SHIP_RUN_TIMEOUT_MS })
    .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))

const runShip = async ($: EngineInterface, bumpKind: BumpKind | null): Promise<void> => {
  const labels = [
    ...(bumpKind === null ? [] : [`Bump version (${bumpKind})`]),
    'Versions match',
    'Release workflow present',
    'Release tag free',
    'Changes to ship',
    'Speed (just perf)',
    'Full check (just check)',
    'Ready to ship',
  ]
  await update($, ship, () => ({
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

  if (bumpKind !== null) {
    await setStep($, step, 'running')
    const result = await bumpTo($, bumpKind)
    if (!result.startsWith('Bumped')) return fail(result)
    await setStep($, step++, 'ok', result.replace(/ in .*$/, ''))
  }

  await setStep($, step, 'running')
  const versions = await readVersions($)
  const version = versionsAgree(versions.map(v => v.version))
  if (version === null) return fail(versionsText(versions))
  await setStep($, step++, 'ok', `v${version}`)

  await setStep($, step, 'running')
  if (!(await $.fs.exists(RELEASE_WORKFLOW_PATH))) return fail(`${RELEASE_WORKFLOW_PATH} is missing; nothing would build the release`)
  await setStep($, step++, 'ok')

  const tag = releaseTag(version)
  await setStep($, step, 'running')
  if ((await git($, ['tag', '-l', tag])).trim() !== '') return fail(`tag ${tag} already exists here; bump first`)
  const remote = await $.process
    .run(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { timeoutMs: GITHUB_TIMEOUT_MS })
    .catch(() => null)
  if (remote === null || remote.exitCode !== 0) return fail('could not reach GitHub to check the tag')
  if (remote.stdout.trim() !== '') return fail(`tag ${tag} already exists on GitHub; bump first`)
  await setStep($, step++, 'ok', tag)

  await setStep($, step, 'running')
  const [porcelain, unpushed] = await Promise.all([
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--count', '@{u}..HEAD']),
  ])
  const files = porcelain.split('\n').filter(Boolean).length
  const commits = Number(unpushed.trim()) || 0
  await setStep($, step++, 'ok', `${files} uncommitted file${files === 1 ? '' : 's'}, ${commits} unpushed commit${commits === 1 ? '' : 's'}`)

  await setStep($, step, 'running', 'running, this takes a while')
  const perf = await runLong($, ['just', 'perf'])
  if (perf.exitCode !== 0) return fail('just perf failed', lastLines(`${perf.stdout}\n${perf.stderr}`, SHIP_FAILURE_LINES))
  await recordPerf($)
  // Stan reads the timings: the last lines stay under the step
  await setStep($, step++, 'ok', 'passed; read the timings below', lastLines(perf.stdout, SHIP_FAILURE_LINES))

  await setStep($, step, 'running', 'running, this takes a while')
  const check = await runLong($, ['just', 'check'])
  if (check.exitCode !== 0) return fail('just check failed', lastLines(`${check.stdout}\n${check.stderr}`, SHIP_FAILURE_LINES))
  await recordPass($)
  const kept = (await read($, ship))?.output ?? []
  await setStep($, step++, 'ok', 'passed', kept)

  // A mod's $.prompt.submit never reached Claude here, so Stan hands over
  const commit =
    files > 0
      ? "Review the uncommitted changes, write a commit message in this repo's style (summary ≤72 chars, body wrapped at 72 citing requirement IDs, ⚠ flags), and commit. "
      : ''
  const plan =
    `/ship passed every check for v${version}: just perf and just check passed just now. ${commit}` +
    `Tag the commit (git tag ${tag}), then push main and the tag together (git push origin main ${tag}) as a command of its own. ` +
    'The push guard holds the push until Stan presses Approve push in the Kansha pane; push again once he has.'
  await update($, ship, run => (run === null ? null : { ...run, plan }))
  await setStep($, step, 'ok', `read the perf timings, then type "ship it": Claude ${files > 0 ? 'commits, ' : ''}tags ${tag}, pushes main and the tag`, kept)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kansha',
      description: 'Open the Kansha pane: version sync, changes, perf and check status',
    })
    await $.command.register({
      name: 'bump',
      description: 'Bump the Kansha version in every version file together',
      argumentHint: 'patch | minor',
    })
    await $.command.register({
      name: 'ship',
      description: 'Check, just perf, just check, then ship: commit, tag, push main and the tag',
      argumentHint: '[patch | minor]',
    })
    await $.command.register({
      name: 'open-items',
      description: 'List what is open: due reminders, tests awaiting you, In progress and To Do issues',
    })
    await $.command.register({
      name: 'list-mods',
      description: 'List the Kansha mod features and how each one runs',
    })
    await $.command.register({
      name: 'push-ok',
      description: 'Approve the push that the Kansha push guard is holding',
    })
    const started = await next(e)
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

  on('command.run', { command: 'kansha' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Kansha pane opened.' }
  })

  on('command.run', { command: 'open-items' }, async ($, e) => {
    const gh = await $.process.run(
      ['gh', 'project', 'item-list', PROJECT_NUMBER, '--owner', PROJECT_OWNER, '--limit', String(PROJECT_ITEM_LIMIT), '--format', 'json'],
      { timeoutMs: GITHUB_TIMEOUT_MS },
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
    if (args === null) return { text: 'Usage: /ship, optionally followed by patch or minor' }
    const current = await read($, ship)
    if (current !== null && current.steps.some(s => s.state === 'running'))
      return { text: 'A ship is already running; see the Kansha pane.' }
    void runShip($, args.bump).catch((err: unknown) => $.ui.toast(`Ship stopped: ${String(err)}`))
    return { text: 'Shipping: progress in the Kansha pane.' }
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
    if (!isGuardedPush(command)) return next(e)
    const tag = pushedTag(command)
    const problems = await pushProblems($, tag)
    const version = versionsAgree((await readVersions($)).map(v => v.version)) ?? '?'
    if (tag !== null && tag !== releaseTag(version))
      problems.push(`tag ${tag} does not match the version ${version}; CI names the release ${releaseTag(version)}`)
    if (problems.length > 0) {
      await update($, push, p => ({ ...p, waiting: null }))
      $.ui.toast(`Push refused: ${problems.join('; ')}`)
      return {
        decision: 'deny' as const,
        reason: `Push guard: not pushing: ${problems.join('; ')}.`,
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
    $.ui.toast('Push held: press Approve push in the Kansha pane')
    return {
      decision: 'deny' as const,
      reason:
        `Push guard: this push ${tag === null ? `sends v${version} to GitHub` : `starts the ${tag} release build`} and needs Stan's approval. ` +
        'Ask Stan to press Approve push in the Kansha pane (or type /push-ok), then push again.',
    }
  }).catch(() => ({ decision: 'deny' as const, reason: 'Push guard: its checks failed to run.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const passed = ran.deny === undefined && ran.isError !== true
    if (isGuardedPush(e.command) && ran.deny === undefined) {
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
    else if (isPerfCommand(e.command) && passed) await recordPerf($)
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
    const note = await lintEdit($, path, before)
    return note === null ? ran : { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    dockColumns = e.props.placement === 'dock' ? e.props.bodyColumns : null
    const s = await read($, status)
    if (s === null) return <Text dimColor>Reading the repo...</Text>
    const { waiting, approved } = await read($, push)
    const shipping = await read($, ship)
    const building = await read($, release)
    const findings = await read($, lint)
    const { due, waiting: awaiting, later, decide } = splitTracker(await read($, tracker), localDate(s.checkedAt))

    const isMismatch = versionsAgree(s.versions.map(v => v.version)) === null
    const pathWidth = Math.max(...s.versions.map(v => v.path.length))
    const stateLine = (state: TestsState, at: number | null, what: string) => {
      const passedAt = at === null ? '' : ` (last pass ${clockTime(at)})`
      return state === 'ok'
        ? `OK: passed${passedAt}, code unchanged since`
        : state === 'stale'
          ? `STALE: code changed since last pass${passedAt}`
          : `NOT RUN: no recorded pass of ${what}`
    }

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
        {decide.length > 0 && (
          <Box flexDirection="column">
            <Text bold>TO DECIDE ({decide.length})</Text>
            {decide.map(i => (
              <Box key={`decide-${i.id}`}>
                <Text>
                  {'  '}
                  {i.label}  {i.text}{' '}
                </Text>
                <Button key={`resolved-${i.id}`} label="Resolved" onPress={() => closeItem($, i)} />
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
            <Text bold>&gt;&gt; SHIP</Text>
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
            <Text bold>&gt;&gt; RELEASE {building.tag}</Text>
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
        {waiting !== null && (
          <Box flexDirection="column">
            <Text bold>&gt;&gt; PUSH WAITING: v{waiting.version}</Text>
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
        <Text bold>Version</Text>
        {s.versions.map(v => (
          <Text key={v.path}>
            {'  '}
            {v.path.padEnd(pathWidth)}  {v.version ?? '(not found)'}
          </Text>
        ))}
        {isMismatch && <Text bold>  ! MISMATCH: all must match</Text>}
        <Text> </Text>
        <Text bold>Git</Text>
        <Text>  Branch      {s.branch}</Text>
        <Text>  Uncommitted {s.uncommitted} file{s.uncommitted === 1 ? '' : 's'}</Text>
        <Text>
          {'  '}Unpushed    {s.unpushed} commit{s.unpushed === 1 ? '' : 's'}
        </Text>
        <Text> </Text>
        <Text bold>Perf (just perf)</Text>
        <Text>  {stateLine(s.perf, s.perfAt, 'just perf')}</Text>
        <Text bold>Check (just check)</Text>
        <Text>  {stateLine(s.tests, s.testedAt, 'just check')}</Text>
        <Text> </Text>
        <Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Text dimColor>  checked {clockTime(s.checkedAt)}</Text>
        </Box>
      </Box>
    )
  })
}
