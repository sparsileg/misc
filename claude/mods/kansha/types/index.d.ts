export type TestsState = 'ok' | 'stale' | 'never'

/** One file that carries the app's version, and what it says */
export type VersionFile = { path: string; version: string | null }

export type RepoStatus = {
  versions: VersionFile[]
  branch: string
  uncommitted: number
  unpushed: number
  /** just check */
  tests: TestsState
  testedAt: number | null
  /** just perf */
  perf: TestsState
  perfAt: number | null
  checkedAt: number
}

/** A push the guard held back, keyed on the HEAD commit it would ship */
export type PushWaiting = { version: string; head: string }

/** Stan's one-time approval for exactly that HEAD, until expiresAt */
export type PushApproval = { version: string; head: string; expiresAt: number }

export type PushState = { waiting: PushWaiting | null; approved: PushApproval | null }

/** One /ship step as the pane shows it */
export type ShipStepState = 'todo' | 'running' | 'ok' | 'failed'

export type ShipStep = { label: string; state: ShipStepState; detail: string | null }

/** A /ship run: its steps, and the tail of the output that failed one */
export type ShipRun = {
  steps: ShipStep[]
  output: string[]
  /** Once every check passed: what "ship it" tells Claude to do */
  plan: string | null
}

/** A release CI is building from a pushed tag, until Stan publishes it */
export type ReleaseWatch = {
  tag: string
  state: 'building' | 'built' | 'failed' | 'published'
  url: string | null
}

/** A rule break on a line Claude added, until the line is fixed or gone */
export type LintFinding = { file: string; line: number; text: string; message: string }

/** Something awaiting Stan's test, or a reminder dated YYYY-MM-DD */
export type TrackerItem = { id: string; kind: 'test' | 'reminder' | 'decide'; label: string; text: string; due?: string }

declare module 'claude-code' {
  interface PluginState {
    kansha: {
      status: RepoStatus | null
      push: PushState
      ship: ShipRun | null
      release: ReleaseWatch | null
      lint: LintFinding[]
      tracker: TrackerItem[]
    }
  }
}
