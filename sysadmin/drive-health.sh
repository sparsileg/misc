#!/usr/bin/env bash
# drive-health.sh: SMART health report for SATA SSDs, NVMe SSDs, hard drives and USB drives.
#
# Usage:
#   ./drive-health.sh [options] [drive ...]
#
# Name drives by their device name: sda, sdb, nvme0, nvme1n1 (/dev/sda or a full
# /dev/disk/by-id path also works). With no drives given, every drive is checked.
# USB drives are read with "-d sat" (SMART pass-through over USB) and are
# treated as the BACKUP drive. Any problem with the backup drive means "replace it now".
#
# Options:
#   --test short|long   Run a SMART self-test on each drive first and wait for it to finish.
#                       short: about 1–2 minutes.  long: SSDs 10–30 min, a 2 TB USB HDD can take 4+ hours.
#   --read-test         Read the whole drive end to end (read-only, safe). Reports speed and read errors.
#                       Catches unreadable areas that SMART hasn't noticed yet, and the 840 EVO
#                       slowdown when reading old data.
#   --no-history        Don't save or compare against earlier runs.
#   --no-color          Plain output, for saving to a file.
#   -h, --help          Show this help.
#
# Each run saves the raw SMART data to /var/lib/drive-health/<serial>/. The next run
# compares against it and flags any error counter that has grown. A growing count is a
# stronger warning sign than a stable non-zero one.

set -u

# ── Settings ─────────────────────────────────────────────────────────────────
STATE_DIR="${DRIVE_HEALTH_STATE_DIR:-/var/lib/drive-health}"
SMARTCTL="${SMARTCTL:-smartctl}"

# Rated endurance (TB written). Add your own models here. Drives not listed are judged
# on their own wear indicator (Samsung Wear_Leveling_Count, NVMe "Percentage Used").
declare -A RATED_TBW=(
  ["Samsung SSD 850 EVO 250GB"]=75
  ["Samsung SSD 850 EVO 500GB"]=150
  ["Samsung SSD 990 EVO 1TB"]=600
  ["Samsung SSD 990 EVO 2TB"]=1200
  # Corsair reports no capacity in the model name. 850 TBW is the 500GB rating;
  # 1TB = 1800, 2TB = 3600. Change this if a different-size MP600 is installed.
  ["Force MP600"]=850
)

# ── Arguments ────────────────────────────────────────────────────────────────
ORIG_ARGS=("$@")
TEST_TYPE=""; READ_TEST=0; HISTORY=1; COLOR=1; DRIVES=()
while (($#)); do
  case $1 in
    --test) TEST_TYPE=${2:-}; shift
            [[ $TEST_TYPE == short || $TEST_TYPE == long ]] || { echo "--test needs 'short' or 'long'" >&2; exit 2; } ;;
    --test=*) TEST_TYPE=${1#*=}
            [[ $TEST_TYPE == short || $TEST_TYPE == long ]] || { echo "--test needs 'short' or 'long'" >&2; exit 2; } ;;
    --read-test) READ_TEST=1 ;;
    --no-history) HISTORY=0 ;;
    --no-color) COLOR=0 ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    *) DRIVES+=("$1") ;;
  esac
  shift
done

if [[ $EUID -ne 0 && -z ${DRIVE_HEALTH_NOROOT:-} ]]; then
  exec sudo -- "$0" "${ORIG_ARGS[@]}"
fi

for cmd in "$SMARTCTL" jq awk; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd (sudo apt install smartmontools jq)" >&2; exit 1; }
done

[[ -t 1 ]] || COLOR=0
if ((COLOR)); then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; D=$'\e[2m'; C=$'\e[36m'; N=$'\e[0m'
else
  R=; G=; Y=; B=; D=; C=; N=
fi

# ── Drive discovery ──────────────────────────────────────────────────────────
# Every whole disk under /dev/disk/by-id, one entry per physical drive.
ALL_IDS=()
declare -A seen=()
for p in /dev/disk/by-id/ata-* /dev/disk/by-id/usb-* /dev/disk/by-id/nvme-* /dev/disk/by-id/scsi-*; do
  [[ -e $p ]] || continue
  n=${p##*/}
  # skip partitions and alternate NVMe names; duplicates like "<name>_1" are removed by the
  # realpath check below (the plain name sorts first)
  [[ $n =~ -part[0-9]+$ || $n == nvme-eui.* || $n == nvme-nvme.* ]] && continue
  real=$(readlink -f "$p")
  [[ -n ${seen[$real]:-} ]] && continue
  seen[$real]=$p
  ALL_IDS+=("$p")
done
# sort by kernel name: sda, sdb, ..., nvme0n1, nvme1n1
mapfile -t ALL_IDS < <(for p in "${ALL_IDS[@]}"; do r=$(readlink -f "$p"); printf '%s\t%s\n' "${r##*/}" "$p"; done | sort -V | cut -f2)

# Turn a short name (sda, /dev/sda, nvme0, nvme0n1) or a by-id path into the by-id path.
resolve_drive() {
  local arg=$1 name
  if [[ $arg == */dev/disk/* && -e $arg ]] || [[ $arg == /* && -e $arg && ! -b $arg ]]; then echo "$arg"; return; fi
  name=${arg#/dev/}
  [[ $name =~ ^nvme[0-9]+$ ]] && name+="n1"             # nvme0 -> nvme0n1
  if [[ $name =~ ^(sd[a-z]+[0-9]+|nvme[0-9]+n[0-9]+p[0-9]+)$ ]]; then
    local whole=${name%%[0-9]*}; [[ $name == nvme* ]] && whole=${name%p*}
    echo "'$arg' is a partition. Give the whole drive instead: $whole" >&2
    return 1
  fi
  if [[ ! -b /dev/$name ]]; then
    echo "No such drive: '$arg'. Drives on this system: $(for i in "${ALL_IDS[@]}"; do r=$(readlink -f "$i"); printf '%s ' "${r##*/}"; done)" >&2
    return 1
  fi
  if [[ -n ${seen[/dev/$name]:-} ]]; then echo "${seen[/dev/$name]}"
  else echo "/dev/$name"; fi                              # no by-id link: use the device directly
}

if ((${#DRIVES[@]} == 0)); then
  DRIVES=("${ALL_IDS[@]}")
else
  resolved=()
  for d in "${DRIVES[@]}"; do r=$(resolve_drive "$d") || exit 2; resolved+=("$r"); done
  DRIVES=("${resolved[@]}")
fi
((${#DRIVES[@]})) || { echo "No drives found." >&2; exit 1; }

# ── Helpers ──────────────────────────────────────────────────────────────────
JSON=""
jqr()       { jq -r "$1" <<<"$JSON" 2>/dev/null; }
attr_raw()  { jq -r --argjson id "$1" '[.ata_smart_attributes.table[]? | select(.id==$id) | .raw.value][0] // empty' <<<"$JSON"; }
attr_norm() { jq -r --argjson id "$1" '[.ata_smart_attributes.table[]? | select(.id==$id) | .value][0] // empty' <<<"$JSON"; }
attr_rawstr() { jq -r --argjson id "$1" '[.ata_smart_attributes.table[]? | select(.id==$id) | .raw.string][0] // empty' <<<"$JSON"; }
human_bytes() { awk -v b="$1" 'BEGIN{ split("B KB MB GB TB PB",u," "); i=1; while (b>=1000 && i<6){b/=1000;i++}; printf (i>3?"%.2f %s":"%.0f %s"), b, u[i] }'; }
hours_str()   { awk -v h="$1" 'BEGIN{ printf "%d h (%.1f years powered on)", h, h/8766 }'; }

is_usb() {  # true if the drive is connected over USB
  [[ ${1##*/} == usb-* ]] && return 0
  local r; r=$(readlink -f "$1"); readlink -f "/sys/class/block/${r##*/}" 2>/dev/null | grep -q '/usb[0-9]'
}
smart_opts() {  # extra smartctl options for a drive
  is_usb "$1" && echo "-d sat"
}

tag() {
  case $1 in
    OK)   printf '%s' "${G}[  OK  ]${N}" ;;
    INFO) printf '%s' "${C}[ INFO ]${N}" ;;
    WARN|LINK) printf '%s' "${Y}[ WARN ]${N}" ;;
    FAIL) printf '%s' "${R}[ FAIL ]${N}" ;;
    *)    printf '%s' "${D}[  --  ]${N}" ;;
  esac
}
row() { printf "  %-34s %-34s %s\n" "$1" "$2" "$(tag "$3")"; }

FINDINGS=()
add() { FINDINGS+=("$1|$2"); }   # severity: INFO WARN LINK FAIL   (LINK = cable/enclosure, not the drive)

# Report a counter that should be zero. Usage: zero_counter <label> <value> <sev-if-nonzero> <explanation>
zero_counter() {
  local label=$1 val=$2 sev=$3 why=$4
  [[ -z $val ]] && return
  if ((val > 0)); then row "$label" "$val" "$sev"; add "$sev" "$label = $val. $why"
  else row "$label" "$val" OK; fi
}

# ── Self-tests ───────────────────────────────────────────────────────────────
selftest_remaining() {  # prints remaining % if a test is running, nothing otherwise
  local j; j=$($SMARTCTL -j -c -l selftest $(smart_opts "$1") "$1" 2>/dev/null)
  jq -r '
    if (.nvme_self_test_log.current_self_test_operation.value // 0) != 0 then
      (100 - (.nvme_self_test_log.current_self_test_completion_percent // 0)) | tostring
    elif ((.ata_smart_data.self_test.status.value // 0) / 16 | floor) == 15 then
      (.ata_smart_data.self_test.status.remaining_percent // 0) | tostring
    else empty end' <<<"$j" 2>/dev/null
}

run_selftests() {
  echo "${B}Starting ${TEST_TYPE} SMART self-test on ${#DRIVES[@]} drive(s)...${N}"
  local d started=()
  for d in "${DRIVES[@]}"; do
    if $SMARTCTL -t "$TEST_TYPE" $(smart_opts "$d") "$d" >/dev/null 2>&1; then
      started+=("$d"); echo "  started: ${d##*/}"
    else
      echo "  ${Y}could not start on ${d##*/} (not supported, or blocked by the USB bridge)${N}"
    fi
  done
  ((${#started[@]})) || return
  echo "Waiting for tests to finish (Ctrl-C stops waiting. Tests keep running on the drives)..."
  sleep 5
  while :; do
    local busy=0 status=""
    for d in "${started[@]}"; do
      local rem; rem=$(selftest_remaining "$d")
      if [[ -n $rem ]]; then busy=1; status+="  ${d##*/}: ${rem}% left"; fi
    done
    ((busy)) || break
    printf '\r\e[K%s' "${status:0:200}"
    sleep 15
  done
  printf '\r\e[K%s\n\n' "All self-tests finished."
}

# ── Kernel log ───────────────────────────────────────────────────────────────
kernel_log_check() {  # $1 = kernel device name (sda, nvme0n1)
  local dev=$1 log pat_err pat_link ata=""
  log=$( (journalctl -k -b -o cat --no-pager 2>/dev/null || dmesg 2>/dev/null) )
  [[ -z $log ]] && { row "Kernel log (this boot)" "unavailable" NA; return; }

  if [[ $dev == nvme* ]]; then
    local ctrl=${dev%n[0-9]*}
    pat_err="(${dev}|${ctrl}\b).*(I/O error|critical|media error|Unrecovered)"
    pat_link="${ctrl}\b.*(timeout|reset|controller is down|AER|aborting)"
  else
    local syspath usbport
    syspath=$(readlink -f "/sys/block/$dev/device" 2>/dev/null)
    ata=$(grep -o 'ata[0-9]\+' <<<"$syspath" | head -1)
    usbport=$(grep -oE '/[0-9]+-[0-9.]+/' <<<"$syspath" | tail -1 | tr -d /)
    pat_err="\[${dev}\].*(Medium Error|Unrecovered read error|UNC|critical medium)|I/O error, dev ${dev}\b"
    pat_link="\[${dev}\].*(uas_eh|tag#.*(abort|timeout))"
    [[ -n $ata ]]     && pat_link+="|${ata}(\.[0-9]+)?: (exception|failed command|hard resetting|SError|link is slow)"
    [[ -n $usbport ]] && pat_link+="|usb ${usbport//./\\.}: (reset|device descriptor read|device not accepting)"
  fi
  local n_err n_link
  n_err=$(grep -Ec "$pat_err" <<<"$log")
  n_link=$(grep -Ec "$pat_link" <<<"$log")
  if ((n_err > 0)); then
    row "Kernel log: read/write errors" "$n_err lines" FAIL
    add FAIL "The kernel logged $n_err read/write error line(s) for $dev this boot, e.g.: $(grep -E "$pat_err" <<<"$log" | tail -1 | cut -c1-110)"
  else
    row "Kernel log: read/write errors" "none this boot" OK
  fi
  if ((n_link > 0)); then
    row "Kernel log: resets/timeouts" "$n_link lines" LINK
    add LINK "The kernel logged $n_link reset/timeout line(s). This usually means a cable, port or USB-enclosure problem rather than the drive, e.g.: $(grep -E "$pat_link" <<<"$log" | tail -1 | cut -c1-110)"
  else
    row "Kernel log: resets/timeouts" "none this boot" OK
  fi
}

# ── Full-surface read test ───────────────────────────────────────────────────
read_test() {  # $1 = /dev/sdX, $2 = kind
  local dev=$1 kind=$2 size start end rc secs mbps
  size=$(blockdev --getsize64 "$dev")
  echo "  ${D}Reading all $(human_bytes "$size") of $dev (read-only)...${N}"
  start=$(date +%s.%N)
  dd if="$dev" of=/dev/null bs=4M iflag=direct status=progress 2>&1 | tr '\r' '\n' | grep -E 'error|bytes' | tail -1 >&2
  rc=${PIPESTATUS[0]}
  end=$(date +%s.%N)
  secs=$(awk -v a="$start" -v b="$end" 'BEGIN{print b-a}')
  mbps=$(awk -v s="$size" -v t="$secs" 'BEGIN{printf "%.0f", s/t/1e6}')
  if ((rc != 0)); then
    row "Full read test" "READ ERROR" FAIL
    add FAIL "The full read test hit an unreadable area. The drive can't return some of its data."
  else
    local sev=OK
    if [[ $kind == "SATA SSD" ]] && ((mbps < 150)); then sev=WARN
      add WARN "The full read averaged only $mbps MB/s. A healthy SATA SSD reads at 400–550 MB/s. Slow reads of old data are a known 840 EVO problem: the cells have lost charge and need heavy error correction."
    elif [[ $kind == "HDD" ]] && ((mbps < 50)); then sev=WARN
      add WARN "The full read averaged only $mbps MB/s, which is slow for a hard drive. Check for weak sectors or a USB 2.0 port."
    fi
    row "Full read test" "OK, avg $mbps MB/s" "$sev"
  fi
}

# ── History comparison ───────────────────────────────────────────────────────
compare_history() {  # $1 = serial
  local dir="$STATE_DIR/$1" prev
  prev=$(ls -1 "$dir"/*.json 2>/dev/null | tail -1)
  if [[ -n $prev ]]; then
    local when; when=$(basename "$prev" .json)
    local -a keys=(
      "ata:5:Reallocated sectors" "ata:179:Used reserve blocks" "ata:181:Program fails" "ata:182:Erase fails"
      "ata:183:Runtime bad blocks" "ata:187:Uncorrectable errors" "ata:197:Pending sectors"
      "ata:198:Offline uncorrectable" "ata:199:CRC (cable) errors"
      "nvme:media_errors:Media errors" "nvme:num_err_log_entries:Error log entries"
      "nvme:percentage_used:Percentage used"
    )
    local k src id label old new grew=0
    for k in "${keys[@]}"; do
      IFS=: read -r src id label <<<"$k"
      if [[ $src == ata ]]; then
        old=$(jq -r --argjson id "$id" '[.ata_smart_attributes.table[]? | select(.id==$id) | .raw.value][0] // empty' "$prev")
        new=$(attr_raw "$id")
      else
        old=$(jq -r ".nvme_smart_health_information_log.$id // empty" "$prev")
        new=$(jqr ".nvme_smart_health_information_log.$id // empty")
      fi
      [[ -z $old || -z $new ]] && continue
      if ((new > old)); then
        grew=1
        local sev=WARN
        [[ $id == 199 || $id == num_err_log_entries || $id == percentage_used ]] && sev=INFO
        add "$sev" "$label grew from $old to $new since the last check ($when). A growing count means the drive is still degrading."
      fi
    done
    ((grew)) && row "Change since last check" "counters grew (see findings)" WARN \
             || row "Change since last check" "no growth since $when" OK
  else
    row "Change since last check" "first run, baseline saved" NA
  fi
  mkdir -p "$dir" && printf '%s\n' "$JSON" >"$dir/$(date +%Y-%m-%d_%H%M%S).json"
}

# ── Per-drive check ──────────────────────────────────────────────────────────
SUMMARY=()

check_drive() {
  local path=$1 name=${1##*/} dev rc role=internal
  dev=$(readlink -f "$path"); dev=${dev##*/}
  is_usb "$path" && role=backup
  FINDINGS=()

  JSON=$($SMARTCTL -j -a $(smart_opts "$path") "$path" 2>/dev/null); rc=$?
  if [[ $role == backup && -z $(jqr '.model_name // empty') ]]; then
    JSON=$($SMARTCTL -j -a "$path" 2>/dev/null); rc=$?     # some bridges want auto-detect
  fi

  local model serial fw proto rot kind cap poh cycles temp
  model=$(jqr '.model_name // .scsi_model_name // "unknown model"')
  serial=$(jqr '.serial_number // "unknown"')
  fw=$(jqr '.firmware_version // "?"')
  proto=$(jqr '.device.protocol // ""')
  rot=$(jqr '.rotation_rate // empty')
  cap=$(jqr '.user_capacity.bytes // .nvme_total_capacity // 0')

  if [[ $proto == NVMe ]]; then kind="NVMe SSD"
  elif [[ $rot == 0 ]] || [[ -n $(attr_raw 177)$(attr_raw 233)$(attr_raw 231) && -z $rot ]]; then kind="SATA SSD"
  elif [[ -n $rot ]]; then kind="HDD"
  else kind="unknown"; fi

  echo
  echo "${B}══════════════════════════════════════════════════════════════════════════════${N}"
  printf " ${B}%s${N}  %s  ${D}(serial %s)${N}\n" "$dev" "$model" "$serial"
  printf " %s · firmware %s · %s · %s\n" "$kind" "$fw" "$(human_bytes "$cap")" \
         "$([[ $role == backup ]] && echo "${C}role: BACKUP drive (strict rules)${N}" || echo "role: internal")"
  printf " ${D}%s${N}\n" "$path"
  echo "${B}──────────────────────────────────────────────────────────────────────────────${N}"

  if (( rc & 2 )) || [[ $model == "unknown model" ]]; then
    row "SMART data" "could not be read" FAIL
    add FAIL "smartctl could not read this drive (exit code $rc). If it's on USB, the enclosure may not pass SMART through. Try another enclosure or connect it by SATA."
    finish_drive "$dev" "$model" "$role"; return
  fi

  # Overall health
  local passed; passed=$(jqr '.smart_status.passed // "n/a"')
  case $passed in
    true)  row "SMART overall health" "PASSED" OK ;;
    false) row "SMART overall health" "FAILED" FAIL
           add FAIL "The drive's own health self-assessment says FAILED. Copy any data off it now." ;;
    *)     row "SMART overall health" "not reported" NA ;;
  esac
  (( rc & 8 ))  && add FAIL "smartctl reports the drive as FAILING."
  (( rc & 16 )) && add FAIL "At least one pre-failure attribute is at or below its failure threshold now."
  (( rc & 32 )) && add WARN "At least one attribute was below its failure threshold at some point in the past."

  # Attributes the drive itself has flagged
  local flagged; flagged=$(jqr '[.ata_smart_attributes.table[]? | select(.when_failed=="now" or .when_failed=="past") | "\(.name) (\(.when_failed))"] | join(", ")')
  [[ -n $flagged ]] && add FAIL "The drive has flagged these attributes as failing: $flagged"

  # Age / usage
  poh=$(jqr '.power_on_time.hours // .nvme_smart_health_information_log.power_on_hours // empty')
  cycles=$(jqr '.power_cycle_count // .nvme_smart_health_information_log.power_cycles // empty')
  [[ -n $poh ]] && row "Power-on time" "$(hours_str "$poh")" INFO
  [[ -n $cycles ]] && row "Power cycles" "$cycles" INFO

  # Temperature
  temp=$(jqr '.temperature.current // empty')
  if [[ -n $temp ]]; then
    local tlim=70; [[ $kind == HDD ]] && tlim=55; [[ $kind == "NVMe SSD" ]] && tlim=75
    if ((temp >= tlim)); then row "Temperature" "${temp} C" WARN
      add WARN "Running hot (${temp} °C, comfortable limit ~${tlim} °C). Improve airflow, or for NVMe add a heatsink."
    else row "Temperature" "${temp} C" OK; fi
  fi

  local written="" rated=${RATED_TBW[$model]:-}

  case $kind in
  # ── SATA SSD ──────────────────────────────────────────────
  "SATA SSD")
    zero_counter "Reallocated sectors (5)"        "$(attr_raw 5)"   WARN "Flash blocks have failed and been replaced from spares. A few are tolerable if the count stays stable. A rising count is the classic sign of a dying SSD."
    local r5; r5=$(attr_raw 5)
    [[ -n $r5 ]] && ((r5 >= 50)) && add FAIL "Reallocated sectors at $r5 is high. Don't trust this drive in the array."

    local wl wraw life_id
    for life_id in 177 233 231 202 169; do wl=$(attr_norm $life_id); [[ -n $wl ]] && break; done
    if [[ -n $wl ]]; then
      wraw=$(attr_raw $life_id)
      local wsev=OK
      ((wl <= 10)) && wsev=FAIL || { ((wl <= 30)) && wsev=WARN; }
      row "Wear levelling / life left" "${wl}% left (raw $wraw)" $wsev
      [[ $wsev == FAIL ]] && add FAIL "Only ${wl}% of the flash endurance is left. The drive is nearly worn out."
      [[ $wsev == WARN ]] && add WARN "Only ${wl}% of the flash endurance is left. Plan to replace it."
      [[ $life_id == 177 ]] && add INFO "Wear_Leveling_Count raw $wraw = average program/erase cycles per block (840 EVO TLC is good for roughly 1,000–3,000; 850 EVO V-NAND for roughly 2,000+)."
    fi

    zero_counter "Uncorrectable errors (187)"     "$(attr_raw 187)" FAIL "The drive returned data it could not correct. Data has been lost or corrupted at least once."
    zero_counter "Used reserve blocks (179)"      "$(attr_raw 179)" WARN "Spare blocks are being used up to replace failed ones."
    zero_counter "Program failures (181)"         "$(attr_raw 181)" WARN "Writes to flash have failed."
    zero_counter "Erase failures (182)"           "$(attr_raw 182)" WARN "Erasing flash blocks has failed."
    zero_counter "Runtime bad blocks (183)"       "$(attr_raw 183)" WARN "Blocks went bad during use."
    zero_counter "Pending sectors (197)"          "$(attr_raw 197)" FAIL "Sectors are waiting to be remapped because they couldn't be read."
    zero_counter "Offline uncorrectable (198)"    "$(attr_raw 198)" FAIL "Sectors that couldn't be read during a background scan."
    zero_counter "CRC / cable errors (199)"       "$(attr_raw 199)" LINK "Data was corrupted between the drive and the controller. Usually a bad SATA cable or port. The drive itself is fine, so reseat or replace the cable."

    local por; por=$(attr_raw 235)
    [[ -n $por ]] && row "Unexpected power losses (235)" "$por" INFO

    local lbas; lbas=$(attr_raw 241)
    [[ -n $lbas ]] && written=$(awk -v l="$lbas" 'BEGIN{printf "%.0f", l*512}')

    if [[ $model == *"840 EVO"* ]]; then
      if [[ $fw < "EXT0DB6Q" ]]; then
        row "Firmware" "$fw (outdated)" WARN
        add WARN "Firmware $fw predates EXT0DB6Q, which fixes the 840 EVO slowdown when reading old data. Update with Samsung's firmware tool, or treat this drive as a poor array candidate."
      else row "Firmware" "$fw" OK; fi
    fi
    ;;

  # ── Hard drive (e.g. the USB backup drive) ────────────────
  "HDD")
    zero_counter "Reallocated sectors (5)"        "$(attr_raw 5)"   WARN "The disk surface has bad spots that have been remapped."
    zero_counter "Pending sectors (197)"          "$(attr_raw 197)" FAIL "Sectors that can't currently be read. Data there may be lost."
    zero_counter "Offline uncorrectable (198)"    "$(attr_raw 198)" FAIL "Sectors that couldn't be read during a surface scan."
    zero_counter "Reported uncorrectable (187)"   "$(attr_raw 187)" FAIL "The drive returned read errors it could not correct."
    zero_counter "Spin-up retries (10)"           "$(attr_raw 10)"  WARN "The motor struggled to spin up. This can mean a failing motor or a weak USB power supply."
    zero_counter "End-to-end errors (184)"        "$(attr_raw 184)" FAIL "Data was corrupted inside the drive's own electronics."
    zero_counter "CRC / interface errors (199)"   "$(attr_raw 199)" LINK "Data was corrupted between the drive and the USB bridge. Try another cable or port."
    local ct; ct=$(attr_rawstr 188)
    if [[ -n $ct ]]; then
      if [[ $ct =~ [1-9] ]]; then row "Command timeouts (188)" "$ct" LINK
        add LINK "Commands have timed out ($ct). On USB drives this is usually the enclosure or power, not the platters."
      else row "Command timeouts (188)" "$ct" OK; fi
    fi
    local gs lc
    gs=$(attr_raw 191); [[ -n $gs ]] && { row "Shock events (191 G-sense)" "$gs" INFO
      ((gs > 100)) && add INFO "The drive has recorded $gs shock events. Portable drives get knocked around, so handle it gently."; }
    lc=$(attr_raw 193); [[ -n $lc ]] && { row "Head load cycles (193)" "$lc" INFO
      ((lc > 300000)) && add WARN "$lc head load cycles. Many laptop/portable drives are rated for 300,000–600,000."; }
    local lbas; lbas=$(attr_raw 241)
    [[ -n $lbas ]] && written=$(awk -v l="$lbas" 'BEGIN{printf "%.0f", l*512}')
    ;;

  # ── NVMe ──────────────────────────────────────────────────
  "NVMe SSD")
    local cw spare sthr used media errs unsafe dw
    cw=$(jqr '.nvme_smart_health_information_log.critical_warning // 0')
    spare=$(jqr '.nvme_smart_health_information_log.available_spare // empty')
    sthr=$(jqr '.nvme_smart_health_information_log.available_spare_threshold // 10')
    used=$(jqr '.nvme_smart_health_information_log.percentage_used // empty')
    media=$(jqr '.nvme_smart_health_information_log.media_errors // empty')
    errs=$(jqr '.nvme_smart_health_information_log.num_err_log_entries // empty')
    unsafe=$(jqr '.nvme_smart_health_information_log.unsafe_shutdowns // empty')
    dw=$(jqr '.nvme_smart_health_information_log.data_units_written // empty')

    if ((cw == 0)); then row "Critical warning flags" "none" OK
    else
      row "Critical warning flags" "$(printf '0x%02x' "$cw")" FAIL
      ((cw & 1))  && add FAIL "Spare capacity is below the safe threshold."
      ((cw & 2))  && add WARN "Temperature is outside the safe range."
      ((cw & 4))  && add FAIL "The controller reports reliability is degraded by media/internal errors."
      ((cw & 8))  && add FAIL "The drive has put itself in READ-ONLY mode. Copy your data off now."
      ((cw & 16)) && add FAIL "The volatile memory backup has failed."
    fi
    if [[ -n $used ]]; then
      local us=OK; ((used >= 100)) && us=FAIL || { ((used >= 80)) && us=WARN; }
      row "Endurance used" "${used}%" $us
      [[ $us != OK ]] && add $us "The drive estimates it has used ${used}% of its rated endurance."
    fi
    if [[ -n $spare ]]; then
      local ss=OK; ((spare <= sthr)) && ss=FAIL || { ((spare < 50)) && ss=WARN; }
      row "Available spare" "${spare}% (threshold ${sthr}%)" $ss
      [[ $ss != OK ]] && add $ss "Only ${spare}% spare flash is left."
    fi
    zero_counter "Media / integrity errors" "$media" FAIL "The flash returned data the controller could not correct."
    [[ -n $errs ]] && { row "Error-log entries" "$errs" INFO
      ((errs > 0)) && add INFO "$errs error-log entries. These are often harmless (the OS probing unsupported features). They matter only if media errors are non-zero too."; }
    [[ -n $unsafe ]] && row "Unsafe shutdowns" "$unsafe" INFO
    [[ -n $dw ]] && written=$(awk -v u="$dw" 'BEGIN{printf "%.0f", u*512000}')
    ;;
  *)
    add WARN "Couldn't tell what type of drive this is. Only the generic checks were run."
    ;;
  esac

  # Data written vs rated endurance
  if [[ -n $written ]]; then
    if [[ -n $rated ]]; then
      local pct; pct=$(awk -v w="$written" -v r="$rated" 'BEGIN{printf "%.0f", w/(r*1e12)*100}')
      local ws=OK; ((pct >= 100)) && ws=WARN; ((pct >= 150)) && ws=FAIL
      row "Data written" "$(human_bytes "$written") of ${rated} TB (${pct}%)" $ws
      [[ $ws != OK ]] && add $ws "$(human_bytes "$written") written, ${pct}% of the ${rated} TB rating."
    else
      row "Data written" "$(human_bytes "$written")" INFO
    fi
  fi

  # Self-test history
  local st_type st_str st_pass st_hours older_fail
  if [[ $kind == "NVMe SSD" ]]; then
    st_str=$(jqr '.nvme_self_test_log.table[0].self_test_result.string // empty')
    local st_val; st_val=$(jqr '.nvme_self_test_log.table[0].self_test_result.value // empty')
    st_type=$(jqr '.nvme_self_test_log.table[0].self_test_code.string // empty')
    if [[ -z $st_str ]]; then row "Last self-test" "none on record" NA
      add INFO "No self-test on record. Run with --test short (or long) for a fuller check."
    elif [[ $st_val =~ ^[567]$ ]]; then row "Last self-test" "$st_type: $st_str" FAIL
      add FAIL "The last self-test ($st_type) FAILED: $st_str"
    else row "Last self-test" "$st_type test: ${st_str:0:20}" OK; fi
  else
    st_type=$(jqr '.ata_smart_self_test_log.standard.table[0].type.string // empty')
    st_str=$(jqr '.ata_smart_self_test_log.standard.table[0].status.string // empty')
    st_pass=$(jqr '.ata_smart_self_test_log.standard.table[0].status.passed // "n/a"')
    st_hours=$(jqr '.ata_smart_self_test_log.standard.table[0].lifetime_hours // empty')
    older_fail=$(jqr '[.ata_smart_self_test_log.standard.table[1:][]? | select(.status.passed==false)] | length')
    if [[ -z $st_str ]]; then row "Last self-test" "none on record" NA
      add INFO "No self-test on record. Run with --test short (or long) for a fuller check."
    elif [[ $st_pass == false ]]; then row "Last self-test" "$st_type: FAILED" FAIL
      add FAIL "The last self-test ($st_type, at ${st_hours:-?} h) FAILED: $st_str"
    else
      local age=""; [[ -n $poh && -n $st_hours ]] && age=" ($(( (poh - st_hours) / 24 ))d use ago)"
      row "Last self-test" "${st_type%% *} test passed${age}" OK
    fi
    ((older_fail > 0)) && add WARN "$older_fail older self-test(s) in the log failed."
    local elog; elog=$(jqr '.ata_smart_error_log.summary.count // 0')
    if ((elog > 0)); then row "Drive error log" "$elog errors logged" WARN
      add WARN "The drive's internal error log has $elog entries. Run 'smartctl -l error' to see when they happened."
    else row "Drive error log" "empty" OK; fi
  fi

  kernel_log_check "$dev"
  ((READ_TEST)) && read_test "/dev/$dev" "$kind"
  ((HISTORY)) && [[ $serial != unknown ]] && compare_history "$serial"

  finish_drive "$dev" "$model" "$role"
}

finish_drive() {
  local dev=$1 model=$2 role=$3 f sev text worst=OK link=0
  echo
  if ((${#FINDINGS[@]})); then
    echo "  ${B}Findings${N}"
    for sev in FAIL WARN LINK INFO; do
      for f in "${FINDINGS[@]}"; do
        [[ ${f%%|*} == "$sev" ]] || continue
        text=${f#*|}
        case $sev in
          FAIL) echo "   ${R}✖${N} $text"; worst=FAIL ;;
          WARN) echo "   ${Y}!${N} $text"; [[ $worst == OK ]] && worst=WARN ;;
          LINK) echo "   ${Y}~${N} $text"; link=1 ;;
          INFO) echo "   ${D}·${N} $text" ;;
        esac
      done
    done
    echo
  fi

  local verdict
  if [[ $role == backup ]]; then
    case $worst in
      FAIL|WARN) verdict="${R}${B}REPLACE NOW${N}: this drive holds every backup and is showing problems." ; worst=FAIL ;;
      OK) if ((link)); then verdict="${Y}${B}DRIVE OK, CONNECTION FLAKY${N}: try another cable/port/enclosure, then re-run."; worst=WARN
          else verdict="${G}${B}HEALTHY${N}: fine to use as the backup drive."; fi ;;
    esac
  else
    case $worst in
      FAIL) verdict="${R}${B}FAILING${N}: do not put this drive in the array." ;;
      WARN) verdict="${Y}${B}USABLE, WATCH IT${N}: OK in a redundant array, but re-check regularly and keep a spare." ;;
      OK)   if ((link)); then verdict="${G}${B}HEALTHY${N} (fix the cable/port issue noted above)."
            else verdict="${G}${B}HEALTHY${N}: OK to use in the array."; fi ;;
    esac
  fi
  echo "  ${B}Verdict:${N} $verdict"
  SUMMARY+=("$worst|$dev|$model|$role")
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo "${B}Drive health report: $(date '+%Y-%m-%d %H:%M')${N}  (${#DRIVES[@]} drive(s))"
[[ -n $TEST_TYPE ]] && run_selftests

for d in "${DRIVES[@]}"; do check_drive "$d"; done

echo
echo "${B}══════════════════════════════════ SUMMARY ═══════════════════════════════════${N}"
printf "  %-10s %-36s %-10s %s\n" "Device" "Model" "Role" "Result"
for s in "${SUMMARY[@]}"; do
  IFS='|' read -r sev dev model role <<<"$s"
  case $sev in
    OK)   res="${G}HEALTHY${N}" ;;
    WARN) res="${Y}WATCH${N}" ;;
    FAIL) [[ $role == backup ]] && res="${R}REPLACE NOW${N}" || res="${R}FAILING: keep out of array${N}" ;;
  esac
  printf "  %-10s %-36s %-10s %s\n" "$dev" "${model:0:36}" "$role" "$res"
done
echo
echo "${D}Legend: [ OK ] fine · [ INFO ] for reference · [ WARN ] watch it · [ FAIL ] act now${N}"
[[ -z $TEST_TYPE ]] && echo "${D}Tip: add --test short (or long) to run drive self-tests, and --read-test to read every sector.${N}"
