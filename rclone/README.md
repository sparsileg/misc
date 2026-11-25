# rclone: Backblaze B2 in Dolphin

Mounts every B2 bucket at `~/cloud/b2` whenever you're logged in, so the buckets can be browsed in Dolphin like folders (the Linux stand-in for Cyberduck). It's a systemd **user** service, so no sudo is needed.

For archiving finished projects, use [`sysadmin/archive-to-b2`](../sysadmin/README.md#archive-to-b2) instead. It verifies every file; the mount doesn't.

## Files and where they go

| File | Install to | What it is |
|---|---|---|
| `rclone-b2.service` | `~/.config/systemd/user/` | Mounts the `b2` remote at `~/cloud/b2` at login, unmounts at logout |

It also needs an rclone remote named `b2` in `~/.config/rclone/rclone.conf`. **That file holds the B2 key: never commit it.**

## Install

```bash
sudo apt install rclone fuse3

# 1. Create the "b2" remote (once): n → name b2 → Backblaze B2 → keyID + applicationKey
#    of an *application* key (not the master key) → hard_delete false → no advanced config
rclone config
rclone lsd b2:              # should list your buckets

# 2. Install and start the mount
cd ~/github/misc/rclone
install -Dm644 rclone-b2.service ~/.config/systemd/user/rclone-b2.service
systemctl --user daemon-reload
systemctl --user enable --now rclone-b2
ls ~/cloud/b2               # one folder per bucket
```

Then in Dolphin, drag `~/cloud/b2` into **Places**.

## Use

```bash
systemctl --user status rclone-b2          # is it running?
systemctl --user restart rclone-b2         # after changing the rclone config
systemctl --user disable --now rclone-b2   # turn it off (and unmount)
journalctl --user -u rclone-b2             # its log
```

If the network isn't up yet at login, the service retries every 30 seconds.

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
```
