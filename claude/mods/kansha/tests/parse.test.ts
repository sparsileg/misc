import { describe, expect, test } from 'claude-code/testing'

import {
  addedLines,
  fingerprintText,
  isFullTestCommand,
  isGitPush,
  isGuardedPush,
  isKanshaPush,
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
  parseStagedHashes,
  parseTracker,
  parseVersionTest,
  pushedTag,
  pushNeedsTests,
  rustTestStart,
  setCargoVersion,
  setJsonVersion,
  setLockVersion,
  setPackageLockVersion,
  setVersionTest,
  splitTracker,
  versionsAgree,
  wrapHanging,
} from '../hooks/parse'

describe('kansha versions', () => {
  test('reads each version file', async () => {
    expect(parseJsonVersion('{\n  "name": "kansha",\n  "version": "0.10.0",\n')).toBe('0.10.0')
    expect(parseCargoVersion('[workspace]\nmembers = []\n\n[workspace.package]\nversion = "0.10.0"\n')).toBe('0.10.0')
    expect(parseCargoVersion('[workspace]\n')).toBe(null)
    expect(parseVersionTest('  it("is 0.12.0", () => {\n    expect(v).toBe("0.12.0");\n')).toBe('0.12.0')
    expect(parseVersionTest('describe("version", () => {})\n')).toBe(null)
  })

  test('agree only when every file has the same version', async () => {
    expect(versionsAgree(['0.10.0', '0.10.0', '0.10.0'])).toBe('0.10.0')
    expect(versionsAgree(['0.10.0', '0.10.1'])).toBe(null)
    expect(versionsAgree(['0.10.0', null])).toBe(null)
    expect(versionsAgree([])).toBe(null)
  })

  test('patch and minor', async () => {
    expect(nextVersion('0.10.0', 'patch')).toBe('0.10.1')
    expect(nextVersion('0.10.4', 'minor')).toBe('0.11.0')
    expect(nextVersion('0.10', 'patch')).toBe(null)
  })

  test('rewrites only the app version lines', async () => {
    const pkg = '{\n  "name": "kansha",\n  "version": "0.10.0",\n  "devDependencies": { "vite": { "version": "6" } }\n}'
    expect(setJsonVersion(pkg, '0.10.1')).toBe(pkg.replace('"0.10.0"', '"0.10.1"'))
    const lock =
      '{\n  "name": "kansha",\n  "version": "0.10.0",\n  "packages": {\n    "": {\n      "name": "kansha",\n      "version": "0.10.0",\n' +
      '    "node_modules/x": {\n      "version": "1.0.0"'
    expect(setPackageLockVersion(lock, 'kansha', '0.10.1')).toBe(lock.replaceAll('"0.10.0"', '"0.10.1"'))
    const cargo = '[workspace.package]\nversion = "0.10.0"\n\n[workspace.dependencies]\nfoo = { version = "2" }\n'
    expect(setCargoVersion(cargo, '0.11.0')).toBe(cargo.replace('0.10.0', '0.11.0'))
    const cargoLock =
      '[[package]]\nname = "kansha"\nversion = "0.10.0"\n\n[[package]]\nname = "kansha-core"\nversion = "0.10.0"\n'
    expect(setLockVersion(setLockVersion(cargoLock, 'kansha', '0.10.1'), 'kansha-core', '0.10.1')).toBe(
      cargoLock.replaceAll('0.10.0', '0.10.1'),
    )
    const versionTest =
      'describe("version", () => {\n  it("agree", () => {\n    expect(a).toEqual(b);\n  });\n\n' +
      '  it("is 0.11.0", () => {\n    expect((JSON.parse(PACKAGE) as { version: string }).version).toBe("0.11.0");\n  });\n});\n'
    expect(setVersionTest(versionTest, '0.12.0')).toBe(versionTest.replaceAll('0.11.0', '0.12.0'))
  })
})

describe('kansha test status', () => {
  test('only just check counts as the full check; just perf as perf', async () => {
    expect(isFullTestCommand('just check')).toBe(true)
    expect(isFullTestCommand(' just check 2>&1')).toBe(true)
    expect(isFullTestCommand('just test-rust')).toBe(false)
    expect(isFullTestCommand('just check && git push')).toBe(false)
    expect(isFullTestCommand('just check | tail')).toBe(false)
    expect(isPerfCommand('just perf')).toBe(true)
    expect(isPerfCommand('just perf 2>&1')).toBe(true)
    expect(isPerfCommand('just perf | tail')).toBe(false)
  })

  test('fingerprint ignores listing order', async () => {
    const a = parseStagedHashes('100644 aaa 0\tsrc/a.ts\n100644 bbb 0\tcrates/b.rs\n')
    const b = parseStagedHashes('100644 bbb 0\tcrates/b.rs\n100644 aaa 0\tsrc/a.ts\n')
    expect(fingerprintText(a)).toBe(fingerprintText(b))
    expect(a.get('src/a.ts')).toBe('aaa')
  })
})

describe('kansha push and ship', () => {
  test('finds a push wherever it sits', async () => {
    expect(isGitPush('git push')).toBe(true)
    expect(isGitPush('git push origin main v0.10.1')).toBe(true)
    expect(isGitPush('git commit -m x && git push')).toBe(true)
    expect(isGitPush('git -C /repo push')).toBe(true)
    expect(isGitPush('git status')).toBe(false)
    expect(isGitPush('git push-helper')).toBe(false)
    expect(isGitPush('grep "git push" notes.md')).toBe(false)
  })

  test('holds only pushes that ship commits or tags', async () => {
    expect(isGuardedPush('git push')).toBe(true)
    expect(isGuardedPush('git push origin main v0.10.1')).toBe(true)
    expect(isGuardedPush('git commit -m x && git push')).toBe(true)
    expect(isGuardedPush('git push origin --delete release-test')).toBe(false)
    expect(isGuardedPush('git push -d origin old')).toBe(false)
    expect(isGuardedPush('git push origin :old')).toBe(false)
    expect(isGuardedPush('git branch -D x && git push origin --delete x')).toBe(false)
    expect(isGuardedPush('git push origin --delete x && git push origin main')).toBe(true)
    expect(isGuardedPush('git push origin --delete x; git push')).toBe(true)
    expect(isGuardedPush("python3 - <<'EOF'\nprint('a && git push')\nEOF\necho done")).toBe(false)
    expect(isGuardedPush("cat <<EOF\ntext\nEOF\ngit push")).toBe(true)
    expect(isGuardedPush('git status')).toBe(false)
  })

  test('reads the optional bump', async () => {
    expect(parseShipArgs('')).toEqual({ bump: null })
    expect(parseShipArgs(' minor ')).toEqual({ bump: 'minor' })
    expect(parseShipArgs('patch')).toEqual({ bump: 'patch' })
    expect(parseShipArgs('major')).toBe(null)
    expect(parseShipArgs('patch now')).toBe(null)
  })

  test('finds the tag a push sends', async () => {
    expect(pushedTag('git push origin main v0.10.1')).toBe('v0.10.1')
    expect(pushedTag('git push origin refs/tags/v0.11.0')).toBe('v0.11.0')
    expect(pushedTag('git push origin main')).toBe(null)
  })

  test('ship it, and only that', async () => {
    expect(isShipIt('ship it')).toBe(true)
    expect(isShipIt(' Ship it! ')).toBe(true)
    expect(isShipIt('should I ship it?')).toBe(false)
  })

  test('keeps the last lines of output', async () => {
    expect(lastLines('a\n\nb\nc\n', 2)).toEqual(['b', 'c'])
  })
})

describe('kansha rule linter', () => {
  const core = 'crates/kansha-core/src/ledger/post.rs'

  test('flags Rust rule breaks outside tests', async () => {
    expect(lintLine(core, 'let v = r.unwrap();')).toEqual(['.unwrap() outside tests: return an error'])
    expect(lintLine(core, 'let v = r.unwrap();', true)).toEqual([])
    expect(lintLine(core, 'let v = r.expect("x");').length).toBe(1)
    expect(lintLine(core, 'unsafe { x() }')).toEqual(['unsafe: not allowed'])
    expect(lintLine(core, 'let rate: f64 = 0.5;').length).toBe(1)
    expect(lintLine(core, '// was: r.unwrap()')).toEqual([])
    expect(lintLine('src-tauri/src/cli.rs', 'dbg!(x);')).toEqual(['dbg!: remove it'])
  })

  test('SQL only in persistence', async () => {
    expect(lintLine(core, 'conn.execute("DELETE FROM txn", [])?;')).toEqual([
      'SQL outside persistence: only persistence issues SQL',
    ])
    expect(lintLine('crates/kansha-core/src/persistence/txn.rs', 'conn.execute("DELETE FROM txn", [])?;')).toEqual([])
  })

  test('the real time only in the clock', async () => {
    expect(lintLine(core, 'let today = chrono::Local::now().date_naive();').length).toBe(1)
    expect(lintLine('crates/kansha-core/src/date.rs', 'Date(chrono::Local::now().date_naive())')).toEqual([])
  })

  test('front end: no JS Date, no console.log', async () => {
    expect(lintLine('src/lib/state/a.svelte.ts', 'const d = new Date(s);').length).toBe(1)
    expect(lintLine('src/App.svelte', '  console.log(x);').length).toBe(1)
    expect(lintLine('src/lib/a.test.ts', 'const d = new Date(s);')).toEqual([])
    expect(lintLine('src/App.svelte', '<!-- new Date( -->')).toEqual([])
  })

  test('migrations', async () => {
    expect(isMigration('crates/kansha-core/src/persistence/migrations/0019_pending_entries.sql')).toBe(true)
    expect(isMigration('crates/kansha-core/src/persistence/migrate.rs')).toBe(false)
  })

  test('finds the lines an edit added', async () => {
    expect(addedLines('a\nb\nc', 'a\nb2\n\nc\nd')).toEqual([2, 5])
    expect(rustTestStart('fn a() {}\n#[cfg(test)]\nmod tests {}')).toBe(2)
    expect(rustTestStart('fn a() {}')).toBe(Infinity)
  })
})

describe('kansha tracker and open items', () => {
  test('splits the tracker by due date', async () => {
    const items = parseTracker(
      JSON.stringify({
        items: [
          { id: 'a', kind: 'reminder', label: 'A', text: 'past', due: '2026-10-09' },
          { id: 'b', kind: 'reminder', label: 'B', text: 'ahead', due: '2026-10-20' },
          { id: 'c', kind: 'test', label: 'C', text: 'try it' },
          { id: 'd', kind: 'reminder', label: 'D', text: 'undated' },
          { id: 'e', kind: 'decide', label: 'E', text: 'settle it' },
        ],
      }),
    )
    const { due, waiting, later, decide } = splitTracker(items, '2026-10-10')
    expect(due.map(i => i.id)).toEqual(['a', 'd'])
    expect(waiting.map(i => i.id)).toEqual(['c'])
    expect(later.map(i => i.id)).toEqual(['b'])
    expect(decide.map(i => i.id)).toEqual(['e'])
    expect(parseTracker('not json')).toEqual([])
    expect(localDate(new Date(2026, 9, 31, 12).getTime(), 1)).toBe('2026-11-01')
  })

  test('lists open items with the project board', async () => {
    const tracker = splitTracker([{ id: 'c', kind: 'test', label: 'C', text: 'try it' }], '2026-10-10')
    const board = parseBoard(
      JSON.stringify({
        items: [
          { content: { number: 7 }, title: 'Fix it', labels: ['bug'], status: 'To Do' },
          { content: { number: 9 }, title: 'Later', status: 'To Do' },
          { content: { number: 8 }, title: 'Busy', status: 'In progress' },
          { content: { number: 3 }, title: 'Parked', status: 'Deferred' },
          { content: { number: 2 }, title: 'Old', status: 'Done' },
          { content: {}, title: 'Draft note', status: 'To Do' },
        ],
      }),
    )
    expect(openItemsText(tracker, board, ['In progress', 'To Do'], 'Done', 80)).toBe(
      'AWAITING YOUR TEST (1)\n  C: try it\n\nISSUES: IN PROGRESS (1)\n  #8 Busy\n\n' +
        'ISSUES: TO DO (2)\n  #9 Later\n  #7 Fix it  [bug]\n\nNot listed: Deferred (1)',
    )
    expect(parseBoard('HTTP 401')).toBe(null)
    expect(openItemsText(tracker, null, ['To Do'], 'Done', 80)).toContain('could not read the project board')
    expect(wrapHanging('  #7 one two three four', 12, 2)).toEqual(['  #7 one two', '    three', '    four'])
  })

  test('list-mods aligns descriptions past the longest name', () => {
    const features = [
      { name: '/bump', does: 'bump every version', runs: '/bump patch|minor' },
      { name: 'Push guard', does: 'holds pushes', runs: 'automatic' },
    ]
    expect(listModsText(features, 80)).toBe(
      'KANSHA MODS (2)\n  /bump       bump every version [/bump patch|minor]\n  Push guard  holds pushes [automatic]',
    )
  })
})

describe('pushNeedsTests', () => {
  const tested = ['crates', 'src-tauri', 'src', 'tests', 'package.json', 'Cargo.toml', 'justfile']
  test('docs-only commits skip tests', () => {
    expect(pushNeedsTests(['devdocs/tax-planning-design.md'], tested, null)).toBe(false)
    expect(pushNeedsTests(['README.md', 'guide/kansha-guide.pdf'], tested, null)).toBe(false)
    expect(pushNeedsTests([], tested, null)).toBe(false)
  })
  test('tested code needs tests', () => {
    expect(pushNeedsTests(['devdocs/x.md', 'crates/kansha-core/src/lib.rs'], tested, null)).toBe(true)
    expect(pushNeedsTests(['package.json'], tested, null)).toBe(true)
    expect(pushNeedsTests(['justfile'], tested, null)).toBe(true)
  })
  test('path prefix is a whole folder name', () => {
    expect(pushNeedsTests(['src-docs/notes.md'], ['src'], null)).toBe(false)
    expect(pushNeedsTests(['srcfile.md'], ['src'], null)).toBe(false)
  })
  test('a tag or an unknown upstream needs tests', () => {
    expect(pushNeedsTests(['devdocs/x.md'], tested, 'v1.0.0')).toBe(true)
    expect(pushNeedsTests(null, tested, null)).toBe(true)
  })
})

describe('isKanshaPush', () => {
  const kansha = 'https://github.com/sparsileg/kansha.git'
  const misc = 'https://github.com/sparsileg/misc.git'
  test('the Kansha repo is guarded', () => {
    expect(isKanshaPush('git push', kansha)).toBe(true)
    expect(isKanshaPush('git push', 'git@github.com:sparsileg/kansha.git')).toBe(true)
    expect(isKanshaPush('git push', 'https://github.com/sparsileg/kansha')).toBe(true)
  })
  test('other repos pass', () => {
    expect(isKanshaPush('git push', misc)).toBe(false)
    expect(isKanshaPush('git push', '')).toBe(false)
    expect(isKanshaPush('git push', 'https://github.com/sparsileg/kansha-site.git')).toBe(false)
    expect(isKanshaPush("git commit -F - <<'EOF'\nkansha mod: x\nEOF\ngit push", misc)).toBe(false)
  })
  test('a push into Kansha from elsewhere is guarded', () => {
    expect(isKanshaPush('cd ~/github/kansha && git push', misc)).toBe(true)
    expect(isKanshaPush('git -C /home/stan/github/kansha push', '')).toBe(true)
  })
})
