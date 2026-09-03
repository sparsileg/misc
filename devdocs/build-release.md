# Photyx — Build & Release Reference

Living reference for building Photyx locally, producing installers for
Linux/Windows/macOS, and shipping releases (manually or via
CI). Update this doc whenever the build setup changes.

---

## 0. Project layout that matters for builds

Photyx is a **Cargo workspace**, not a single crate:

```
Photyx/                     <- workspace root Cargo.toml (members list only)
    Cargo.toml              <- [workspace], no [package], no version
    package.json            <- npm scripts, its own "version" field
    crates/photyx-xisf/     <- workspace member
    src-tauri/
        Cargo.toml          <- [package] version — THE version, since Issue 161
        tauri.conf.json     <- no "version" field (falls back to Cargo.toml)
        src/
    src-svelte/              <- SvelteKit frontend
    build/                   <- frontend build output (adapter-static), gitignored
```

**Important consequence:** because this is a workspace, `cargo
build`/`cargo check` — run from either the repo root or from
`src-tauri/` — resolve the workspace and put compiled output at the
**workspace root**: `Photyx/target/release/photyx`, *not*
`Photyx/src-tauri/target/...`. Keep this in mind for CI caching paths
and any script that looks for the binary.

### Version numbers that must not be confused

| File                        | Field               | Who reads it                                                                                                                                                                                  |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`      | `[package] version` | **Source of truth.** Cargo's own build output, `getVersion()` (via Tauri's fallback), `tauri-action`'s `__VERSION__` substitution                                                             |
| `src-tauri/tauri.conf.json` | `version`           | Deliberately **absent** (Issue 161) so it falls back to Cargo.toml. Do not re-add it unless you want to fork the two apart again                                                              |
| `package.json`              | `version`           | npm/Node tooling only (e.g. what `npm run tauri build`'s banner prints). Currently **not kept in sync** — cosmetic drift, harmless, but don't be surprised if it disagrees with the other two |

**SemVer only.** Cargo enforces strict SemVer on `[package] version` —
no bare suffixes like `0.11.0B`. Use a proper prerelease identifier
instead:

- `1.11.0-beta` / `1.11.0-beta.1` — beta builds
- `1.11.0-rc.1` — release candidate targeting release 1.11.0
- `1.11.0` — stable

**Windows MSI caveat (see §2):** the Windows Installer format only
accepts a *numeric-only* prerelease identifier (e.g. `0.11.0-1` would
be legal for MSI; `0.11.0-beta.1` is not, since `"beta"` isn't a
number). Rather than warp the version scheme for one installer format,
Photyx has dropped MSI entirely and ships NSIS only on Windows — see
§2's Windows section for the full reasoning.

---

## 1. Local development builds (no bundling)

For day-to-day iteration you almost never need a bundled installer.

**Hot-reload dev mode** (frontend + backend, auto-rebuild on save):

```bash
npm run tauri dev
```

**Rust-only correctness check** (fastest signal, no codegen/link, no
bundling):

```bash
pushd src-tauri && cargo check && popd
```

This is the right tool for "did I break the syntax" — much faster than
a full build because it skips code generation and linking entirely.

**Run the test suite** (e.g. the Issue 159 unit tests):

```bash
pushd src-tauri && cargo test && popd
# or a single module:
cargo test analyze_frames
```

**Full compiled binary, no installer:**

```bash
npm run tauri build -- --no-bundle && ./target/release/photyx
```

This runs the real `tauri build` pipeline (frontend build, Rust
release compile) but skips the platform-packaging step (`.deb`/`.exe`/
`.dmg`/etc.), so you get a runnable binary fast without producing
installers you don't need yet.

---

## 2. Platform-specific bundled builds

`tauri.conf.json`'s `bundle.targets` is an explicit list — `["deb",
"rpm", "appimage", "nsis", "app", "dmg"]` — rather than `"all"` (see
the Windows section below for why `msi` was dropped). A plain `npm run
tauri build` on any given platform still produces every installer type
*that list* supports for that platform, with no extra flags needed
once the platform's own toolchain is installed.

**You cannot meaningfully cross-compile Windows or macOS bundles from
Linux for this app.** Photyx links native C libraries (`cfitsio` via
`fitsio-sys`) and Tauri bundles are platform-native installers — both
defeat casual cross-compilation. Build Windows on a Windows machine
(or `windows-latest` CI runner) and macOS on a Mac (or a native-arch
CI runner — see the Intel note below). This is also why the GitHub
Actions workflow in §4 uses a build matrix instead of one job
cross-compiling everything.

### cfitsio linking: static on Linux/macOS, dynamic on Windows

Photyx links `cfitsio` through `fitsio-sys`. Which linking strategy
applies depends on platform, and this is enforced automatically via
per-platform dependency tables in `src-tauri/Cargo.toml` — you don't
need to do anything differently locally, but it's worth understanding
if a build ever behaves unexpectedly.

**Linux and macOS: static.** `fitsio-sys`'s `fitsio-src` + `src-cmake`
features compile `cfitsio` from source as part of the Rust build, so
the resulting binary has no runtime dependency on a system-installed
`libcfitsio`. This was adopted specifically to solve a cross-Ubuntu-
release SONAME mismatch (`libcfitsio9` on 22.04 vs `libcfitsio10t64`
on 24.04/26.04) that made Tauri's `.deb` bundler's auto-declared
dependencies wrong depending on which Ubuntu release built the package
vs which one ran it — Tauri's `.deb` bundler only ever auto-declares
webkit2gtk/gtk3/appindicator, never third-party libs like `cfitsio`,
so this had to be solved at the linking level rather than the bundler
level. Static linking also incidentally would have avoided the Windows
pkg-config gap and the macOS Intel cross-compile issue, had it been
tried on those platforms first — though Windows can't currently use it
(see below).

**Windows: dynamic (still).** CFITSIO's CMake build hardcodes
`-DUSE_PTHREADS=ON` but doesn't supply the `CMAKE_INCLUDE_PATH`/
`CMAKE_LIBRARY_PATH` pointing at a `pthreads-win32` install that its
own `README.win` says is required — MSVC has no native `pthread.h`.
Closing that gap would mean going deeper into `fitsio-sys` internals
than was worthwhile so far, so Windows keeps the vcpkg + pkg-config
dynamic-linking recipe described in the Windows section below.

```toml
# src-tauri/Cargo.toml
[target.'cfg(not(target_os = "windows"))'.dependencies]
fitsio-sys = { version = "...", features = ["fitsio-src", "src-cmake"] }

[target.'cfg(target_os = "windows")'.dependencies]
fitsio-sys = "..."   # dynamic, via vcpkg + pkg-config — see Windows section below
```

**Known gotcha: bzip2 duplicate symbols.** Statically-built `cfitsio`
bundles its own bzip2 stub. The `zip` crate's default feature set
pulls in `bzip2-sys`, and linking both together produces a
duplicate-symbol error at link time (`bz_internal_error`). Fixed by
disabling `zip`'s `bzip2` feature specifically:

```toml
zip = { version = "...", default-features = false, features = [...] }  # no "bzip2"
```

(Confirmed via grep that Photyx's own code has zero bzip2-zip usage,
so disabling the feature is safe.)

### Linux (primary dev platform)

System packages (Ubuntu/Debian; adjust for your distro):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf xdg-utils build-essential
```

Note: some newer Debian/Ubuntu releases have renamed
`libappindicator3-dev` to `libayatana-appindicator3-dev` — if the
package isn't found, try that name instead.

**No `libcfitsio-dev` needed.** As of the static-linking switch (see
§2's cfitsio linking section above), `fitsio-sys` compiles `cfitsio`
from source via CMake as part of the Rust build, so there's no system
`cfitsio` package to install — the workspace build handles it.
`build-essential` supplies the C compiler CMake needs; **unconfirmed
whether a system `cmake` package is also required** on a clean machine
— CI runners ship it preinstalled, so this hasn't been directly tested
on a bare local machine. If a fresh Linux build fails looking for
`cmake`, `sudo apt-get install -y cmake` is the likely fix.

```bash
npm run tauri build
```

Produces a `.deb`, an `.rpm`, and an `.AppImage` under
`target/release/bundle/` (workspace root — see §0). RPM bundling is
native to `tauri-bundler` (no system `rpmbuild` needed); confirmed
working in CI as of this writing, taking no extra time over the `.deb`
build.

### Windows

Needs: Visual Studio Build Tools (MSVC toolchain), and `cfitsio` via
vcpkg — matching your existing per-session vcpkg setup (`J:\vcpkg`).

```powershell
# One-time (or per session, per your existing notes):
vcpkg install cfitsio

npm run tauri build
```

Produces an **NSIS `.exe` installer only** under
`target/release/bundle/nsis/`.

**Why not MSI too:** `fitsio-sys`'s build script only ever probes via
the `pkg-config` binary — it has no native vcpkg-rs integration on
MSVC (an open, unimplemented upstream request:
github.com/simonrw/rust-fitsio/issues/178). So a working Windows build
needs `pkg-config.exe` present and pointed at wherever vcpkg generated
`cfitsio`'s `.pc` file — confirmed in CI via Chocolatey's
`pkgconfiglite` package plus an explicit `PKG_CONFIG_PATH`:

```powershell
choco install pkgconfiglite -y
$env:PKG_CONFIG_PATH = "C:\vcpkg\installed\x64-windows\lib\pkgconfig"
```

Separately, WiX (Tauri's MSI bundler) only accepts a *numeric-only*
prerelease identifier in the version string — `0.11.0-beta.1` fails
with `optional pre-release identifier in app version must be
numeric-only`. Rather than change the version scheme project-wide just
for one Windows installer format, `tauri.conf.json`'s `bundle.targets`
drops `msi` entirely (§0). NSIS has no such restriction and is a
common, legitimate installer format on its own.

If you want MSI back later, the tradeoff is real: either switch the
whole project's prerelease scheme to numeric-only tags (`0.11.0-1`
instead of `0.11.0-beta.1`, losing the readable label), or
special-case the version string passed to the MSI bundler specifically
— not attempted here.

### macOS

Needs: Xcode Command Line Tools. `cfitsio` itself no longer needs to
be installed via Homebrew or vcpkg — as of the static-linking switch
(see §2's cfitsio linking section above), `fitsio-sys` compiles
`cfitsio` from source via CMake as part of the Rust build.

```bash
npm run tauri build
```

Produces a `.app` bundle and `.dmg` under `target/release/bundle/`.

**Apple Silicon vs Intel:** by default this builds for the host
architecture only. To build both and ship separately (matching what
the GitHub Actions matrix in §4 does):

```bash
npm run tauri build -- --target aarch64-apple-darwin   # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin     # Intel
```

**Important:** the second command above only works if you're actually
*on* Intel hardware (or a real Intel VM). Cross-targeting x86_64 from
an Apple Silicon Mac is a genuine cross-compile for `fitsio-sys`'s C
dependency — Homebrew's `cfitsio` is architecture-native to whatever
machine installed it, so `pkg-config` correctly refuses to link an
arm64 library into an x86_64 binary. This bit the CI workflow directly
(see §4's `macos-15-intel` matrix entry) and applies identically to a
local build attempt. There's no universal-binary flag built into
`tauri build` either way — the two targets always ship as separate
`.dmg` files.

Since the MacOS package is not signed (yet), Gatekeeper will reject it
with an error when trying to install. You can try this command, assuming the app was
installed in the /Applications folder, to strip the qurantine
attribute recursively so Gatekeeper will stop blocking it.

```xattr
xattr -cr /Applications/photyx.app
```

---

## 3. Delivering releases on GitHub

Releases are built on **git tags**. `gh` (which you already use for
issues) is the fastest way to cut one, matching the tooling you
already have.

### Tag/version conventions

- Beta: `${TAG_NAME}` ↔ `0.11.0-beta.1`
- Release candidate: `v0.11.0-rc.1` ↔ `0.11.0-rc.1`
- Stable: `v0.11.0` (tag) ↔ `0.11.0` (Cargo.toml)

**Note:** By definition, any tag with `beta` or `rc` in it as shown above is considered a pre-release. To do a release, remove those suffixes and follow the steps below. Then you will be able to take advantage of things like the "latest-release" feature.

Keep the tag and `src-tauri/Cargo.toml`'s version in agreement — bump
Cargo.toml first, commit, *then* tag.

### Creating a release manually

```bash
# Must execute from the repo root
cd ~/github/Photyx

# Bump the version first
# edit src-tauri/Cargo.toml -> version = "0.11.0-beta.1"
git add src-tauri/Cargo.toml
git commit -m "Bump version to 0.11.0-beta.1"
git push

# Tag + release in one step (gh creates the tag if it doesn't exist)
gh release create ${TAG_NAME} \
  --title "${TAG_NAME}" \
  --generate-notes \
  --prerelease
```

### Creating a Beta or Release Candidate

`--prerelease` is what marks it as beta/RC rather than a stable
"Latest release" — do this for every beta and RC build. Drop the flag
only for an actual stable release (see §5).

### Attach Build Installers

So testers can download and run directly — append file paths after the flags:

```bash
gh release create ${TAG_NAME} \
  --title "${TAG_NAME}" \
  --notes "Beta build for external testing" \
  --prerelease \
  target/release/bundle/deb/photyx_${TAG_NAME}_amd64.deb \
  target/release/bundle/appimage/photyx_${TAG_NAME}_amd64.AppImage
```

### Automatically Generate Notes

Instead of writing notes by hand, the ```---generate-notes``` option summarizes
merged PRs/commits since the last tag.

```bash
gh release create ${TAG_NAME} --prerelease --generate-notes
```

### Draft First, Publish Later

Useful if you want to review before testers see it.

```bash
gh release create ${TAG_NAME} --prerelease --draft --notes "..."
# later, once ready:
gh release edit ${TAG_NAME} --draft=false
# start the workflow
gh workflow run release.yml
```

**Web UI equivalent**, if you'd rather click through: repo →
**Releases** (right sidebar) → **Draft a new release** → pick/create
the tag → title/notes → check **"Set as a pre-release"** for beta/RC →
drag installer files into the assets area → **Publish release**.

---

## 4. Automating builds with GitHub Actions

("Workers" — the actual term is **runners**: GitHub-hosted VMs —
Linux, Windows, macOS — that execute your workflow's **jobs**. A
**workflow** is the YAML file; each job runs on one runner and
executes a sequence of **steps**, each of which is either a shell
command or a reusable **action**.)

The standard, officially-recommended way to build + release a Tauri
app is
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action)
— it runs `tauri build` on each platform in a matrix, creates the
GitHub release, and uploads all the platform installers to it
automatically.

### Workflow file

The workflow file is named ```release.yml``` and is saved in your
repository root. See the Appendix for an example. Adjust the trigger
to match how you want to cut releases — this example triggers on
pushing a version tag (`v0.11.0`, `${TAG_NAME}`, etc.), which fits the
tagging convention in §3:

Notes specific to this workflow:

- **`__VERSION__` substitution** reads from `src-tauri/Cargo.toml`
  (since `tauri.conf.json`'s own `version` field was deliberately
  removed — Issue 161's fallback behavior applies here too, not just
  locally).
- **`prerelease` is computed from the tag name** — pushing
  `${TAG_NAME}` or `v0.11.0-rc.1` automatically marks the GitHub
  release as a pre-release; a plain `v0.11.0` doesn't. See §5 for how
  this interacts with promoting a beta to a stable release.
- **`releaseDraft: true`** — the workflow creates a draft release
  rather than publishing immediately, so you can review before testers
  see it (`gh release edit <tag> --draft=false` to publish).
- **Linux runner pinned to `ubuntu-22.04`**, not `ubuntu-latest` —
  matches current official Tauri guidance and avoids surprises when
  GitHub rolls `ubuntu-latest` forward to a new default image with
  different package names/versions available.

### Triggering it

```bash
# VERY IMPORTANT!
# Bump version in Cargo.toml and commit

git tag $TAG_NAME
git push origin $TAG_NAME
```

The workflow picks up the tag push automatically and does the rest.

If you have already created the tag and want to manually trigger the
action:

```bash
gh workflow run release.yml
```

### Iterating using the same tag

Sometimes there are errors on builds and you don't want to create a
new tag simply because of a configuration issue in `release.yml`, or
some other similar type of error. These are the steps to delete the
existing tag and restart the whole process using the same tag (version
number, essentially).

```bash
gh release list
git tag -l
# note the tag name

# delete remote tag
gh release delete $TAG_NAME --yes --cleanup-tag

# delete local tag (in case --cleanup-tag doesn't work)
git tag -d $TAG_NAME

# verify
gh release list
```

If that doesn't work, go one level deeper and delete by ID:

```bash
gh api repos/${REPO_OWNER}/${REPO_NAME}/releases --jq '.[] | select(.tag_name=="'"${TAG_NAME}"'") | {id, name, tag_name, draft, prerelease}'
# note the numeric ids — there can be more than one release sharing a
# tag_name if a draft was created separately from an already-published
# release under the same name; delete every id that comes back

gh api -X DELETE repos/${REPO_OWNER}/${REPO_NAME}/releases/<id_1>
gh api -X DELETE repos/${REPO_OWNER}/${REPO_NAME}/releases/<id_2>

# clear the tag itself — both remote and local. These are independent:
# git tag -d only ever affects your local clone, never GitHub.
git push origin :refs/tags/${TAG_NAME}
git tag -d ${TAG_NAME}

# verify BEFORE re-tagging — both must come back empty
gh release list
git ls-remote --tags origin | grep ${TAG_NAME}

# note that you can use the web UI to delete a release if all other
# efforts fail

# confirm the tag actually points where you think before waiting
# on the run
git rev-parse ${TAG_NAME}
git rev-parse main
```

The rev-parse commands are worth treating as mandatory, not optional
— a tag can silently point at a stale commit even after
"successful"-looking delete/recreate steps if any one of them was run
out of order or against a local ref that hadn't been
refreshed. Confirm the hashes actually match before assuming a re-run
will use your latest fix.

Return to the ```Triggering it`` section and try to set the tag again.

## First-time setup gotcha

The workflow's `GITHUB_TOKEN` only has **read** permissions by default
— you'll get a `Resource not accessible by integration` error
otherwise. Fix once, repo-wide: **Settings → Actions → General →
Workflow permissions → Read and write permissions**. Note that a
`GITHUB_TOKEN` is issued fresh per run using whatever this setting was
*at the moment the run started* — if a run's failure looks like this
error despite the setting already being correct, check whether that
particular run actually started before you saved the setting.

### If you outgrow this later

- **Arm Linux builds** (if ever needed): GitHub now offers
  `ubuntu-22.04-arm`/`ubuntu-24.04-arm` public runners that slot
  directly into the same matrix — no emulation needed for that
  architecture specifically.
- **Code signing** (removes "unidentified developer"/SmartScreen
  warnings on macOS/Windows): a separate, more involved setup — Tauri
  has dedicated guides for
  [macOS](https://v2.tauri.app/distribute/sign/macos/) and
  [Windows](https://v2.tauri.app/distribute/sign/windows/) signing if
  this becomes worth the overhead once beta testing wraps up.

### Downloading a release

**Via `gh` CLI** (downloads every asset from a release into your
current directory):

```bash
gh release download ${TAG_NAME}
```

Or just one file, by pattern:

```bash
gh release download ${TAG_NAME} --pattern "*.deb"
```

**Via browser** — repo → **Releases** → open the release → click the
asset filename under "Assets" to download it directly.

**Via a direct link**, if you know the exact asset filename (useful
for scripting, or testing on a different machine):

```bash
curl -LO https://github.com/sparsileg/Photyx/releases/download/v0.11.0-beta.1/photyx_0.11.0-beta.1_amd64.deb
```

Note this is `/releases/download/<tag>/<file>` — a *specific* version
— which is different from the `/releases/latest/download/<file>` URLs
set up in §5b. The `latest` form only resolves once a genuinely
stable, non-prerelease, non-draft release has been published; drafts
and prereleases are excluded from "latest" by design (see §5b).

**Installing what you downloaded** (Linux `.deb` example):

```bash
sudo apt install ./photyx_0.11.0-beta.1_amd64.deb
```

---

## 5. Promoting a pre-release to a full release

### 5a. Beta/RC → stable

The idiomatic path is to cut a **new** release under a stable version
number, not to relabel an existing beta build as stable. Reasons:

- A version string like `0.11.0-beta.3` is explicitly *not* the same
  thing as `0.11.0` in SemVer, and tools/testers that check for a
  prerelease suffix will keep treating it as one regardless of any
  flag you flip on GitHub's side.
- Relabeling an existing beta's binaries as the stable release means
  the exact bits your beta testers exercised are no longer traceable
  back to a specific beta tag — worth avoiding once you actually care
  about that history.

**Steps:**

```bash
cd ~/github/Photyx

# 1. Bump the version, dropping the prerelease suffix entirely
#    edit src-tauri/Cargo.toml -> version = "0.11.0"
git add src-tauri/Cargo.toml
git commit -m "Bump version to 0.11.0"
git push

# 2. Tag and push — no "-beta"/"-rc" in the tag this time
git tag v0.11.0
git push origin v0.11.0
```

The existing `release.yml` workflow handles the rest correctly with no
changes needed: `prerelease: ${{ contains(github.ref_name, '-beta') ||
contains(github.ref_name, '-rc') }}` evaluates to `false` for a plain
`v0.11.0` tag, so the resulting release is created as a proper stable
release (still as a draft, per `releaseDraft: true`).

**3. Publish it** — a draft is never visible to the public or
reachable via `/releases/latest` (see 5b) until published:

```bash
gh release edit v0.11.0 --draft=false
```

Once published, non-draft, and non-prerelease, this release
automatically becomes GitHub's "Latest release" (unless an even more
recent non-draft/non-prerelease release already exists — see 5b for
how to override this explicitly if needed).

**Discouraged shortcut, if you ever want it anyway:** you can directly
flip an existing beta release to non-prerelease without cutting a new
version, but this keeps the `-beta.N` string in both the tag and the
version metadata baked into the binaries, which looks confusing to
anyone downloading it later:

```bash
gh release edit v0.11.0-beta.3 --prerelease=false --draft=false --latest
```

Not recommended as your normal workflow — included here only because
it's possible, and it's better to know that explicitly than discover
it by accident.

### 5b. Stable "Latest version" download URLs per OS

GitHub provides a special, permanently-stable URL pattern for release
assets:

```
https://github.com/<owner>/<repo>/releases/latest/download/<exact-filename>
```

This always resolves to whatever file with that *exact* filename
exists on GitHub's current "latest" release — defined as the most
recent published release that is **not** a draft and **not** marked
prerelease (or whatever release you've explicitly pinned with `gh
release edit <tag> --latest`). Critically, **this deliberately
excludes your betas** — since every beta/RC in this workflow is both
`draft: true` initially and always `prerelease: true`, none of them
can ever become "latest," even after publishing. That's the correct,
intended behavior: you don't want a stable-looking permanent URL
quietly starting to serve beta binaries.

**The catch:** this URL pattern requires an *exact* filename match,
but Tauri's bundlers name every artifact with the version baked in
(e.g. `photyx_0.11.0_amd64.deb`), so the filename changes on every
release. To get a genuinely non-changing per-OS URL, the workflow
needs to additionally publish a second copy of each artifact under a
fixed, version-less filename.

This section is added as as additional steps at the end of the
`publish-tauri` job in `release.yml`, after the existing
`tauri-apps/tauri-action@v1` step. See the Appendix for an example.

Notes on this addition:

- Uses `find`/`Get-ChildItem` with a path/extension match rather than
  hardcoded version-specific filenames, since the exact filename
  changes every release and the aarch64 macOS build path differs from
  the native `macos-15-intel` build path
  (`target/<triple>/release/...`  vs `target/release/...`) — matching
  by pattern sidesteps needing to special-case that.
- `--clobber` is required — without it, `gh release upload` refuses to
  overwrite an asset that already has that filename, which every
  release after the first would hit.
- `gh` is pre-installed on all GitHub-hosted runners; `GH_TOKEN` (not
  `GITHUB_TOKEN` — that's the variable name `gh` itself looks for) is
  set the same way as `tauri-action`'s own auth.
- **The Windows NSIS output path/filename pattern here is inferred
  from Tauri's documented bundle layout, not directly confirmed
  against a successful build log as of this writing** — verify against
  the next clean Windows CI run and adjust the `Where-Object` filter
  if needed.
- This runs unconditionally on every tagged push, betas included —
  harmless, since a beta's fixed-name assets just sit inertly on a
  draft/prerelease release that `/releases/latest` will never resolve
  to anyway.

Once you've published a real stable release per 5a, these become your
permanent, never-changing per-OS download links:

```
https://github.com/sparsileg/Photyx/releases/latest/download/photyx-linux-x86_64.deb
https://github.com/sparsileg/photyx/releases/latest/download/photyx-linux-x86_64.rpm
https://github.com/sparsileg/photyx/releases/latest/download/photyx-linux-x86_64.AppImage
https://github.com/sparsileg/photyx/releases/latest/download/photyx-windows-x86_64.exe
https://github.com/sparsileg/photyx/releases/latest/download/photyx-macos-arm64.dmg
https://github.com/sparsileg/photyx/releases/latest/download/photyx-macos-x86_64.dmg
```

Link to these from a website, README, or documentation, and they'll
always serve whatever your most recent stable release actually is — no
link updates needed on future releases.

---

## 6.0 Deploying each project

### astryx-home

- Commit changes to Github
- cd to repo home (.../github/astryx-home)
- `npx wrangler deploy`

### photyx

* Update `src-tauri/Cargo.toml` and `package.json` with the correct version number

* Run a release build to validate release numbers are valid during the build and displayed on the UI

* Commit and push changes to Github; this should start the automatic build using a Github runner.

* If a release (not a beta or RC), find the latest builds at:
  
  * https://github.com/sparsileg/Photyx/releases/latest/download/photyx-linux-x86_64.deb
  
  * https://github.com/sparsileg/Photyx/releases/latest/download/photyx-windows-x86_64.exe

---

## Quick reference

| Task                                  | Command                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Hot-reload dev                        | `npm run tauri dev`                                                                                                    |
| Fast Rust check                       | `cd src-tauri && cargo check`                                                                                          |
| Run tests                             | `cd src-tauri && cargo test`                                                                                           |
| Local build, no installer             | `npm run tauri build -- --no-bundle`                                                                                   |
| Full bundled build (current platform) | `npm run tauri build`                                                                                                  |
| macOS: specific arch                  | `npm run tauri build -- --target aarch64-apple-darwin`                                                                 |
| Cut a beta/RC release (manual)        | `gh release create vX.Y.Z-beta.N --prerelease --generate-notes`                                                        |
| Cut a beta/RC release (CI)            | `git tag vX.Y.Z-beta.N && git push origin vX.Y.Z-beta.N`                                                               |
| Promote beta → stable                 | Bump src-tauri/Cargo.toml & package.json, drop suffix, tag `vX.Y.Z`, push, then `gh release edit vX.Y.Z --draft=false` |
| Publish a draft release               | `gh release edit vTAG --draft=false`                                                                                   |

## Appendix - `release.yml`

```yaml
name: 'release'

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  publish-tauri:
    # cfitsio is compiled from source on Linux/macOS (fitsio-src +
    # src-cmake features on the fitsio-sys dependency, Cargo.toml,
    # platform-gated) rather than relying on a system package — this
    # assumes `cmake` is present on the Linux/macOS GitHub-hosted runner
    # images. Standard/pre-installed as of this writing, but not
    # independently re-verified for this exact workflow — if a build
    # fails looking for a CMake generator or the cmake binary itself,
    # that's the first thing to check. Windows stays on dynamic linking
    # via vcpkg (see that step's own comment for why) and doesn't need
    # cmake at all.
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'   # Apple Silicon
            args: '--target aarch64-apple-darwin'
          - platform: 'macos-15-intel'   # Intel — native Intel hardware, NOT a
                                          # cross-compile from arm64. Homebrew's
                                          # cfitsio is architecture-native to
                                          # whatever runner installs it, so
                                          # cross-targeting x86_64 from an arm64
                                          # macos-latest runner fails pkg-config's
                                          # cross-compile check. GitHub retired
                                          # the old Intel runners (macos-13) in
                                          # Dec 2025; macos-15-intel is the
                                          # current replacement, planned to be
                                          # retired itself around Aug 2027.
            args: ''
          - platform: 'ubuntu-22.04'
            args: ''
          - platform: 'windows-latest'
            args: ''

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v7

      - name: install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
            patchelf xdg-utils
        # cfitsio is no longer a system dependency — fitsio-sys builds it
        # from source (fitsio-src + src-cmake features in Cargo.toml),
        # statically linked into the binary. See Cargo.toml comment.
        #
        # No separate rpm/rpmbuild package is needed either. tauri.conf.json's
        # bundle.targets includes "rpm" alongside "deb" and "appimage" —
        # tauri-bundler builds RPM natively in Rust, not by shelling out to a
        # system rpmbuild. This job already produces target/release/bundle/rpm/
        # with no changes required.
        #
        # Known upstream caveat (tauri-apps/tauri#11478, unresolved as of
        # writing): RPM bundling has been reported to hang indefinitely
        # on some Ubuntu 22.04 setups after the .deb finishes in seconds.
        # No confirmed root cause or workaround yet — if a Linux job runs
        # unusually long compared to the others, check whether it's stuck
        # specifically on the rpm bundle step before assuming something
        # else broke.

      - name: install Windows dependencies (vcpkg + cfitsio)
        if: matrix.platform == 'windows-latest'
        run: |
          vcpkg install cfitsio
          choco install pkgconfiglite -y
          echo "VCPKG_ROOT=$env:VCPKG_INSTALLATION_ROOT" >> $env:GITHUB_ENV
          echo "PKG_CONFIG_PATH=C:\vcpkg\installed\x64-windows\lib\pkgconfig" >> $env:GITHUB_ENV
        shell: pwsh
        # Windows stays on dynamic linking (see Cargo.toml's fitsio-sys
        # target-specific sections) — the fitsio-src+src-cmake static
        # build fails on MSVC because CFITSIO's CMake build requires an
        # external pthreads-win32 install (CMAKE_INCLUDE_PATH/
        # CMAKE_LIBRARY_PATH pointing at it) that fitsio-sys's build.rs
        # never supplies, and that gap wasn't resolved. This exact
        # vcpkg+pkgconfiglite recipe is confirmed working — it got all
        # the way to a built photyx.exe before failing at MSI bundling
        # over the non-numeric prerelease version string, a separate,
        # already-fixed issue (bundle.targets dropped msi).
        #
        # fitsio-sys only ever probes via the `pkg-config` binary — it has
        # no native vcpkg-rs integration on MSVC (open upstream request,
        # never implemented: github.com/simonrw/rust-fitsio/issues/178).
        # So installing cfitsio via vcpkg is necessary but not sufficient:
        # windows-latest has no pkg-config.exe by default, and even with
        # one present, it needs to be pointed at wherever vcpkg put
        # cfitsio's generated .pc file. pkgconfiglite is the standard
        # Chocolatey package providing pkg-config.exe on Windows.
        # PKG_CONFIG_PATH here assumes vcpkg's classic-mode install
        # layout (\installed\\lib\pkgconfig).

      - name: stage vcpkg runtime DLLs for bundling (Windows)
        if: matrix.platform == 'windows-latest'
        run: |
          New-Item -ItemType Directory -Force -Path src-tauri\resources | Out-Null
          Copy-Item "$env:VCPKG_INSTALLATION_ROOT\installed\x64-windows\bin\*.dll" src-tauri\resources\
        shell: pwsh
        # Copies EVERY dll vcpkg produced for this triplet, rather than
        # hardcoding cfitsio.dll by name. Confirmed necessary: the
        # cfitsio.dll built on GitHub's windows-latest runner depends on
        # a dll named z.dll, but a local vcpkg install (different
        # baseline/version) produces the equivalent zlib dependency named
        # zlib1.dll instead — same underlying library, different vcpkg
        # port revision naming it differently. Copying the whole bin/
        # directory sidesteps needing to track that naming by hand, and
        # protects against the same drift happening again on a future
        # runner image update or any other transitive dependency vcpkg
        # decides to add later (e.g. if cfitsio's feature set changes).

      - name: stage MSVC redistributable DLLs for bundling (Windows)
        if: matrix.platform == 'windows-latest'
        run: |
          New-Item -ItemType Directory -Force -Path src-tauri\resources | Out-Null
          $crtDirs = Get-ChildItem "C:\Program Files*\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT" -Directory -ErrorAction SilentlyContinue
          if (-not $crtDirs) {
            Write-Error "No MSVC redist CRT directory found — runner image layout may have changed."
            exit 1
          }
          foreach ($dir in $crtDirs) {
            Copy-Item (Join-Path $dir.FullName "vcruntime140*.dll") src-tauri\resources\ -Force
          }
        shell: pwsh
        # photyx.exe and cfitsio.dll both depend on vcruntime140.dll,
        # which is NOT part of Windows itself — it ships with the MSVC
        # redistributable, so a user without VS/the VC++ Redistributable
        # already installed would hit the same "DLL not found" failure
        # we just fixed for cfitsio.dll/z.dll, just for this DLL instead.
        # (The api-ms-win-crt-*.dll imports seen in dumpbin output are
        # the Universal CRT, which HAS shipped as part of Windows itself
        # since Windows 10 — those are not a real risk and don't need
        # staging.)
        #
        # The redist path is intentionally NOT hardcoded to one MSVC
        # toolset version (e.g. 14.50.35710) — that exact version number
        # changes essentially every time GitHub updates the windows-latest
        # runner image (confirmed via a real prior break: a runner update
        # once shifted a VS2019 install from 14.29.30133 to 14.29.30156).
        # The glob spans VS year/edition/toolset-version so this keeps
        # working across future runner image updates without edits here.
        #
        # NOTE: -Filter cannot be combined with a wildcarded -Path in
        # PowerShell's Get-ChildItem — it silently returns nothing rather
        # than erroring (confirmed directly: same wildcard path with
        # -Filter *.dll came back empty even though the files were
        # present). Resolving the directory first via -Directory, then
        # copying a concrete-path glob within it, avoids that gotcha.
        # Dynamic linking (see the step above) means cfitsio.dll is never
        # part of photyx.exe itself — Tauri has to be told to bundle it as
        # a resource, via src-tauri/tauri.windows.conf.json's
        # bundle.resources entry ("resources/cfitsio.dll"), or NSIS ships
        # only the exe and the app fails at runtime with "cfitsio.dll was
        # not found". That config expects the file to already exist at
        # src-tauri/resources/cfitsio.dll by the time tauri-action runs,
        # which is what this step stages. Uses VCPKG_INSTALLATION_ROOT
        # (set by the previous step) rather than a hardcoded C:\vcpkg
        # path, since GitHub's windows-latest runners preinstall vcpkg at
        # a path stored in that env var, not necessarily C:\vcpkg.
        #
        # UNVERIFIED: cfitsio.dll may itself dynamically depend on other
        # vcpkg-built DLLs (e.g. zlib), which would need the same
        # staging treatment. Check with a PE dependency tool (e.g.
        # `dumpbin /dependents` or Dependencies.exe) against the actual
        # built DLL before assuming this single-file fix is complete.

      - name: setup node
        uses: actions/setup-node@v6
        with:
          node-version: lts/*
          cache: 'npm'

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          # x86_64-apple-darwin no longer needs cross-target installation
          # here — macos-15-intel builds it natively.
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          # Photyx is a Cargo workspace — target/ lives at the repo root,
          # not inside src-tauri/. This differs from Tauri's default
          # single-crate template (which uses 'src-tauri -> target').
          workspaces: '. -> target'

      - name: install frontend dependencies
        run: npm install

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: 'Photyx v__VERSION__'
          releaseBody: 'See the assets below to download and install this version.'
          releaseDraft: true
          # NOTE: github.ref_name is the pushed tag on a tag-push trigger
          # (e.g. v0.11.0-beta.1), but on a manual `gh workflow run` /
          # workflow_dispatch run there is no tag ref — ref_name falls
          # back to the branch name (e.g. "main"), so this check silently
          # never matches "-beta"/"-rc" on manual runs. Trigger real
          # releases via tag push (git tag vX.Y.Z && git push origin
          # vX.Y.Z) so this evaluates correctly; use workflow_dispatch
          # only for build-testing, and double-check the resulting
          # release's prerelease flag by hand if you do.
          prerelease: ${{ contains(github.ref_name, '-beta') || contains(github.ref_name, '-rc') }}
          args: ${{ matrix.args }}
```

## Appendix - `Latest Release`

This section is added as as additional steps at the end of the
`publish-tauri` job in `release.yml`, after the existing
`tauri-apps/tauri-action@v1` step.

```yaml
      - name: publish fixed-name "latest" asset (Linux)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          find target -path "*bundle/deb/*.deb" -exec cp {} photyx-linux-x86_64.deb \;
          find target -path "*bundle/rpm/*.rpm" -exec cp {} photyx-linux-x86_64.rpm \;
          find target -path "*bundle/appimage/*.AppImage" -exec cp {} photyx-linux-x86_64.AppImage \;
          gh release upload ${{ github.ref_name }} \
            photyx-linux-x86_64.deb photyx-linux-x86_64.rpm photyx-linux-x86_64.AppImage \
            --clobber
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: publish fixed-name "latest" asset (Windows)
        if: matrix.platform == 'windows-latest'
        shell: pwsh
        run: |
          $exe = Get-ChildItem -Path target -Recurse -Filter *.exe |
            Where-Object { $_.FullName -like "*bundle*nsis*" } |
            Select-Object -First 1
          Copy-Item $exe.FullName photyx-windows-x86_64.exe
          gh release upload ${{ github.ref_name }} photyx-windows-x86_64.exe --clobber
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: publish fixed-name "latest" asset (macOS)
        if: matrix.platform == 'macos-latest' || matrix.platform == 'macos-15-intel'
        run: |
          ARCH_NAME="${{ matrix.platform == 'macos-latest' && 'arm64' || 'x86_64' }}"
          find target -path "*bundle/dmg/*.dmg" -exec cp {} "photyx-macos-${ARCH_NAME}.dmg" \;
          gh release upload ${{ github.ref_name }} "photyx-macos-${ARCH_NAME}.dmg" --clobber
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
