# sysadmin

System administration scripts for the Linux workstation.

## archive-to-b2

Copies one finished project folder to a Backblaze B2 bucket, and optionally to the USB backup drive, then verifies every file by checksum.

```bash
archive-to-b2 /mnt/vault/D-projects/NGC7635-Bubble-Nebula sparsile-astrophotography
archive-to-b2 --usb /mnt/vault/D-projects/NGC7635-Bubble-Nebula sparsile-astrophotography
archive-to-b2 -n --usb ...     # preview only, nothing is sent
```

The folder goes to the top level of the bucket under its own name:

| | Destination |
|---|---|
| B2 | `b2:sparsile-astrophotography/NGC7635-Bubble-Nebula` |
| USB (`--usb`) | `/mnt/backup/Astrophotography-Archive/NGC7635-Bubble-Nebula` |

What it does:

1. Checks the bucket can be opened and, with `--usb`, that the USB drive really is mounted (it refuses to write to the system drive if the drive is unplugged).
2. Shows a preview for each destination (files to copy, already there, and any that exist with a different size and would be replaced) and asks before going ahead.
3. Copies with `rclone copy`, with progress.
4. Verifies with `rclone check` (SHA-1 on B2, MD5 on the USB drive) and prints **VERIFIED** or **VERIFY FAILED** for each destination.
5. Saves a log to `~/.local/state/archive-to-b2/<date>-<folder>.log`.

It is safe to run again: it never deletes anything on either side (copy, not sync), never touches the source, and a second run sends only what's missing. Removing the project from the vault afterwards is left to you, once both copies say VERIFIED.

Options: `--usb`, `-n`/`--dry-run`, `-y`/`--yes` (no confirmation), `-h`/`--help`. Settings via environment variables: `ARCHIVE_REMOTE` (default `b2`), `ARCHIVE_USB_DIR` (default `/mnt/backup/Astrophotography-Archive`), `ARCHIVE_LOG_DIR`.

### Setup

- **rclone** with a remote named `b2` that uses a B2 application key (`sudo apt install rclone`, then `rclone config`).
- **The USB drive at `/mnt/backup`.** An fstab entry with `x-systemd.automount` mounts it when it's first used, and `nofail` means boot doesn't wait if it's unplugged. `x-systemd.idle-timeout` unmounts it when idle, so it's usually safe to unplug:

  ```
  UUID=<drive UUID>  /mnt/backup  ntfs3  uid=1000,gid=1000,noatime,nofail,x-systemd.automount,x-systemd.idle-timeout=10min,x-systemd.device-timeout=5s  0 0
  ```

- **Put it on the PATH:** `ln -s ~/github/misc/sysadmin/archive-to-b2 ~/.local/bin/`

**Note on the USB check:** right after copying, Linux may serve the files from memory, so the USB verify proves the data was written correctly but not necessarily that it reads back from the disk. For a full re-read later (after unplugging and replugging), run `rclone check <project folder> /mnt/backup/Astrophotography-Archive/<name>`.

## drive-health.sh

A plain-English SMART health report for SATA SSDs, NVMe SSDs, hard drives and USB drives. For each drive it shows the key SMART readings, lists findings by severity, and ends with a verdict. A summary table of all drives comes last.

It was written for checking the drives in a RAID array and the USB backup drive, so the verdicts are worded that way:

- **Internal drives** get *HEALTHY: OK to use in the array*, *USABLE, WATCH IT*, or *FAILING: do not put this drive in the array*.
- **USB drives** count as the backup drive and are judged more strictly. Any warning means *REPLACE NOW*, because it holds every backup. A drive that's fine but has a flaky connection (resets, timeouts) gets *DRIVE OK, CONNECTION FLAKY* instead.
- **Any drive whose SMART data can't be read** gets *UNKNOWN*. The report doesn't guess; it says why and how to fix it.

### Requirements

```bash
sudo apt install smartmontools jq
```

Run it as root. If you run it without sudo, it re-launches itself with sudo.

### Usage

```bash
sudo ./drive-health.sh                  # check every drive
sudo ./drive-health.sh sda nvme0        # check only these drives
sudo ./drive-health.sh --test short     # run SMART self-tests first, then report
sudo ./drive-health.sh --read-test sdb  # also read the whole drive end to end
```

Drives can be named as `sda`, `nvme0`, `nvme1n1`, `/dev/sda`, or a full `/dev/disk/by-id/...` path. Give the whole drive, not a partition (`sda`, not `sda1`). If none are given, every drive in `/dev/disk/by-id` is checked.

| Option | What it does |
|---|---|
| `--test short\|long` | Runs a SMART self-test on each drive and waits for it to finish. *short* takes 1–2 minutes. *long* takes 10–30 minutes on an SSD and can take 4+ hours on a 2 TB USB hard drive. |
| `--read-test` | Reads the whole drive with `dd` (read-only, safe). Reports the average speed and any unreadable areas. It catches bad areas SMART hasn't noticed yet, and the Samsung 840 EVO slowdown when reading old data. It takes as long as reading the full drive. |
| `--no-history` | Doesn't save this run or compare against earlier ones. |
| `--no-color` | Plain output, for saving to a file. Color is off automatically when output isn't a terminal. |
| `-h`, `--help` | Shows the help. |

To keep a copy of a report:

```bash
sudo ./drive-health.sh --no-color | tee ~/drive-health-$(date +%F).txt
```

### History: spotting drives that are getting worse

Each run saves the drive's raw SMART data to:

```
/var/lib/drive-health/<serial>/<YYYY-MM-DD_HHMMSS>.json
```

The next run compares against the most recent saved file and flags any error counter that grew since then (reallocated or pending sectors, uncorrectable errors, program/erase fails, CRC errors, NVMe media errors, percentage used, ...). **A count that keeps growing is a stronger warning sign than one that's non-zero but stable.** The first run on a drive just saves a baseline.

A good habit is to run it before and after heavy work (filling an array, a big copy) and every so often, so there's history to compare against. Set `DRIVE_HEALTH_STATE_DIR` to keep the history somewhere else.

### What it checks

- The drive's own overall health assessment, and any attribute at or below its failure threshold
- Reallocated, pending and uncorrectable sectors, program/erase fails, used reserve blocks, CRC (cable) errors
- NVMe critical warnings (spare low, read-only mode, reliability degraded), media errors, spare capacity, percentage used
- Wear: remaining flash endurance, and data written compared with the drive's rated TBW
- Temperature, power-on hours, the self-test log and the error log
- Kernel log errors for the drive since this boot: read/write errors (the drive) versus resets and timeouts (usually the cable, port or USB enclosure)
- Known issues: Samsung 840 EVO firmware older than EXT0DB6Q; head load cycles and shock events on portable hard drives

### Customizing

The `RATED_TBW` table near the top of the script holds each model's rated endurance in TB written. Add your own drives there. Models that aren't listed are judged on their own wear indicator instead. The `Force MP600` entry assumes the 500 GB model (850 TBW); change it if a different size is installed.

### USB drives

USB drives are read with `smartctl -d sat` (SMART pass-through). Some USB enclosures don't pass SMART through under the newer `uas` driver, and the report then says *UNKNOWN*. Many of them do under the older `usb-storage` driver. The report prints the exact commands for the drive's USB ID; for example, for a Seagate Backup Plus Slim (`0bc2:ab24`):

```bash
# Try it (lasts until reboot): unmount the drive first, then unplug and replug it after this
echo 0bc2:ab24:u | sudo tee /sys/module/usb_storage/parameters/quirks

# If smartctl can now read it, make it permanent
echo 'options usb-storage quirks=0bc2:ab24:u' | sudo tee /etc/modprobe.d/seagate-backup-no-uas.conf
sudo update-initramfs -u
```

`usb-storage` has a little more overhead than `uas`, which doesn't matter for a hard drive. If SMART still can't be read, use `--read-test` and the kernel-log checks to keep an eye on the drive.

Seagate drives pack three counters into attribute 188 (command timeouts): all timeouts, those over 5 s, and those over 7.5 s. The report decodes it, e.g. `40 (14 over 5 s, 13 over 7.5 s)`, and tracks the total from run to run.
