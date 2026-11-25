# rclone: Backblaze B2 in Dolphin

Mounts every B2 bucket at `~/cloud/b2` **on demand**, so the buckets can be browsed in Dolphin like folders (the Linux stand-in for Cyberduck). Start it when you need it and stop it when you're done; it's not mounted at login. It's a systemd **user** service, so no sudo is needed.

Keeping it mounted only when needed avoids the risks of an always-present mount in your home folder: tools that walk `~` (`du`, `find`, backups, indexers) would otherwise wander into every bucket, and a stray `rm -rf` could reach them.

For archiving finished projects, use [`sysadmin/archive-to-b2`](../sysadmin/README.md#archive-to-b2) instead. It verifies every file; the mount doesn't.

## Files and where they go

| File | Install to | What it is |
|---|---|---|
| `rclone-b2.service` | `~/.config/systemd/user/` | Mounts the `b2` remote at `~/cloud/b2` when started; unmounts when stopped or at logout |
| two aliases | `~/.bashrc` | `b2-mount` and `b2-umount` (see below) |

It also needs an rclone remote named `b2` in `~/.config/rclone/rclone.conf`. **That file holds the B2 key: never commit it.**

## Install

```bash
sudo apt install rclone fuse3

# 1. Create the "b2" remote (once): n → name b2 → Backblaze B2 → keyID + applicationKey
#    of an *application* key (not the master key) → hard_delete false → no advanced config
rclone config
rclone lsd b2:              # should list your buckets

# 2. Install the service (don't "enable" it: that would mount it at every login)
cd ~/github/misc/rclone
install -Dm644 rclone-b2.service ~/.config/systemd/user/rclone-b2.service
systemctl --user daemon-reload

# 3. Add the aliases to ~/.bashrc, then open a new terminal
cat >> ~/.bashrc <<'ALIASES'
alias b2-mount='systemctl --user start rclone-b2 && ls ~/cloud/b2'
alias b2-umount='systemctl --user stop rclone-b2'
ALIASES
```

## Use

```bash
b2-mount       # mount; lists the buckets in ~/cloud/b2
b2-umount      # unmount when done
```

While it's mounted, it shows up in Dolphin under **Network** (or browse to `~/cloud/b2`). Dolphin's eject button on that entry unmounts it too.

The aliases are shorthand for `systemctl --user start rclone-b2` and `systemctl --user stop rclone-b2`. Other useful commands:

```bash
systemctl --user status rclone-b2          # is it mounted?
systemctl --user restart rclone-b2         # after changing the rclone config
journalctl --user -u rclone-b2             # its log
```

It stays mounted until you stop it or log out. Files copied in through the mount upload in the background, so give them a moment to finish before `b2-umount` (it waits for them).

To have it mount at every login instead: `systemctl --user enable rclone-b2` (undo with `disable`). If the network isn't up yet at login, it retries every 30 seconds.

## Things to know

- **The top level is your list of buckets.** Making a folder there creates a bucket, and deleting one deletes the whole bucket. Inside a bucket, folders behave normally.
- **Deleting a file hides it** rather than erasing it, because the remote has `hard_delete = false`. B2 keeps it as an old version until the bucket's lifecycle rule ("keep prior versions for N days") removes it.
- `--vfs-cache-mode writes` keeps files you save in `~/.cache/rclone` until they've finished uploading. For large uploads, `rclone copy -P` (or `archive-to-b2`) is faster and more reliable than copying through the mount.
- Browsing is slower than a local drive, since each folder listing asks B2. Listings are cached for 5 minutes (`--dir-cache-time 5m`).
- `b2-snapshots-…` is a bucket Backblaze creates for its snapshot feature. Leave it alone.

## Uninstall

```bash
systemctl --user disable --now rclone-b2
rm ~/.config/systemd/user/rclone-b2.service
systemctl --user daemon-reload
# and remove the b2-mount / b2-umount lines from ~/.bashrc
```
