import { describe, expect, test } from 'claude-code/testing'

import {
  wrapHanging,
  openItemsText,
  parseBoard,
  localDate,
  parseTracker,
  splitTracker,
  hasName,
  parseTutorialTargets,
  selectorNames,
  addedLines,
  lintLine,
  rustTestStart,
  isShipIt,
  pushedTag,
  lastLines,
  parseShipArgs,
  fingerprintText,
  isFullTestCommand,
  parseAppVersion,
  parseCargoVersion,
  parseStagedHashes,
} from '../hooks/parse'

describe('astryx parsing', () => {
  test('reads both version numbers', async () => {
    expect(parseAppVersion("    APP_VERSION: '1.16.4',")).toBe('1.16.4')
    expect(parseCargoVersion('[package]\nname = "astryx"\nversion = "1.16.4"\n')).toBe('1.16.4')
    expect(parseCargoVersion('[package]\nname = "x"\n')).toBe(null)
  })

  test('only the full suite counts as a pass', async () => {
    expect(isFullTestCommand('just test')).toBe(true)
    expect(isFullTestCommand(' just check ')).toBe(true)
    expect(isFullTestCommand('just test-js')).toBe(false)
    expect(isFullTestCommand('just test && git push')).toBe(false)
  })

  test('fingerprint ignores listing order', async () => {
    const a = parseStagedHashes('100644 aaa 0\tsrc/js/a.js\n100644 bbb 0\tsrc/js/b.js\n')
    const b = parseStagedHashes('100644 bbb 0\tsrc/js/b.js\n100644 aaa 0\tsrc/js/a.js\n')
    expect(fingerprintText(a)).toBe(fingerprintText(b))
    expect(a.get('src/js/a.js')).toBe('aaa')
  })
})

import { nextVersion, setAppVersion, setCargoVersion, setLockVersion } from '../hooks/parse'

describe('astryx bump', () => {
  test('patch and minor', async () => {
    expect(nextVersion('1.16.4', 'patch')).toBe('1.16.5')
    expect(nextVersion('1.16.4', 'minor')).toBe('1.17.0')
    expect(nextVersion('1.16', 'patch')).toBe(null)
  })

  test('rewrites only the package version lines', async () => {
    expect(setAppVersion("    APP_VERSION: '1.16.4',", '1.16.5')).toBe("    APP_VERSION: '1.16.5',")
    const cargo = '[package]\nname = "astryx"\nversion = "1.16.4"\n\n[dependencies]\nfoo = { version = "2" }\n'
    expect(setCargoVersion(cargo, '1.17.0')).toBe(cargo.replace('1.16.4', '1.17.0'))
    const lock = '[[package]]\nname = "aaa"\nversion = "1.16.4"\n\n[[package]]\nname = "astryx"\nversion = "1.16.4"\n'
    expect(setLockVersion(lock, 'astryx', '1.16.5')).toBe(
      '[[package]]\nname = "aaa"\nversion = "1.16.4"\n\n[[package]]\nname = "astryx"\nversion = "1.16.5"\n',
    )
  })
})

import { isGitPush } from '../hooks/parse'

describe('astryx push detection', () => {
  test('finds a push wherever it sits', async () => {
    expect(isGitPush('git push')).toBe(true)
    expect(isGitPush('git push origin main')).toBe(true)
    expect(isGitPush('git commit -m x && git push')).toBe(true)
    expect(isGitPush('git -C /repo push')).toBe(true)
    expect(isGitPush('timeout 10 git push')).toBe(true)
    expect(isGitPush('GIT_TERMINAL_PROMPT=0 git push --dry-run')).toBe(true)
    expect(isGitPush('git status')).toBe(false)
    expect(isGitPush('git push-helper')).toBe(false)
    expect(isGitPush('grep "git push" notes.md')).toBe(false)
  })
})

import { diffSnapshotFile, isSnapshotUpdate } from '../hooks/parse'

describe('astryx snapshot guard', () => {
  test('spots an update', async () => {
    expect(isSnapshotUpdate('just update-snapshots')).toBe(true)
    expect(isSnapshotUpdate('UPDATE_SNAPSHOTS=1 node --test tests/*.test.js')).toBe(true)
    expect(isSnapshotUpdate('just test')).toBe(false)
  })

  test('reports moved values by snapshot and path', async () => {
    const before = JSON.stringify({ a: { targets: [{ subs: 44 }] }, b: { x: 1 }, gone: 1 })
    const after = JSON.stringify({ a: { targets: [{ subs: 45 }] }, b: { x: 1 }, fresh: 2 })
    const diffs = diffSnapshotFile('f.json', before, after)
    expect(diffs.length).toBe(3)
    const moved = diffs.find(d => d.name === 'a')
    expect(moved?.changes[0]).toEqual({ path: 'targets[0].subs', before: '44', after: '45' })
    expect(diffs.find(d => d.name === 'gone')?.kind).toBe('removed')
    expect(diffs.find(d => d.name === 'fresh')?.kind).toBe('added')
  })

  test('reads the ship target and optional bump', async () => {
    expect(parseShipArgs('web')).toEqual({ target: 'web', bump: null })
    expect(parseShipArgs(' web  minor ')).toEqual({ target: 'web', bump: 'minor' })
    expect(parseShipArgs('')).toBe(null)
    expect(parseShipArgs('web major')).toBe(null)
    expect(parseShipArgs('web patch now')).toBe(null)
    expect(parseShipArgs('both patch')).toEqual({ target: 'both', bump: 'patch' })
    expect(parseShipArgs('desktop')).toEqual({ target: 'desktop', bump: null })
    expect(parseShipArgs('mobile')).toBe(null)
  })

  test('keeps the last lines of output', async () => {
    expect(lastLines('a\n\nb\nc\n', 2)).toEqual(['b', 'c'])
  })

  test('finds the tag a push sends', async () => {
    expect(pushedTag('git push origin v1.16.5')).toBe('v1.16.5')
    expect(pushedTag('git push origin main v1.7.0-beta.1')).toBe('v1.7.0-beta.1')
    expect(pushedTag('git push origin refs/tags/v2.0.0')).toBe('v2.0.0')
    expect(pushedTag('git push origin main')).toBe(null)
  })

  test('ship it, and only that', async () => {
    expect(isShipIt('ship it')).toBe(true)
    expect(isShipIt(' Ship it! ')).toBe(true)
    expect(isShipIt('should I ship it?')).toBe(false)
  })

  test('flags rule breaks by file kind', async () => {
    expect(lintLine('src/js/a.js', 'const x = y || 0;')).toEqual(['use ?? for a default, not ||'])
    expect(lintLine('src/js/a.js', 'if (a || b) {')).toEqual([])
    expect(lintLine('src/js/a.js', '// was: x || 0')).toEqual([])
    expect(lintLine('src/index.html', '<div style="color: red">')).toEqual([
      "inline style: put it in the module's CSS file",
    ])
    expect(lintLine('src/js/v.js', "el.style.display = 'none';").length).toBe(1)
    expect(lintLine('src/js/v.js', 'el.style.left = `${x}px`;')).toEqual([])
    expect(lintLine('src/include/pdfmake.js', 'x || 0')).toEqual([])
    expect(lintLine('src-tauri/src/a.rs', 'let v = r.unwrap();').length).toBe(1)
    expect(lintLine('src-tauri/src/a.rs', 'let v = r.unwrap();', true)).toEqual([])
    expect(lintLine('tests/a.test.js', 'x || 0')).toEqual([])
  })

  test('finds the lines an edit added', async () => {
    expect(addedLines('a\nb\nc', 'a\nb2\n\nc\nd')).toEqual([2, 5])
    expect(rustTestStart('fn a() {}\n#[cfg(test)]\nmod tests {}')).toBe(2)
    expect(rustTestStart('fn a() {}')).toBe(Infinity)
  })

  test('reads tutorial steps and what their selectors need', async () => {
    const text = [
      "    id: 'settings',",
      '    steps: [',
      '        {',
      "            id: 'welcome',",
      '            target: null,',
      '        },',
      '        {',
      "            id: 'open-menu',",
      "            target: '#system-menu-btn',",
      '        },',
    ].join('\n')
    expect(parseTutorialTargets(text)).toEqual([
      { tutorial: 'settings', step: 2, stepId: 'open-menu', selector: '#system-menu-btn' },
    ])
    expect(selectorNames('#a-b .c [data-action="x.y"]')).toEqual(['a-b', 'c', 'x.y'])
    expect(hasName('<div id="theme-dropdown-menu">', 'theme-dropdown')).toBe(false)
    expect(hasName("getElementById('theme-dropdown')", 'theme-dropdown')).toBe(true)
  })

  test('splits the tracker by due date', async () => {
    const items = parseTracker(
      JSON.stringify({
        items: [
          { id: 'a', kind: 'reminder', label: 'A', text: 'past', due: '2026-10-09' },
          { id: 'b', kind: 'reminder', label: 'B', text: 'ahead', due: '2026-10-20' },
          { id: 'c', kind: 'test', label: 'C', text: 'try it' },
          { id: 'd', kind: 'reminder', label: 'D', text: 'undated' },
        ],
      }),
    )
    const { due, waiting, later } = splitTracker(items, '2026-10-10')
    expect(due.map(i => i.id)).toEqual(['a', 'd'])
    expect(waiting.map(i => i.id)).toEqual(['c'])
    expect(later.map(i => i.id)).toEqual(['b'])
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
    expect(wrapHanging('  short', 12, 2)).toEqual(['  short'])
  })
})

import { listModsText } from '../hooks/parse'

describe('list-mods', () => {
  test('aligns descriptions past the longest name and wraps under them', () => {
    const features = [
      { name: '/bump', does: 'bump both versions', runs: '/bump patch|minor' },
      { name: 'Push guard', does: 'holds pushes to main', runs: 'automatic' },
    ]
    expect(listModsText(features, 80)).toBe(
      'ASTRYX MODS (2)\n  /bump       bump both versions [/bump patch|minor]\n  Push guard  holds pushes to main [automatic]',
    )
    expect(listModsText(features, 30).split('\n').slice(1, 3)).toEqual(['  /bump       bump both', '              versions [/bump'])
  })
})

