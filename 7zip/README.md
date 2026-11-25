# 7-Zip right-click menu for Dolphin (KDE Plasma 6)

Adds 7-Zip entries to the top level of Dolphin's right-click menu.

On any file or folder:

- **Compress to .7z (7-Zip)**
- **Compress to .tar.gz**

On archives (.7z, .zip, .rar, .tar.gz/.xz/.zst/.bz2, .iso, ...):

- **Extract here (7-Zip)**
- **Extract to folder (7-Zip)**: extracts into a new folder named after the archive
- **Test archive (7-Zip)**: checks the archive and waits for Enter so you can read the result

Each action runs in a Konsole window so you can watch the progress. On success the window closes and a desktop notification appears. If something fails, the window stays open showing the error.

Archive names come from the selection. A single item uses its own name (`M42/` → `M42.7z`, `img.fits` → `img.7z`). Several items use the name of the folder they're in. An existing archive is never added to or overwritten; the new one is named `M42 (2).7z` instead.

## Files and where they go

| File | Install to | What it is |
|---|---|---|
| `dolphin-7z` | `~/.local/bin/dolphin-7z` | Script that runs 7z/tar for the menu entries |
| `7zip-compress.desktop` | `~/.local/share/kio/servicemenus/` | Menu entries for compressing |
| `7zip-extract.desktop` | `~/.local/share/kio/servicemenus/` | Menu entries for extracting and testing |

All three must be **executable**. Dolphin ignores service menu files that aren't. No sudo is needed; everything is per-user.

## Install

```bash
sudo apt install 7zip konsole libnotify-bin   # 7z, Konsole, notify-send

cd ~/github/misc/7zip
install -Dm755 dolphin-7z            ~/.local/bin/dolphin-7z
install -Dm755 7zip-compress.desktop ~/.local/share/kio/servicemenus/7zip-compress.desktop
install -Dm755 7zip-extract.desktop  ~/.local/share/kio/servicemenus/7zip-extract.desktop
```

Then close every Dolphin window and reopen it.

The `.desktop` files call the script as `~/.local/bin/dolphin-7z`. If you install it somewhere else, change the `Exec=` lines to match.

## Hide Ark's own entries (optional)

Ark adds its own **Compress** (zip / tar.gz) and **Extract** entries. To leave only these, open **Dolphin → Settings → Configure Dolphin → Context Menu** and uncheck Ark's **Compress** (and **Extract** if you like).

## Uninstall

```bash
rm ~/.local/bin/dolphin-7z ~/.local/share/kio/servicemenus/7zip-{compress,extract}.desktop
```

## Notes

- **Extract to folder** on an archive that already contains a top-level folder gives `M42/M42/...`, the same as Windows 7-Zip. Use **Extract here** for those.
- If extracting would overwrite a file, 7-Zip asks in the Konsole window.
- To change the menu text or icons, edit the `Name=` and `Icon=` lines in the `.desktop` files. `X-KDE-Priority=TopLevel` is what keeps the entries out of Dolphin's **Actions** submenu.
