# sysadmin

System administration scripts for the Linux workstation.

## drive-health.sh

A plain-English SMART health report for SATA SSDs, NVMe SSDs, hard drives and USB drives. For each drive it shows the key SMART readings, lists findings by severity, and ends with a verdict. A summary table of all drives comes last.

It was written for checking the drives in a RAID array and the USB backup drive, so the verdicts are worded that way:

- **Internal drives** get *HEALTHY: OK to use in the array*, *USABLE, WATCH IT*, or *FAILING: do not put this drive in the array*.
- **USB drives** count as the backup drive and are judged more strictly. Any warning means *REPLACE NOW*, because it holds every backup. A drive that's fine but has a flaky connection (resets, timeouts) gets *DRIVE OK, CONNECTION FLAKY* instead.

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

USB drives are read with `smartctl -d sat` (SMART pass-through). Some USB enclosures don't pass SMART through, and the report then says *smartctl could not read this drive*. Try a different enclosure, or connect the drive by SATA.
