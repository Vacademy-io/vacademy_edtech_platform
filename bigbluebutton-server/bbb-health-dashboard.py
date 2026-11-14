#!/usr/bin/env python3
"""
BBB Health Dashboard — browser-accessible server health & quick actions.

Listens on 127.0.0.1:9092 (exposed via nginx at /internal/health).
Authenticated via ?token=<HEALTH_DASHBOARD_TOKEN> query parameter.

Endpoints:
  GET  /                              → HTML dashboard page
  GET  /api/metrics?token=xxx         → JSON system metrics + service status
  POST /api/action/delete-old-recordings?token=xxx  → Delete recordings >2 days
  POST /api/action/restart-bbb?token=xxx            → bbb-conf --restart + --setip
"""

import os
import re
import glob
import hmac
import hashlib
import json
import time
import shutil
import subprocess
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# BBB record IDs are sha1(meetingId+ts).hex + '-' + ts_ms — strict shape.
# Anything else (path traversal, leading dash, null bytes, log injection) is rejected.
RECORD_ID_RE = re.compile(r'^[a-f0-9]{40}-[0-9]{13}$')
from urllib.request import urlopen
from urllib.error import URLError

HEALTH_TOKEN = os.environ.get('HEALTH_DASHBOARD_TOKEN', '')
BBB_DOMAIN = os.environ.get('BBB_DOMAIN', 'meet.vacademy.io')
BBB_SECRET = os.environ.get('VACADEMY_BBB_SECRET', '')
PORT = int(os.environ.get('HEALTH_DASHBOARD_PORT', '9092'))
LOG_FILE = '/var/log/bigbluebutton/vacademy-health-dashboard.log'

BBB_SERVICES = [
    'bbb-web', 'bbb-apps-akka', 'bbb-fsesl-akka', 'nginx', 'redis-server',
    'freeswitch', 'bbb-webrtc-sfu', 'bbb-graphql-server',
    'bbb-rap-resque-worker', 'bbb-heal-service', 'bbb-health-dashboard',
]


def log(msg):
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def get_disk_info():
    usage = shutil.disk_usage('/')
    return {
        'total_gb': round(usage.total / (1024 ** 3), 1),
        'used_gb': round(usage.used / (1024 ** 3), 1),
        'free_gb': round(usage.free / (1024 ** 3), 1),
        'percent': round(usage.used / usage.total * 100, 1),
    }


def get_memory_info():
    info = {}
    try:
        with open('/proc/meminfo', 'r') as f:
            for line in f:
                parts = line.split()
                if parts[0] == 'MemTotal:':
                    info['total_mb'] = int(parts[1]) // 1024
                elif parts[0] == 'MemAvailable:':
                    info['available_mb'] = int(parts[1]) // 1024
        info['used_mb'] = info['total_mb'] - info['available_mb']
        info['percent'] = round(info['used_mb'] / info['total_mb'] * 100, 1)
    except Exception:
        info = {'total_mb': 0, 'available_mb': 0, 'used_mb': 0, 'percent': 0}
    return info


# Map /proc/<pid> comm -> friendly label for the per-process CPU breakdown.
_CPU_PROC_LABELS = {
    'freeswitch': 'FreeSWITCH (audio)',
    'node': 'WebRTC SFU / graphql',
    'java': 'akka / bbb-web',
    'ruby': 'recording (rap)',
    'ffmpeg': 'recording ffmpeg',
    'mongod': 'mongo',
    'postgres': 'postgres',
}


def _cpu_total_jiffies():
    """Return (total, idle_incl_iowait, iowait) jiffies from /proc/stat's aggregate line."""
    with open('/proc/stat', 'r') as f:
        line = f.readline()
    parts = [int(x) for x in line.split()[1:]]
    # user nice system idle iowait irq softirq steal guest guest_nice
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    iowait = parts[4] if len(parts) > 4 else 0
    # guest (idx 8) and guest_nice (idx 9) are already counted within user/nice,
    # so subtract them from the total to avoid double-counting on a VM host.
    guest = (parts[8] if len(parts) > 8 else 0) + (parts[9] if len(parts) > 9 else 0)
    return sum(parts) - guest, idle, iowait


def _proc_jiffies_by_comm():
    """Sum utime+stime jiffies per process comm, across all PIDs (one sample)."""
    out = {}
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            with open(f'/proc/{pid}/stat', 'r') as f:
                data = f.read()
            # comm is wrapped in parens and may itself contain spaces/parens.
            rparen = data.rfind(')')
            comm = data[data.find('(') + 1:rparen]
            fields = data[rparen + 2:].split()
            # After comm: state(0) ppid(1) ... utime is overall field 14 => index 11 here.
            out[comm] = out.get(comm, 0) + int(fields[11]) + int(fields[12])
        except Exception:
            continue
    return out


def get_cpu_info():
    """Actual CPU utilisation sampled over a short window (NOT load average).

    Load average counts runnable + uninterruptible-IO tasks and is inflated by
    disk wait (e.g. the recording pipeline), so it overstates real CPU pressure.
    Here we sample /proc/stat twice to get the true busy %, the iowait %, and a
    per-service breakdown (top-style: 100% = one core)."""
    cpu_count = os.cpu_count() or 1
    try:
        with open('/proc/loadavg', 'r') as f:
            p = f.read().split()
        load_1, load_5, load_15 = float(p[0]), float(p[1]), float(p[2])
    except Exception:
        load_1 = load_5 = load_15 = 0.0

    usage_percent = 0.0
    iowait_percent = 0.0
    top_processes = []
    try:
        t0 = _cpu_total_jiffies()
        p0 = _proc_jiffies_by_comm()
        time.sleep(0.3)
        t1 = _cpu_total_jiffies()
        p1 = _proc_jiffies_by_comm()
        dtotal = t1[0] - t0[0]
        if dtotal > 0:
            didle = t1[1] - t0[1]
            usage_percent = round(max(0.0, 100.0 * (dtotal - didle) / dtotal), 1)
            iowait_percent = round(max(0.0, 100.0 * (t1[2] - t0[2]) / dtotal), 1)
            rows = []
            for comm, j1 in p1.items():
                dj = j1 - p0.get(comm, 0)
                if dj <= 0:
                    continue
                core_pct = round(cpu_count * 100.0 * dj / dtotal, 1)  # 100% = one core
                if core_pct >= 1.0:
                    rows.append({'name': _CPU_PROC_LABELS.get(comm, comm),
                                 'comm': comm, 'cpu_percent': core_pct})
            rows.sort(key=lambda r: r['cpu_percent'], reverse=True)
            top_processes = rows[:6]
    except Exception:
        pass

    return {
        'load_1': load_1, 'load_5': load_5, 'load_15': load_15,
        'cpu_count': cpu_count,
        'usage_percent': usage_percent,      # real busy %, 0-100 across all cores
        'iowait_percent': iowait_percent,    # real disk-wait %, 0-100
        'percent': usage_percent,            # back-compat: bar now reflects REAL usage
        'top_processes': top_processes,
    }


def get_service_statuses():
    results = []
    for svc in BBB_SERVICES:
        try:
            r = subprocess.run(
                ['systemctl', 'is-active', svc],
                capture_output=True, text=True, timeout=5
            )
            status = r.stdout.strip()
        except Exception:
            status = 'unknown'
        results.append({'name': svc, 'status': status})
    return results


def get_recording_stats():
    """Count recordings on disk and their total size."""
    dirs = [
        '/var/bigbluebutton/published/presentation',
        '/var/bigbluebutton/recording/raw',
    ]
    total_count = 0
    total_bytes = 0
    for d in dirs:
        try:
            for entry in os.scandir(d):
                if entry.is_dir():
                    total_count += 1
                    for root, subdirs, files in os.walk(entry.path):
                        for f in files:
                            try:
                                total_bytes += os.path.getsize(os.path.join(root, f))
                            except OSError:
                                pass
        except FileNotFoundError:
            pass
    return {
        'count': total_count,
        'size_gb': round(total_bytes / (1024 ** 3), 2),
    }


PUBLISHED_DIR = '/var/bigbluebutton/published/presentation'
UNPUBLISHED_DIR = '/var/bigbluebutton/unpublished/presentation'
RAW_DIR = '/var/bigbluebutton/recording/raw'
STATUS_DIR = '/var/bigbluebutton/recording/status'
# Furthest-reached stage wins (iterate from latest to earliest).
# Real BBB pipeline order is: sanity → archived → processed → published.
# 'recorded' is sometimes seen on older versions but BBB 2.x+ uses 'archived'.
# Include both for compatibility; on this host we observe 160 archived .done
# files and 0 recorded .done files.
PIPELINE_STAGES = ('published', 'processed', 'archived', 'recorded', 'sanity')
QUEUE_FILE = '/var/spool/bbb-recording-queue.txt'
UPLOADED_DIR = '/var/spool/bbb-recording-uploaded'
UPLOADING_MARKER = '/var/spool/bbb-recording-uploading'

# Per-recordId cache for on-demand size lookups (du is expensive).
_size_cache = {}  # recordId -> (size_bytes, computed_at)
_SIZE_CACHE_TTL_SEC = 300


def _read_queue_set():
    """Return the set of recordIds currently sitting in the upload queue."""
    try:
        with open(QUEUE_FILE, 'r') as f:
            return {line.strip() for line in f if line.strip()}
    except FileNotFoundError:
        return set()
    except Exception:
        return set()


def _read_current_drainer_recid():
    """The recordId the drainer is processing right now, or None."""
    try:
        with open(UPLOADING_MARKER, 'r') as f:
            v = f.read().strip()
            return v or None
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _is_uploaded(record_id):
    return os.path.isfile(os.path.join(UPLOADED_DIR, record_id))


def _read_uploaded_fileids(record_id):
    """Read the per-recording upload marker. The post-publish hook writes it as
    'type=fileId' lines (content/webcams/presenter), one per uploaded variant.
    Older recordings have an EMPTY marker (the hook used to just `touch` it) and
    return [] — only recordings uploaded after the hook change carry file IDs.
    Used by the dashboard to surface/copy the S3 file id."""
    out = []
    seen = set()
    try:
        with open(os.path.join(UPLOADED_DIR, record_id), 'r') as f:
            for line in f:
                line = line.strip()
                if not line or '=' not in line:
                    continue
                typ, _, fid = line.partition('=')
                typ, fid = typ.strip(), fid.strip()
                if fid and fid not in seen:
                    seen.add(fid)
                    out.append({'type': typ or 'recording', 'fileId': fid})
    except OSError:
        pass
    return out


def _parse_metadata_xml(path):
    """Extract meetingName, start_time (ms), end_time (ms) from a BBB metadata.xml.
    Falls back to None for any field we can't find."""
    try:
        root = ET.parse(path).getroot()
    except Exception:
        return {'meetingName': None, 'start_time': None, 'end_time': None}

    def first_text(*tags):
        for tag in tags:
            el = root.find(f'.//{tag}')
            if el is not None and el.text:
                return el.text.strip()
        return None

    start = first_text('start_time', 'startTime')
    end = first_text('end_time', 'endTime')
    name = first_text('meetingName', 'meeting_name')
    # Some BBB versions store name as attribute on <meeting meetingName="…">
    if not name:
        m = root.find('.//meeting')
        if m is not None:
            name = m.get('meetingName') or m.get('name')
    try:
        start = int(start) if start else None
    except ValueError:
        start = None
    try:
        end = int(end) if end else None
    except ValueError:
        end = None
    return {'meetingName': name, 'start_time': start, 'end_time': end}


# BBB names .done flags either '<recordId>.done' (sanity, archived, recorded)
# OR '<recordId>-<formatName>.done' (processed, published — format e.g. 'presentation').
# This regex extracts just the bare recordId so suffixed files map back correctly.
_DONE_FILE_RE = re.compile(r'^([a-f0-9]{40}-[0-9]{13})(?:-[^.]+)?\.done$')
# Ordering used to pick the furthest-reached stage when multiple .done files exist.
_STAGE_ORDER = {'sanity': 0, 'recorded': 1, 'archived': 2, 'processed': 3, 'published': 4}


def _latest_done_event(record_id):
    """Across all pipeline stages, find the most-recently-modified .done file
    for this recording. Returns (stage_name, mtime_unix) or None.

    Critical for UX: when a recording sits at 'Awaiting Process' the badge
    doesn't change but the pipeline IS moving (rap-worker rewrites sanity.done,
    then archive runs, etc). Surfacing the latest .done timestamp gives users
    concrete proof that progress is happening — without it the dashboard
    looks frozen between major status transitions."""
    latest = None
    # Include captions which is part of the rap workflow and frequently the
    # most-recently-touched marker for a recording.
    stages_to_check = list(PIPELINE_STAGES) + ['captions']
    for stage in stages_to_check:
        for pattern in (
            os.path.join(STATUS_DIR, stage, record_id + '.done'),
            os.path.join(STATUS_DIR, stage, record_id + '-*.done'),
        ):
            paths = glob.glob(pattern) if '*' in pattern else (
                [pattern] if os.path.exists(pattern) else []
            )
            for path in paths:
                try:
                    mtime = os.path.getmtime(path)
                    if latest is None or mtime > latest[1]:
                        latest = (stage, mtime)
                except OSError:
                    pass
    return latest


def _stage_done_exists(record_id, stage):
    """Returns True if either '<id>.done' or '<id>-*.done' is present in the given stage dir."""
    plain = os.path.join(STATUS_DIR, stage, record_id + '.done')
    if os.path.exists(plain):
        return True
    return bool(glob.glob(os.path.join(STATUS_DIR, stage, record_id + '-*.done')))


def _pipeline_stage(record_id):
    """Return the furthest BBB recording-pipeline stage reached:
       'published' > 'processed' > 'recorded'/'archived' > 'sanity' > 'raw_only' > 'unpublished' > None

    Check .done flags FIRST — they reflect actual pipeline progress and get
    invalidated correctly by `bbb-record --rebuild`. Only fall back to
    directory existence when NO flags are present (covers the 4-day cleanup
    cron case where .done files are gone but presentation/<id>/ survives).

    Previously this checked the directory first — which incorrectly reported
    'published' on a freshly-rebuilt recording whose .done files had been
    removed but whose stale presentation/<id>/ directory was still on disk."""
    for stage in PIPELINE_STAGES:
        if _stage_done_exists(record_id, stage):
            return stage
    if os.path.isdir(os.path.join(PUBLISHED_DIR, record_id)):
        return 'published'   # legacy publish whose .done was cleaned by cron
    if os.path.isdir(os.path.join(RAW_DIR, record_id)):
        return 'raw_only'
    if os.path.isdir(os.path.join(UNPUBLISHED_DIR, record_id)):
        return 'unpublished'
    return None


def _combined_status(record_id, queued_set, current_recid):
    """Human-readable status for the UI, derived from pipeline stage + upload state."""
    stage = _pipeline_stage(record_id)
    if stage == 'published':
        if record_id == current_recid:
            return 'Uploading'
        if _is_uploaded(record_id):
            return 'Uploaded'
        if record_id in queued_set:
            return 'Queued'
        return 'Published'      # rap-worker done; awaiting hook to enqueue
    if stage == 'processed':    return 'Awaiting Publish'   # processed.done, publish not yet
    if stage == 'archived':     return 'Awaiting Process'   # archive done, processing stalled
    if stage == 'recorded':     return 'Awaiting Process'   # older BBB synonym for archived
    if stage == 'sanity':       return 'Awaiting Archive'   # sanity check passed, archive not yet
    if stage == 'raw_only':     return 'Recording'          # raw files only, no .done yet
    if stage == 'unpublished':  return 'Unpublished'
    return 'Unknown'


def _events_xml_meeting_info(events_path):
    """For raw recordings, pull what we can from events.xml header:
       - meeting name (best-effort across BBB versions)
       - external meeting ID (only via patterns that we KNOW give the external
         UUID, not the confusingly-named <meetingId> which is the internal id)

    We do NOT extract a timestamp here. BBB stores event timestamps as
    relative offsets from recording start; the absolute start time can only
    come from metadata.xml (published) or from the recordId suffix itself."""
    try:
        with open(events_path, 'rb') as f:
            head = f.read(16384).decode('utf-8', errors='ignore')
        ext_id = None
        name = None
        # External meeting ID — patterns that genuinely point at the external
        # (admin-facing) UUID rather than BBB's internal id.
        for pattern in (
            r'<externalMeetingID>([^<]+)</externalMeetingID>',
            r'<externalMeetingId>([^<]+)</externalMeetingId>',
            r'externalMeetingID="([^"]+)"',
            r'externalMeetingId="([^"]+)"',
        ):
            m = re.search(pattern, head)
            if m:
                ext_id = m.group(1).strip()
                break
        # Meeting name (also a few possible spellings).
        for pattern in (
            r'<meetingName>([^<]+)</meetingName>',
            r'meetingName="([^"]+)"',
            r'<meta>\s*<name>([^<]+)</name>',
            r'<name>([^<]+)</name>',
        ):
            m = re.search(pattern, head)
            if m:
                name = m.group(1).strip()
                break
        return {'externalMeetingId': ext_id, 'meetingName': name}
    except Exception:
        return {'externalMeetingId': None, 'meetingName': None}


def _scan_all_recording_ids():
    """Union of every recordId visible anywhere on this BBB box across all stages.
    Critically: strips BBB's '-<format>' suffix on .done file names so each
    real recordId is added exactly once, no matter how many formats wrote
    their own .done files for it."""
    ids = set()
    # Status .done files — may be named '<id>.done' or '<id>-<format>.done'.
    for stage in PIPELINE_STAGES:
        d = os.path.join(STATUS_DIR, stage)
        try:
            for entry in os.scandir(d):
                m = _DONE_FILE_RE.match(entry.name)
                if m:
                    ids.add(m.group(1))
        except FileNotFoundError:
            pass
    # Plus directory listings (catches raw-only + unpublished + already-published).
    for root in (PUBLISHED_DIR, UNPUBLISHED_DIR, RAW_DIR):
        try:
            for entry in os.scandir(root):
                if entry.is_dir() and RECORD_ID_RE.match(entry.name):
                    ids.add(entry.name)
        except FileNotFoundError:
            pass
    return ids


_RECORD_ID_TS_RE = re.compile(r'^[a-f0-9]{40}-([0-9]{13})$')


def _fallback_start_ms(record_id):
    """A recordId is `sha1(externalId+ts).hex + '-' + ts_ms` — the suffix IS the
    millisecond start timestamp. Always available, even if metadata.xml and
    events.xml are unreadable. Used as a last-resort sort key so non-published
    rows don't all sink to the bottom of the table."""
    m = _RECORD_ID_TS_RE.match(record_id)
    return int(m.group(1)) if m else None


def _resolve_metadata(record_id):
    """Try metadata.xml first (most reliable), fall back to events.xml for raw,
    finally fall back to the timestamp embedded in the recordId itself."""
    fallback_start = _fallback_start_ms(record_id)
    for candidate in (
        os.path.join(PUBLISHED_DIR, record_id, 'metadata.xml'),
        os.path.join(UNPUBLISHED_DIR, record_id, 'metadata.xml'),
    ):
        if os.path.isfile(candidate):
            m = _parse_metadata_xml(candidate)
            return {
                'meetingName': m['meetingName'],
                'startTimeMs': m['start_time'] or fallback_start,
                'endTimeMs': m['end_time'],
                'externalMeetingId': _extract_external_id(candidate),
            }
    events = os.path.join(RAW_DIR, record_id, 'events.xml')
    if os.path.isfile(events):
        info = _events_xml_meeting_info(events)
        return {
            'meetingName': info['meetingName'],
            # Always use the recordId suffix — events.xml timestamps are
            # relative offsets, not absolute epoch ms.
            'startTimeMs': fallback_start,
            'endTimeMs': None,
            'externalMeetingId': info['externalMeetingId'],
        }
    # No metadata at all — at least give it a sensible startTime so the row
    # surfaces in the UI rather than getting buried at the bottom.
    return {'meetingName': None, 'startTimeMs': fallback_start,
            'endTimeMs': None, 'externalMeetingId': None}


def _extract_external_id(metadata_path):
    """Pull the external meeting ID (the UUID admins know) from metadata.xml.
    BBB stores it under <meta><meetingId>...; the <meeting id="..."> attribute
    is the INTERNAL sha1-timestamp recordId, which is NOT what we want."""
    try:
        root = ET.parse(metadata_path).getroot()
        # Canonical location in BBB 2.x+
        el = root.find('.//meta/meetingId')
        if el is not None and el.text and el.text.strip():
            return el.text.strip()
        # Fallback: some recordings have <meeting meetingId="..."> attribute (vs id="")
        m = root.find('.//meeting')
        if m is not None:
            mid = m.get('meetingId') or m.get('externalId')
            if mid:
                return mid
    except Exception:
        pass
    return None


def list_recordings(page=1, page_size=25):
    """One row per unique recordId across ALL pipeline locations + states. Newest first.
    Size is NOT computed here — clients fetch it lazily via /api/recordings/<id>/size."""
    queued = _read_queue_set()
    current = _read_current_drainer_recid()
    # rap-worker introspection — what it's doing AND what's queued.
    rap_active = {j['recordingId']: j for j in get_rap_worker_active_jobs()}
    rap_queue_contents = get_rap_worker_queue_contents()
    rap_queue_positions = _queue_position_map(rap_queue_contents)
    rap_total_queued = sum(len(v) for v in rap_queue_contents.values())

    rows = []
    for record_id in _scan_all_recording_ids():
        meta = _resolve_metadata(record_id)
        status = _combined_status(record_id, queued, current)
        active = rap_active.get(record_id)
        if active and status not in ('Uploaded', 'Queued', 'Uploading'):
            status = 'Processing'
        queue_info = rap_queue_positions.get(record_id)
        already_queued = (active is not None) or (queue_info is not None)
        # Only `Uploaded` rows are safe to delete (S3 has the copy).
        # Only `Published`/`Queued` rows can be force-enqueued for upload.
        # Stuck pipeline stages (Recording / Awaiting Process / Processing /
        # Publishing) can be rebuilt via the heal service.
        # Rebuild is conceptually OK for these stuck states — but suppress it if
        # the recording is ALREADY queued or actively being processed by rap-worker,
        # to prevent users from piling up duplicate sanity jobs in the queue.
        can_rebuild = (
            status in ('Recording', 'Awaiting Archive', 'Awaiting Process', 'Awaiting Publish', 'Unpublished')
            and not already_queued
        )
        can_upload = status in ('Published', 'Queued')
        duration_sec = None
        if meta['startTimeMs'] and meta['endTimeMs']:
            duration_sec = max(0, (meta['endTimeMs'] - meta['startTimeMs']) // 1000)
        latest = _latest_done_event(record_id)
        latest_ago = int(time.time() - latest[1]) if latest else None
        # Stall detection: an unprocessed recording whose latest pipeline event
        # is more than 5 minutes old AND is not currently active/queued is
        # likely stuck (BBB workflow forgot to enqueue the next stage). Flag
        # it so the user can spot which rows actually need a rebuild vs which
        # are just waiting their turn behind a healthy queue.
        is_stalled = (
            status in ('Recording', 'Awaiting Archive', 'Awaiting Process', 'Awaiting Publish')
            and not already_queued
            and latest_ago is not None
            and latest_ago > 300
        )
        rows.append({
            'recordId': record_id,
            'externalMeetingId': meta['externalMeetingId'],
            'meetingName': meta['meetingName'] or '(unnamed)',
            'startTimeMs': meta['startTimeMs'],
            'durationSeconds': duration_sec,
            'status': status,
            'isStalled': is_stalled,
            'activeStage': active['stage'] if active else None,
            'queuedInStage': queue_info['queue'] if queue_info else None,
            'queuePosition': queue_info['positionOverall'] if queue_info else None,
            'duplicateQueueCount': queue_info['duplicateCount'] if queue_info else 0,
            'alreadyQueued': already_queued,
            'latestStage': latest[0] if latest else None,
            'latestStageAgoSec': latest_ago,
            'fileIds': _read_uploaded_fileids(record_id) if status == 'Uploaded' else [],
            'canDelete': status == 'Uploaded',
            'canUpload': can_upload,
            'canRebuild': can_rebuild,
        })

    # Newest first (entries without a startTime sink to the bottom).
    rows.sort(key=lambda r: r['startTimeMs'] or 0, reverse=True)

    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    start = (page - 1) * page_size
    return {
        'page': page,
        'page_size': page_size,
        'total': total,
        'total_pages': total_pages,
        'current_drainer': current,
        'queued_count': len(queued),
        'rap_queue': get_rap_worker_queue_stats(),
        'rap_total_queued': rap_total_queued,
        'recordings': rows[start:start + page_size],
    }


def recording_size_bytes(record_id):
    """Lazy size lookup (du) with a 5-minute cache."""
    now = time.time()
    cached = _size_cache.get(record_id)
    if cached and (now - cached[1]) < _SIZE_CACHE_TTL_SEC:
        return cached[0]

    # Walk both published + raw for this id.
    total = 0
    for root_dir in (PUBLISHED_DIR, '/var/bigbluebutton/recording/raw'):
        path = os.path.join(root_dir, record_id)
        if not os.path.isdir(path):
            continue
        for dirpath, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
    _size_cache[record_id] = (total, now)
    return total


def rebuild_recording_pipeline(record_id):
    """Re-run BBB's recording pipeline for this recordId. Works on any stuck
    stage (Sanity → Recorded transition stalled, Processing crashed mid-ffmpeg,
    etc) and accepts the INTERNAL recordId directly — no external-ID lookup
    needed. `bbb-record --rebuild` is exactly what the heal service runs under
    the hood; calling it directly here is simpler and works for raw-only
    recordings that don't yet have metadata.xml."""
    if not record_id or not RECORD_ID_RE.match(record_id):
        return False, 'invalid recordId'
    # Ensure something for this recordId actually exists on disk before we
    # spawn the BBB CLI — refuse fast otherwise.
    has_done = any(
        os.path.exists(os.path.join(STATUS_DIR, s, record_id + '.done'))
        for s in PIPELINE_STAGES
    ) or _stage_done_exists(record_id, 'processed') or _stage_done_exists(record_id, 'published')
    if not (
        os.path.isdir(os.path.join(RAW_DIR, record_id))
        or os.path.isdir(os.path.join(PUBLISHED_DIR, record_id))
        or os.path.isdir(os.path.join(UNPUBLISHED_DIR, record_id))
        or has_done
    ):
        return False, 'recording not found on this BBB host'
    # Refuse if the recording is already in a rap-worker queue OR being processed,
    # so a direct curl can't pile up duplicate sanity jobs even if the UI's
    # disabled-button protection is bypassed.
    if {j['recordingId'] for j in get_rap_worker_active_jobs()} & {record_id}:
        return False, 'recording is currently being processed — rebuild already in flight'
    queue_contents = get_rap_worker_queue_contents()
    for q_name, q_ids in queue_contents.items():
        if record_id in q_ids:
            pos = q_ids.index(record_id) + 1
            return False, f'recording is already queued (position #{pos} in rap:{q_name}) — no new rebuild needed'
    try:
        result = subprocess.run(
            ['bbb-record', '--rebuild', record_id],
            capture_output=True, text=True, timeout=60,
        )
        ok = result.returncode == 0
        out = (result.stdout or '') + (result.stderr or '')
        return ok, (out.strip()[-4000:] or ('rebuild triggered' if ok else 'failed'))
    except subprocess.TimeoutExpired:
        return False, 'bbb-record --rebuild timed out'
    except Exception as e:
        return False, str(e)


def enqueue_recording_for_upload(record_id):
    """Append the recordId to /var/spool/bbb-recording-queue.txt so the drainer
    picks it up on its next minute-tick. Used by the dashboard's
    "Upload to S3" action on Published rows.

    Safe to call repeatedly: drainer dedupes via `sort -u` before processing,
    and the post-publish hook itself is idempotent (`/recording/complete` is
    a no-op once registered).
    """
    if not record_id or not RECORD_ID_RE.match(record_id):
        return False, 'invalid recordId'
    presentation_dir = os.path.join(PUBLISHED_DIR, record_id)
    if not os.path.isdir(presentation_dir):
        return False, 'recording not found on disk'
    if _is_uploaded(record_id):
        return False, 'already uploaded to S3'
    if _read_current_drainer_recid() == record_id:
        return False, 'upload already in progress'
    if record_id in _read_queue_set():
        return False, 'already queued — drainer will pick it up shortly'

    try:
        # Append; mode 'a' + a flock-like lockfile would be ideal but we're
        # the only Python writer and the bash hook uses flock on the same
        # path, so an append from here is naturally race-tolerant.
        with open(QUEUE_FILE, 'a') as f:
            f.write(record_id + '\n')
        return True, f'queued {record_id}'
    except Exception as e:
        return False, str(e)


def delete_recording_from_bbb(record_id):
    """Delete a single recording from BBB disk only. S3 copy untouched.
    Uses bbb-record --delete which handles published/, raw/, and status/.
    Refuses to delete unless the recording has already been uploaded to S3."""
    # Strict shape check (sha1-hex + dash + 13-digit ms timestamp) so a malicious
    # recordId can't smuggle in a leading dash that bbb-record would parse as a flag,
    # path-traversal segments, newlines for log injection, etc.
    if not record_id or not RECORD_ID_RE.match(record_id):
        return False, 'invalid recordId'
    if not _is_uploaded(record_id):
        return False, 'recording is not yet uploaded to S3 — refusing to delete'
    # Race guard: if the drainer is currently processing this recordId, refuse.
    # Without this, bbb-record --delete would yank published/<id> out from
    # under the running ffmpeg → corrupt upload + S3 garbage.
    if _read_current_drainer_recid() == record_id:
        return False, 'recording is currently being uploaded — try again in a few minutes'

    try:
        result = subprocess.run(
            ['bbb-record', '--delete', record_id],
            capture_output=True, text=True, timeout=120,
        )
        ok = result.returncode == 0
        out = (result.stdout or '') + (result.stderr or '')
        # Clean up our own markers so the status flips back to "not present"
        if ok:
            try: os.remove(os.path.join(UPLOADED_DIR, record_id))
            except OSError: pass
            _size_cache.pop(record_id, None)
        return ok, out[-4000:]  # tail any noisy output
    except subprocess.TimeoutExpired:
        return False, 'bbb-record --delete timed out'
    except Exception as e:
        return False, str(e)


def delete_recordings_bulk(record_ids):
    """Delete several recordings from BBB disk in one request. Each id goes
    through delete_recording_from_bbb, which enforces the same guards as the
    single-row delete (must already be uploaded to S3; not mid-upload). Returns
    a per-id summary so the UI can report partial success."""
    if not isinstance(record_ids, list):
        return {'deletedCount': 0, 'failedCount': 0, 'deleted': [],
                'failed': [], 'error': 'recordIds must be a list'}
    # De-dupe, preserve order, and cap to avoid a pathological request.
    seen = set()
    ordered = []
    for rid in record_ids:
        if isinstance(rid, str) and rid not in seen:
            seen.add(rid)
            ordered.append(rid)
    deleted, failed = [], []
    for rid in ordered[:200]:
        ok, output = delete_recording_from_bbb(rid)
        if ok:
            deleted.append(rid)
        else:
            failed.append({'recordId': rid, 'reason': (output or '').strip()[:300]})
    log(f"ACTION: bulk-delete requested={len(ordered)} deleted={len(deleted)} failed={len(failed)}")
    return {'deletedCount': len(deleted), 'failedCount': len(failed),
            'deleted': deleted, 'failed': failed}


def get_rap_worker_active_jobs():
    """Inspect redis for rap-worker(s) currently mid-job. Returns a list:
       [{ 'recordingId': '...', 'stage': 'sanity'|'archive'|'process'|'publish'|'post_publish',
          'startedAt': iso-ish-string, 'worker': '...' }, ...]

    Each rap-worker process is tracked in redis under `resque:worker:<id>`.
    When idle that key is absent; when working it holds a JSON payload that
    names the queue + the meeting_id being processed. We surface this so the
    dashboard can flip a row's badge to 'Processing' (orange tint, pulsing)
    while rap-worker is actually running ffmpeg on it."""
    active = []
    try:
        result = subprocess.run(
            ['redis-cli', '--raw', 'SMEMBERS', 'resque:workers'],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode != 0:
            return active
        worker_ids = [w.strip() for w in result.stdout.split('\n') if w.strip()]
        for wid in worker_ids:
            r = subprocess.run(
                ['redis-cli', '--raw', 'GET', f'resque:worker:{wid}'],
                capture_output=True, text=True, timeout=2,
            )
            body = r.stdout.strip()
            if not body or body == '(nil)':
                continue
            try:
                payload = json.loads(body)
            except (ValueError, json.JSONDecodeError):
                try:
                    payload = json.loads(json.loads(body))
                except Exception:
                    continue
            queue = payload.get('queue', '')
            # rap-worker queues are named 'rap:sanity', 'rap:archive', etc.
            stage = queue.split(':', 1)[1] if ':' in queue else queue
            run_at = payload.get('run_at', '')
            # args is usually [{ meeting_id: '...' }]
            args = (payload.get('payload') or {}).get('args') or []
            rec_id = None
            if args and isinstance(args[0], dict):
                rec_id = args[0].get('meeting_id') or args[0].get('meetingId')
            elif args and isinstance(args[0], str):
                rec_id = args[0]
            if rec_id:
                active.append({
                    'recordingId': rec_id,
                    'stage': stage,
                    'startedAt': run_at,
                    'worker': wid,
                })
    except Exception:
        pass
    return active


def get_rap_worker_queue_contents():
    """For each rap-worker queue, return the ordered list of recordIds in line.
    Used to (a) tell users their queue position and (b) suppress double-rebuilds
    when a recording is already pending in any rap-worker queue.

    Includes 'captions' and 'events' because some BBB versions route through
    'sanity → captions → process → publish'; ignoring captions would make
    captions-queued recordings appear stalled when they're actually just waiting."""
    queues = ['sanity', 'archive', 'process', 'publish', 'post_publish', 'captions', 'events']
    contents = {q: [] for q in queues}
    for q in queues:
        try:
            # `--raw` makes redis-cli output the raw byte content of each value
            # (one per line), no outer quoting or escape processing — easier to
            # parse than the default which may double-quote-encode strings.
            r = subprocess.run(
                ['redis-cli', '--raw', 'LRANGE', f'resque:queue:rap:{q}', '0', '-1'],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode != 0:
                continue
            for raw_line in r.stdout.split('\n'):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except (ValueError, json.JSONDecodeError):
                    # Fall back: try treating it as JSON-quoted string (default
                    # redis-cli mode for binary-unsafe values).
                    try:
                        data = json.loads(json.loads(line))
                    except Exception:
                        continue
                args = data.get('args') or []
                rid = None
                if args and isinstance(args[0], dict):
                    rid = args[0].get('meeting_id') or args[0].get('meetingId')
                if rid:
                    contents[q].append(rid)
        except Exception:
            pass
    return contents


def _queue_position_map(queue_contents):
    """Given queue contents, return a dict:
       recordId -> { queue, positionInQueue (1-indexed), positionOverall (1-indexed),
                      duplicateCount (total appearances across all queues) }
    Overall position uses the actual rap-worker subscription priority:
       archive > publish > process > sanity > captions > events > post_publish.
    Higher-priority jobs get pulled first; recordings in low-priority queues
    can stall indefinitely behind a busy high-priority queue.

    duplicateCount surfaces accidental over-rebuilds — every rebuild enqueues
    a fresh sanity job which eventually enqueues a captions job, so a
    rebuilt-3-times recording sits in the queue 3+ times."""
    priority = ('archive', 'publish', 'process', 'sanity', 'captions', 'events', 'post_publish')
    # Count appearances across ALL queues first
    appearances = {}
    for q in priority:
        for rid in queue_contents.get(q, []):
            appearances[rid] = appearances.get(rid, 0) + 1
    result = {}
    cumulative = 0
    for q in priority:
        for i, rid in enumerate(queue_contents.get(q, [])):
            if rid not in result:  # first occurrence (highest priority queue) wins
                result[rid] = {
                    'queue': q,
                    'positionInQueue': i + 1,
                    'positionOverall': cumulative + i + 1,
                    'duplicateCount': appearances.get(rid, 1),
                }
        cumulative += len(queue_contents.get(q, []))
    return result


def get_rap_worker_queue_stats():
    """Read BBB rap-worker resque queue depths from redis. These are the
    queues that fill when 'bbb-record --rebuild' runs OR when a meeting ends
    and BBB starts processing the recording. Distinct from our S3 upload
    queue (which only fills *after* a recording reaches 'published').

    Returns a dict like {'sanity': 3, 'archive': 0, ...} and a total."""
    queues = ['sanity', 'archive', 'process', 'publish', 'post_publish', 'captions', 'events']
    stats = {}
    total = 0
    for q in queues:
        try:
            result = subprocess.run(
                ['redis-cli', 'LLEN', f'resque:queue:rap:{q}'],
                capture_output=True, text=True, timeout=3,
            )
            if result.returncode == 0:
                n = int(result.stdout.strip() or '0')
                stats[q] = n
                total += n
        except Exception:
            stats[q] = 0
    return {'stages': stats, 'total': total}


def get_upload_queue_stats():
    """Recordings queued for deferred S3 upload by the post-publish hook.
    Reads /var/spool/bbb-recording-queue.txt (written by the hook in queue
    mode, drained by bbb-recording-drain.timer)."""
    queue_file = '/var/spool/bbb-recording-queue.txt'
    drainer_active = False
    try:
        # systemctl is-active returns 0 only when the service is currently running
        rc = subprocess.run(
            ['systemctl', 'is-active', '--quiet', 'bbb-recording-drain.service'],
            timeout=2,
        ).returncode
        drainer_active = (rc == 0)
    except Exception:
        pass

    queued = 0
    try:
        with open(queue_file, 'r') as f:
            queued = sum(1 for line in f if line.strip())
    except FileNotFoundError:
        pass
    except Exception:
        pass

    return {
        'queued': queued,
        'drainer_active': drainer_active,
    }


def get_bbb_meetings():
    """Query BBB API for active meetings and participant counts."""
    if not BBB_SECRET:
        return {'meeting_count': 0, 'participant_count': 0, 'listener_count': 0,
                'voice_count': 0, 'video_count': 0, 'meetings': [], 'error': 'BBB_SECRET not set'}

    call = 'getMeetings'
    checksum = hashlib.sha1(f'{call}{BBB_SECRET}'.encode()).hexdigest()
    url = f'https://{BBB_DOMAIN}/bigbluebutton/api/{call}?checksum={checksum}'

    try:
        with urlopen(url, timeout=10) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)

        if root.find('returncode').text != 'SUCCESS':
            return {'meeting_count': 0, 'participant_count': 0, 'listener_count': 0,
                    'voice_count': 0, 'video_count': 0, 'meetings': []}

        meetings = []
        total_participants = 0
        total_listeners = 0
        total_voice = 0
        total_video = 0

        for m in root.findall('.//meeting'):
            name = m.findtext('meetingName', '')
            participants = int(m.findtext('participantCount', '0'))
            listeners = int(m.findtext('listenerCount', '0'))
            voice = int(m.findtext('voiceParticipantCount', '0'))
            video = int(m.findtext('videoCount', '0'))
            running = m.findtext('running', 'false') == 'true'
            recording = m.findtext('recording', 'false') == 'true'
            start_time = m.findtext('startTime', '0')

            total_participants += participants
            total_listeners += listeners
            total_voice += voice
            total_video += video

            meetings.append({
                'name': name,
                'participants': participants,
                'listeners': listeners,
                'voice': voice,
                'video': video,
                'running': running,
                'recording': recording,
                'start_time': start_time,
            })

        return {
            'meeting_count': len(meetings),
            'participant_count': total_participants,
            'listener_count': total_listeners,
            'voice_count': total_voice,
            'video_count': total_video,
            'meetings': meetings,
        }
    except URLError as e:
        return {'meeting_count': 0, 'participant_count': 0, 'listener_count': 0,
                'voice_count': 0, 'video_count': 0, 'meetings': [], 'error': str(e)}
    except Exception as e:
        return {'meeting_count': 0, 'participant_count': 0, 'listener_count': 0,
                'voice_count': 0, 'video_count': 0, 'meetings': [], 'error': str(e)}


def run_delete_old_recordings():
    """Delete recordings older than 2 days. Returns (success, output)."""
    cmd = (
        "echo '=== Deleting published presentations older than 2 days ===' && "
        "find /var/bigbluebutton/published/presentation/ -maxdepth 1 -mindepth 1 -type d -mtime +2 -print -exec rm -rf {} + 2>&1 && "
        "echo '' && echo '=== Deleting raw recordings older than 2 days ===' && "
        "find /var/bigbluebutton/recording/raw/ -maxdepth 1 -mindepth 1 -type d -mtime +2 -print -exec rm -rf {} + 2>&1 && "
        "echo '' && echo '=== Deleting status markers older than 2 days ===' && "
        "find /var/bigbluebutton/recording/status/ -name '*.done' -mtime +2 -print -delete 2>&1 && "
        "echo '' && echo 'Done.'"
    )
    try:
        r = subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, timeout=120)
        output = r.stdout + r.stderr
        return (r.returncode == 0, output.strip() or 'Completed (no output)')
    except subprocess.TimeoutExpired:
        return (False, 'ERROR: Command timed out after 120 seconds')
    except Exception as e:
        return (False, f'ERROR: {e}')


def run_restart_bbb():
    """Restart BBB and re-set IP. Returns (success, output)."""
    cmd = f"bbb-conf --setip {BBB_DOMAIN} 2>&1 && bbb-conf --restart 2>&1"
    try:
        r = subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, timeout=180)
        output = r.stdout + r.stderr
        return (r.returncode == 0, output.strip() or 'Completed (no output)')
    except subprocess.TimeoutExpired:
        return (False, 'ERROR: Command timed out after 180 seconds')
    except Exception as e:
        return (False, f'ERROR: {e}')


DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BBB Health Dashboard</title>
<style>
  :root {
    --bg: #0f172a; --card: #1e293b; --border: #334155;
    --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8;
    --green: #22c55e; --red: #ef4444; --yellow: #eab308; --orange: #f97316;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 16px; min-height: 100vh; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 0.85rem; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 1rem; margin-bottom: 14px; color: var(--accent); }
  .metric-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .metric-label { color: var(--muted); font-size: 0.85rem; }
  .metric-value { font-weight: 600; font-size: 0.95rem; }
  .bar-bg { width: 100%; height: 8px; background: var(--border); border-radius: 4px; margin-top: 4px; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
  .bar-ok { background: var(--green); }
  .bar-warn { background: var(--yellow); }
  .bar-danger { background: var(--red); }
  .svc-list { list-style: none; }
  .svc-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  .svc-item:last-child { border-bottom: none; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot-active { background: var(--green); }
  .dot-inactive { background: var(--red); }
  .dot-unknown { background: var(--muted); }
  .svc-name { flex: 1; }
  .svc-status { color: var(--muted); font-size: 0.8rem; }
  .actions { display: flex; flex-direction: column; gap: 12px; }
  .action-btn { padding: 12px 20px; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  .action-btn:hover { opacity: 0.85; }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-delete { background: var(--orange); color: #fff; }
  .btn-restart { background: var(--red); color: #fff; }
  .action-output { background: #0d1117; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-top: 8px; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; max-height: 300px; overflow-y: auto; display: none; color: var(--muted); }
  .action-output.visible { display: block; }
  .recording-stats { display: flex; gap: 20px; margin-bottom: 14px; }
  .stat-box { text-align: center; }
  .stat-num { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
  .stat-label { font-size: 0.75rem; color: var(--muted); }
  .refresh-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .refresh-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
  .refresh-btn:hover { background: var(--border); }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--muted); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .timestamp { color: var(--muted); font-size: 0.75rem; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .tab { background: transparent; border: none; color: var(--muted); padding: 10px 18px; cursor: pointer; font-size: 0.9rem; font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  table.recordings { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  table.recordings th, table.recordings td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
  table.recordings th { color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
  table.recordings tr:hover { background: rgba(255,255,255,0.02); }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
  .badge-uploaded { background: rgba(34,197,94,0.18); color: var(--green); }
  .badge-queued { background: rgba(234,179,8,0.18); color: var(--yellow); }
  .badge-uploading { background: rgba(249,115,22,0.18); color: var(--orange); }
  .badge-published { background: rgba(148,163,184,0.18); color: var(--muted); }
  .badge-recording { background: rgba(56,189,248,0.18); color: var(--accent); }
  .badge-awaitingarchive { background: rgba(56,189,248,0.18); color: var(--accent); }
  .badge-awaitingprocess { background: rgba(168,85,247,0.22); color: #a855f7; }
  .badge-awaitingpublish { background: rgba(168,85,247,0.22); color: #a855f7; }
  .badge-processing { background: rgba(249,115,22,0.25); color: var(--orange); animation: badge-pulse 1.6s ease-in-out infinite; }
  @keyframes badge-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .badge-unpublished { background: rgba(148,163,184,0.18); color: var(--muted); }
  .badge-unknown { background: rgba(239,68,68,0.18); color: var(--red); }
  .stage-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 6px; font-size: 0.65rem; background: rgba(168,85,247,0.15); color: #a855f7; font-weight: 500; }
  .stalled-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 6px; font-size: 0.65rem; background: rgba(239,68,68,0.18); color: var(--red); font-weight: 600; }
  .size-btn { background: transparent; border: 1px solid var(--border); color: var(--muted); padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; }
  .size-btn:hover { color: var(--text); border-color: var(--accent); }
  .row-delete { background: transparent; border: 1px solid var(--red); color: var(--red); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; }
  .row-delete:hover { background: var(--red); color: #fff; }
  .row-delete:disabled { opacity: 0.3; cursor: not-allowed; }
  .row-upload { background: transparent; border: 1px solid var(--green); color: var(--green); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; margin-right: 6px; }
  .row-upload:hover { background: var(--green); color: #fff; }
  .row-upload:disabled { opacity: 0.3; cursor: not-allowed; }
  .row-rebuild { background: transparent; border: 1px solid #a855f7; color: #a855f7; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; margin-right: 6px; }
  .row-rebuild:hover { background: #a855f7; color: #fff; }
  .row-rebuild:disabled { opacity: 0.3; cursor: not-allowed; }
  .live-banner { background: linear-gradient(90deg, rgba(249,115,22,0.18), rgba(249,115,22,0.06)); border: 1px solid var(--orange); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
  .live-banner .pulse { width: 8px; height: 8px; background: var(--orange); border-radius: 50%; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.6); } }
  .row-active { background: rgba(249,115,22,0.08); }
  .pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 16px; font-size: 0.85rem; color: var(--muted); }
  .pagination button { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 4px; cursor: pointer; margin: 0 4px; }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .pagination button:not(:disabled):hover { border-color: var(--accent); }
  .pager-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 2px; }
  .pagination button.page-num { min-width: 32px; padding: 6px 8px; margin: 0; text-align: center; }
  /* The current page stays solid rather than greyed out, even though it is
     disabled — otherwise the one page you are on is the hardest one to read. */
  .pagination button.page-num.current { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; opacity: 1; cursor: default; }
  .pagination .page-gap { color: var(--muted); padding: 0 4px; }
  .recid { font-family: monospace; font-size: 0.7rem; color: var(--muted); }
  .chk-col { width: 30px; text-align: center; }
  .chk-col input { cursor: pointer; }
  .bulk-bar { display: none; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 12px; background: rgba(239,68,68,0.08); border: 1px solid var(--red); border-radius: 8px; font-size: 0.85rem; flex-wrap: wrap; }
  .bulk-bar.visible { display: flex; }
  .bulk-bar #bulkCount { font-weight: 600; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } body { padding: 10px; } table.recordings { font-size: 0.75rem; } table.recordings th, table.recordings td { padding: 6px 4px; } }
</style>
</head>
<body>
<h1>BBB Server Health</h1>
<p class="subtitle" id="domain">DOMAIN_PLACEHOLDER</p>

<div class="tabs">
  <button class="tab active" id="tabBtnOverview" onclick="switchTab('overview')">Overview</button>
  <button class="tab" id="tabBtnRecordings" onclick="switchTab('recordings')">Recordings</button>
</div>

<div id="tab-overview" class="tab-panel active">

<div class="refresh-bar">
  <span class="timestamp" id="lastUpdate">Loading...</span>
  <button class="refresh-btn" onclick="loadMetrics()">Refresh</button>
</div>

<div class="grid">
  <!-- System Metrics -->
  <div class="card">
    <h2>System Metrics</h2>
    <div id="metricsContent"><span class="spinner"></span> Loading...</div>
  </div>

  <!-- BBB Services -->
  <div class="card">
    <h2>BBB Services</h2>
    <div id="servicesContent"><span class="spinner"></span> Loading...</div>
  </div>

  <!-- Live Meetings -->
  <div class="card">
    <h2>Live Meetings</h2>
    <div id="meetingsContent"><span class="spinner"></span> Loading...</div>
  </div>

  <!-- Recordings -->
  <div class="card">
    <h2>Recordings on Disk</h2>
    <div id="recordingsContent"><span class="spinner"></span> Loading...</div>
  </div>

  <!-- Quick Actions -->
  <div class="card">
    <h2>Quick Actions</h2>
    <div class="actions">
      <div>
        <button class="action-btn btn-delete" id="btnDelete" onclick="runAction('delete-old-recordings', 'btnDelete', 'outDelete')">
          Delete Recordings Older Than 2 Days
        </button>
        <div class="action-output" id="outDelete"></div>
      </div>
      <div>
        <button class="action-btn btn-restart" id="btnRestart" onclick="runAction('restart-bbb', 'btnRestart', 'outRestart')">
          Restart BBB + Set IP
        </button>
        <div class="action-output" id="outRestart"></div>
      </div>
    </div>
  </div>
</div>
</div>
<!-- /tab-overview -->

<div id="tab-recordings" class="tab-panel">
  <div class="card">
    <div class="refresh-bar">
      <span class="timestamp" id="recordingsMeta">Click Refresh to load.</span>
      <button class="refresh-btn" onclick="loadRecordings(1)">Refresh</button>
    </div>
    <div class="bulk-bar" id="bulkBar">
      <span id="bulkCount">0 selected</span>
      <button class="row-delete" onclick="deleteSelected()">Delete selected from BBB</button>
      <button class="refresh-btn" onclick="clearSelection()">Clear</button>
      <span style="color:var(--muted);font-size:0.75rem">Only uploaded recordings are selectable — S3 keeps the copy.</span>
    </div>
    <div id="recordingsTableWrap"></div>
    <div class="pagination" id="recordingsPagination" style="display:none">
      <span id="paginationInfo"></span>
      <span class="pager-controls">
        <button id="prevPage" onclick="loadRecordings(currentPage - 1)">‹ Prev</button>
        <span id="pageNumbers"></span>
        <button id="nextPage" onclick="loadRecordings(currentPage + 1)">Next ›</button>
      </span>
    </div>
  </div>
</div>

<script>
const TOKEN = new URLSearchParams(window.location.search).get('token') || '';
const BASE = window.location.pathname.replace(/\/$/, '');

function apiUrl(path) {
  return BASE + path + '?token=' + encodeURIComponent(TOKEN);
}

function barClass(pct) {
  if (pct > 85) return 'bar-danger';
  if (pct > 65) return 'bar-warn';
  return 'bar-ok';
}

function metricBlock(label, value, pct) {
  return `
    <div class="metric-row">
      <span class="metric-label">${label}</span>
      <span class="metric-value">${value}</span>
    </div>
    <div class="bar-bg"><div class="bar-fill ${barClass(pct)}" style="width:${Math.min(pct,100)}%"></div></div>
    <div style="height:8px"></div>`;
}

function cpuBlock(cpu) {
  const usage = cpu.usage_percent != null ? cpu.usage_percent : (cpu.percent || 0);
  const iowait = cpu.iowait_percent != null ? cpu.iowait_percent : 0;
  let procs = '';
  if (cpu.top_processes && cpu.top_processes.length) {
    procs = '<div style="margin-top:6px;font-size:0.72rem;color:var(--muted)">' +
      cpu.top_processes.map(p =>
        `<div style="display:flex;justify-content:space-between"><span>${escapeHtml(p.name)}</span><span>${p.cpu_percent}%</span></div>`
      ).join('') +
      '<div style="opacity:0.6;margin-top:2px">per-process: 100% = 1 core</div></div>';
  }
  return `
    <div class="metric-row">
      <span class="metric-label">CPU usage</span>
      <span class="metric-value">${usage}% <span style="color:var(--muted);font-weight:400">· iowait ${iowait}%</span></span>
    </div>
    <div class="bar-bg"><div class="bar-fill ${barClass(usage)}" style="width:${Math.min(usage,100)}%"></div></div>
    <div style="margin-top:4px;font-size:0.72rem;color:var(--muted)">load avg ${cpu.load_1} / ${cpu.load_5} / ${cpu.load_15} · ${cpu.cpu_count} cores</div>
    ${procs}
    <div style="height:8px"></div>`;
}

async function loadMetrics() {
  try {
    const res = await fetch(apiUrl('/api/metrics'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();

    // System metrics
    const disk = d.disk, mem = d.memory, cpu = d.cpu;
    document.getElementById('metricsContent').innerHTML =
      metricBlock('Disk', `${disk.used_gb} / ${disk.total_gb} GB (${disk.free_gb} GB free)`, disk.percent) +
      metricBlock('Memory', `${mem.used_mb} / ${mem.total_mb} MB`, mem.percent) +
      cpuBlock(cpu);

    // Services
    let html = '<ul class="svc-list">';
    for (const svc of d.services) {
      const cls = svc.status === 'active' ? 'dot-active' : svc.status === 'inactive' ? 'dot-inactive' : 'dot-unknown';
      html += `<li class="svc-item"><span class="dot ${cls}"></span><span class="svc-name">${svc.name}</span><span class="svc-status">${svc.status}</span></li>`;
    }
    html += '</ul>';
    document.getElementById('servicesContent').innerHTML = html;

    // Live Meetings
    const mtg = d.meetings;
    let mtgHtml = `
      <div class="recording-stats">
        <div class="stat-box"><div class="stat-num">${mtg.meeting_count}</div><div class="stat-label">Meetings</div></div>
        <div class="stat-box"><div class="stat-num">${mtg.participant_count}</div><div class="stat-label">Participants</div></div>
        <div class="stat-box"><div class="stat-num">${mtg.video_count}</div><div class="stat-label">Video</div></div>
        <div class="stat-box"><div class="stat-num">${mtg.voice_count}</div><div class="stat-label">Audio</div></div>
      </div>`;
    if (mtg.meetings && mtg.meetings.length > 0) {
      mtgHtml += '<ul class="svc-list" style="margin-top:10px">';
      for (const m of mtg.meetings) {
        const recDot = m.recording ? ' 🔴' : '';
        const elapsed = m.start_time > 0 ? Math.round((Date.now() - parseInt(m.start_time)) / 60000) + ' min' : '';
        mtgHtml += `<li class="svc-item"><span class="dot dot-active"></span><span class="svc-name">${escapeHtml(m.name)}${recDot}</span><span class="svc-status">${m.participants} users · ${elapsed}</span></li>`;
      }
      mtgHtml += '</ul>';
    }
    if (mtg.error) { mtgHtml += `<div style="color:var(--red);font-size:0.8rem;margin-top:8px">${escapeHtml(mtg.error)}</div>`; }
    document.getElementById('meetingsContent').innerHTML = mtgHtml;

    // Recordings
    const rec = d.recordings;
    const q = d.upload_queue || {queued: 0, drainer_active: false};
    const queueColor = q.queued > 10 ? 'var(--red)'
                     : q.queued > 0  ? 'var(--yellow)'
                                     : 'var(--text)';
    const drainerLabel = q.drainer_active ? 'Drainer running'
                       : q.queued > 0     ? 'Queued — waiting'
                                          : 'Idle';
    document.getElementById('recordingsContent').innerHTML = `
      <div class="recording-stats">
        <div class="stat-box"><div class="stat-num">${rec.count}</div><div class="stat-label">Directories</div></div>
        <div class="stat-box"><div class="stat-num">${rec.size_gb}</div><div class="stat-label">GB on disk</div></div>
        <div class="stat-box"><div class="stat-num" style="color:${queueColor}">${q.queued}</div><div class="stat-label">Upload queue</div></div>
      </div>
      <div style="margin-top:8px;font-size:0.8rem;color:var(--text-dim)">${drainerLabel}</div>`;

    document.getElementById('domain').textContent = d.domain || '';
    document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('metricsContent').innerHTML = '<span style="color:var(--red)">Failed to load: ' + e.message + '</span>';
  }
}

async function runAction(action, btnId, outId) {
  const labels = {
    'delete-old-recordings': 'This will DELETE all recordings older than 2 days. Continue?',
    'restart-bbb': 'This will RESTART all BBB services and re-set the IP. This may take 1-2 minutes. Continue?',
  };
  if (!confirm(labels[action] || 'Are you sure?')) return;

  const btn = document.getElementById(btnId);
  const out = document.getElementById(outId);
  const origText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running...';
  out.textContent = 'Executing...';
  out.classList.add('visible');

  try {
    const res = await fetch(apiUrl('/api/action/' + action), { method: 'POST' });
    const d = await res.json();
    out.textContent = (d.success ? 'SUCCESS' : 'FAILED') + '\n\n' + (d.output || '');
    if (d.success) setTimeout(loadMetrics, 1000);
  } catch (e) {
    out.textContent = 'ERROR: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Tabs ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tabBtn' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'recordings' && !recordingsLoadedOnce) {
    recordingsLoadedOnce = true;
    loadRecordings(1);
  }
}

// ── Recordings tab ────────────────────────────────────────
let currentPage = 1;
let recordingsLoadedOnce = false;
let selectedRecordings = new Set();

function badgeClass(status) {
  // Strip spaces so "Awaiting Process" -> "awaitingprocess" matches CSS.
  return 'badge badge-' + status.toLowerCase().replace(/\s+/g, '');
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function fmtDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function fmtAgo(s) {
  if (s == null) return '';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fmtBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// Pages to show: always the first and the last, plus a window of `span`
// either side of the current one. Whatever is left out collapses into an
// ellipsis, so the control is the same width at 3 pages and at 300.
function pageList(page, totalPages, span) {
  const out = [1];
  const lo = Math.max(2, page - span);
  const hi = Math.min(totalPages - 1, page + span);
  if (lo > 2) out.push('gap');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < totalPages - 1) out.push('gap');
  if (totalPages > 1) out.push(totalPages);
  return out;
}

function renderPageNumbers(page, totalPages) {
  const box = document.getElementById('pageNumbers');
  if (totalPages <= 1) { box.innerHTML = ''; return; }
  box.innerHTML = pageList(page, totalPages, 2).map(p => {
    if (p === 'gap') return '<span class="page-gap">\u2026</span>';
    const cur = p === page;
    return '<button class="page-num' + (cur ? ' current' : '') + '"'
         + (cur ? ' disabled' : '')
         + ' title="Page ' + p + '" onclick="loadRecordings(' + p + ')">' + p + '</button>';
  }).join('');
}

async function loadRecordings(page) {
  if (!page || page < 1) return;
  currentPage = page;
  selectedRecordings.clear();
  updateBulkBar();
  const wrap = document.getElementById('recordingsTableWrap');
  wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)"><span class="spinner"></span> Loading recordings...</div>';
  document.getElementById('recordingsPagination').style.display = 'none';

  try {
    const res = await fetch(apiUrl('/api/recordings') + '&page=' + page);
    const d = await res.json();

    const rap = d.rap_queue || {total: 0, stages: {}};
    const stagesDetail = Object.entries(rap.stages || {})
      .filter(([k, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`).join(', ');

    // Rough per-stage averages (seconds). The 'process' stage is the ffmpeg-heavy
    // one and dominates wait time; other stages are negligible by comparison.
    // Under CPUWeight=10 during class hours, multiply mentally by ~3x.
    // Avg DOWNSTREAM seconds per queued item — i.e. how long until that item
    // is fully through the pipeline, NOT just how long its own stage takes.
    // A captions job will trigger a process job on completion (the slow ffmpeg
    // step), so its true contribution is captions+process+publish time.
    //
    // Process stage time (~350s on 8-core box w/ -threads 0; decoder is the
    // real bottleneck, not encoder) is the dominant factor — every other
    // stage is fast. Adjust this single constant as your box's actual
    // ffmpeg throughput shifts.
    const PROCESS_SEC = 350;
    const AVG_DOWNSTREAM_SEC = {
      sanity:       15 + 10 + PROCESS_SEC + 30 + 60,
      archive:           10 + PROCESS_SEC + 30 + 60,
      captions:          10 + PROCESS_SEC + 30 + 60,
      process:                PROCESS_SEC + 30 + 60,
      publish:                              30 + 60,
      post_publish:                              60,
      events:                                    10,
    };
    let etaSec = 0;
    for (const [q, n] of Object.entries(rap.stages || {})) etaSec += (AVG_DOWNSTREAM_SEC[q] || 60) * n;
    const etaLabel = etaSec >= 3600 ? `~${(etaSec/3600).toFixed(1)}h` : `~${Math.ceil(etaSec/60)}m`;

    const stalled = d.recordings.filter(r => r.isStalled).length;
    document.getElementById('recordingsMeta').innerHTML =
      `${d.total} recording(s) on disk · ` +
      `BBB pipeline: ${rap.total} pending${stagesDetail ? ' (' + stagesDetail + ')' : ''}` +
      `${rap.total > 0 ? ' · est. clear: ' + etaLabel : ''} · ` +
      `S3 upload: ${d.queued_count} queued · ` +
      (d.current_drainer ? `uploading ${d.current_drainer.slice(0, 12)}…` : 'idle') +
      (stalled > 0 ? ` · <span style="color:var(--red);font-weight:600">⚠ ${stalled} stalled on this page</span>` : '');

    // Prominent banner when something is mid-upload — much more obvious than
    // a one-line counter, and animates so users notice without polling.
    let bannerHtml = '';
    if (d.current_drainer) {
      bannerHtml = `<div class="live-banner">
        <span class="pulse"></span>
        <span><strong>Uploading to S3 now:</strong> <span class="recid">${escapeHtml(d.current_drainer)}</span></span>
      </div>`;
    } else if (d.queued_count > 0) {
      bannerHtml = `<div class="live-banner" style="border-color:var(--yellow);background:linear-gradient(90deg,rgba(234,179,8,0.15),rgba(234,179,8,0.04))">
        <span class="pulse" style="background:var(--yellow)"></span>
        <span><strong>${d.queued_count}</strong> recording(s) queued — drainer will start within a minute</span>
      </div>`;
    } else if (rap.total > 0) {
      bannerHtml = `<div class="live-banner" style="border-color:#a855f7;background:linear-gradient(90deg,rgba(168,85,247,0.15),rgba(168,85,247,0.04))">
        <span class="pulse" style="background:#a855f7"></span>
        <span><strong>BBB pipeline: ${rap.total}</strong> recording(s) processing${stagesDetail ? ' — ' + stagesDetail : ''}. Refresh in a few minutes.</span>
      </div>`;
    }

    if (d.recordings.length === 0) {
      wrap.innerHTML = bannerHtml + '<div style="padding:20px;text-align:center;color:var(--muted)">No recordings on disk.</div>';
      return;
    }

    let html = `<table class="recordings"><thead><tr>
      <th class="chk-col"><input type="checkbox" id="selectAllRecs" title="Select all uploaded on this page" onclick="toggleSelectAll(this)"></th>
      <th>Meeting</th><th>Started</th><th>Duration</th><th>Status</th><th>Size</th><th>Actions</th>
    </tr></thead><tbody>`;
    for (const r of d.recordings) {
      // The server validates recordIds with a strict regex (sha1-hex-13digit),
      // but escape everywhere anyway as defence in depth — if a future code
      // path ever surfaces an unvalidated id, this still blocks XSS.
      const safeId = r.recordId.replace(/[^a-z0-9-]/gi, '');
      const ridAttr = escapeHtml(r.recordId);
      // These are interpolated into double-quoted onclick="" attributes, so they
      // need BOTH JS-string escaping (escapeJs) AND HTML-attribute escaping
      // (escapeHtml). escapeJs alone backslash-escapes a " but leaves it literal,
      // which closes the attribute and allows handler injection — stored XSS via
      // a crafted meeting name. escapeHtml encodes the " (and < > &) so it can't
      // break out; the JS string still round-trips to the original value.
      const ridJs = escapeHtml(escapeJs(r.recordId));
      const nameJs = escapeHtml(escapeJs(r.meetingName || ''));
      const extId = r.externalMeetingId ? escapeHtml(r.externalMeetingId) : '';
      // Highlight row when rap-worker is actively processing it or our drainer is uploading it.
      const rowClass = (r.status === 'Uploading' || r.status === 'Processing') ? 'row-active' : '';
      let stageTag = '';
      if (r.activeStage) {
        stageTag = `<span class="stage-tag">${escapeHtml(r.activeStage)}</span>`;
      } else if (r.queuedInStage) {
        const dupNote = r.duplicateQueueCount > 1
          ? ` <span style="color:var(--yellow);font-weight:700" title="Enqueued ${r.duplicateQueueCount} times — duplicate rebuilds. Wasted work but not harmful.">×${r.duplicateQueueCount}</span>`
          : '';
        stageTag = `<span class="stage-tag" style="background:rgba(56,189,248,0.15);color:var(--accent)">#${r.queuePosition} · ${escapeHtml(r.queuedInStage)}${dupNote}</span>`;
      } else if (r.isStalled) {
        // No active worker, not queued, but stage hasn't progressed in 5+ min.
        // Almost certainly BBB workflow lost track — click Rebuild to retry.
        stageTag = `<span class="stalled-tag" title="No progress for 5+ minutes — pipeline likely lost track of this recording. Click Rebuild to retry.">stalled</span>`;
      }

      // Action buttons are state-aware; the server is the source of truth and
      // will reject inappropriate requests regardless of what the UI shows.
      const actions = [];
      if (r.canRebuild) {
        actions.push(`<button class="row-rebuild" onclick="rebuildRecording('${ridJs}', '${nameJs}')">Rebuild pipeline</button>`);
      } else if (r.alreadyQueued) {
        // Show a disabled button with explanation so users don't keep clicking.
        const why = r.activeStage
          ? `BBB is processing this now (stage: ${r.activeStage})`
          : (r.queuedInStage
              ? `Already queued (position #${r.queuePosition} in ${r.queuedInStage})`
              : 'Already pending');
        actions.push(`<button class="row-rebuild" disabled title="${escapeHtml(why)}">In queue</button>`);
      }
      if (r.canUpload) {
        actions.push(`<button class="row-upload" onclick="uploadRecording('${ridJs}', '${nameJs}')">Upload to S3</button>`);
      } else if (r.status === 'Uploading') {
        actions.push(`<button class="row-upload" disabled>Uploading…</button>`);
      } else if (r.status === 'Uploaded') {
        actions.push(`<button class="row-upload" disabled title="Already uploaded">Uploaded ✓</button>`);
      }
      actions.push(`<button class="row-delete" ${r.canDelete ? '' : 'disabled title="Only available once uploaded to S3"'} onclick="deleteRecording('${ridJs}', '${nameJs}')">Delete from BBB</button>`);
      if (r.status === 'Uploaded' && r.fileIds && r.fileIds.length) {
        for (const f of r.fileIds) {
          actions.push(`<button class="size-btn" title="Copy ${escapeHtml(f.type)} S3 file ID: ${escapeHtml(f.fileId)}" onclick="copyText('${escapeHtml(escapeJs(f.fileId))}', this)">⧉ ${escapeHtml(f.type)} id</button>`);
        }
      }

      html += `<tr id="rec-${safeId}" class="${rowClass}">
        <td class="chk-col">${r.canDelete
          ? `<input type="checkbox" class="rec-check" data-rid="${ridAttr}" ${selectedRecordings.has(r.recordId) ? 'checked' : ''} onclick="toggleRec('${ridJs}', this)">`
          : `<input type="checkbox" disabled title="Only uploaded recordings can be deleted">`}</td>
        <td>
          <div>${escapeHtml(r.meetingName)}</div>
          <div class="recid" title="${ridAttr}">${ridAttr}${extId ? '<br><span style="opacity:0.7">ext: ' + extId + '</span>' : ''}</div>
        </td>
        <td>${fmtTime(r.startTimeMs)}</td>
        <td>${fmtDuration(r.durationSeconds)}</td>
        <td>
          <span class="${badgeClass(r.status)}">${r.status}</span>${stageTag}
          ${r.latestStage ? `<div style="font-size:0.7rem;color:var(--muted);margin-top:3px">✓ ${escapeHtml(r.latestStage)} ${fmtAgo(r.latestStageAgoSec)}</div>` : ''}
        </td>
        <td><button class="size-btn" onclick="loadSize('${ridJs}', this)">Show</button></td>
        <td>${actions.join(' ')}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = bannerHtml + html;
    updateBulkBar();

    const pag = document.getElementById('recordingsPagination');
    pag.style.display = 'flex';
    document.getElementById('paginationInfo').textContent =
      `Page ${d.page} of ${d.total_pages}`;
    document.getElementById('prevPage').disabled = d.page <= 1;
    document.getElementById('nextPage').disabled = d.page >= d.total_pages;
    renderPageNumbers(d.page, d.total_pages);
  } catch (e) {
    wrap.innerHTML = '<div style="color:var(--red);padding:20px">Failed to load: ' + e.message + '</div>';
  }
}

async function loadSize(recordId, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(apiUrl('/api/recordings/' + encodeURIComponent(recordId) + '/size'));
    const d = await res.json();
    btn.replaceWith(document.createTextNode(fmtBytes(d.size_bytes)));
  } catch (e) {
    btn.textContent = 'err';
    btn.disabled = false;
  }
}

async function rebuildRecording(recordId, name) {
  if (!confirm(`Rebuild the BBB recording pipeline for "${name}"?\n\nrecordId: ${recordId}\n\nThis re-runs sanity → process → publish stages. Takes 5–15 minutes (longer if classes are live). Safe to retry on a stuck recording.`)) {
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/recordings/' + encodeURIComponent(recordId) + '/rebuild'), {
      method: 'POST'
    });
    const d = await res.json();
    if (d.success) {
      alert('Rebuild triggered. Heal service replied:\n\n' + d.output);
      loadRecordings(currentPage);
    } else {
      alert('Rebuild could not be triggered: ' + (d.output || d.error || 'unknown'));
    }
  } catch (e) {
    alert('Rebuild could not be triggered: ' + e.message);
  }
}

async function uploadRecording(recordId, name) {
  if (!confirm(`Queue "${name}" for upload to S3?\n\nrecordId: ${recordId}\n\nThe drainer runs every minute. You'll see the row flip to "Queued" then "Uploading" then "Uploaded" — click Refresh to update.`)) {
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/recordings/' + encodeURIComponent(recordId) + '/upload'), {
      method: 'POST'
    });
    const d = await res.json();
    if (d.success) {
      // Refresh so the user sees the new "Queued" status immediately.
      loadRecordings(currentPage);
    } else {
      alert('Upload could not be queued: ' + (d.output || d.error || 'unknown'));
    }
  } catch (e) {
    alert('Upload could not be queued: ' + e.message);
  }
}

async function deleteRecording(recordId, name) {
  if (!confirm(`Delete recording "${name}" from BBB?\n\nrecordId: ${recordId}\n\nThis removes the BBB-local copy ONLY. The S3 copy is untouched.`)) {
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/recordings/' + encodeURIComponent(recordId) + '/delete'), {
      method: 'POST'
    });
    const d = await res.json();
    if (d.success) {
      // refresh the page to reflect deletion
      loadRecordings(currentPage);
    } else {
      alert('Delete failed: ' + (d.output || d.error || 'unknown'));
    }
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

// ── Bulk selection + delete ───────────────────────────────
function toggleRec(recordId, cb) {
  if (cb.checked) selectedRecordings.add(recordId);
  else selectedRecordings.delete(recordId);
  const sa = document.getElementById('selectAllRecs');
  if (sa && !cb.checked) sa.checked = false;
  updateBulkBar();
}

function toggleSelectAll(cb) {
  selectedRecordings.clear();
  document.querySelectorAll('.rec-check').forEach(box => {
    box.checked = cb.checked;
    const rid = box.getAttribute('data-rid');
    if (cb.checked && rid) selectedRecordings.add(rid);
  });
  updateBulkBar();
}

function clearSelection() {
  selectedRecordings.clear();
  document.querySelectorAll('.rec-check').forEach(box => { box.checked = false; });
  const sa = document.getElementById('selectAllRecs');
  if (sa) sa.checked = false;
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  if (!bar) return;
  const n = selectedRecordings.size;
  const c = document.getElementById('bulkCount');
  if (c) c.textContent = n + ' selected';
  bar.classList.toggle('visible', n > 0);
}

async function deleteSelected() {
  const ids = Array.from(selectedRecordings);
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} recording(s) from BBB?\n\nThis removes the BBB-local copy ONLY — the S3 copy is untouched. Only recordings already uploaded to S3 are deleted; any others are skipped.`)) {
    return;
  }
  const c = document.getElementById('bulkCount');
  if (c) c.textContent = 'Deleting ' + ids.length + '…';
  try {
    const res = await fetch(apiUrl('/api/recordings/delete-bulk'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds: ids }),
    });
    const d = await res.json();
    let msg = `Deleted ${d.deletedCount || 0} of ${ids.length}.`;
    if (d.failedCount) {
      msg += `\n\nSkipped/failed ${d.failedCount}:\n` +
        (d.failed || []).slice(0, 10).map(f => `• ${String(f.recordId).slice(0, 12)}…: ${f.reason}`).join('\n');
    }
    alert(msg);
  } catch (e) {
    alert('Bulk delete failed: ' + e.message);
  } finally {
    loadRecordings(currentPage);   // clears selection + refreshes the table
  }
}

function copyText(text, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = o; }, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => window.prompt('Copy the file ID:', text));
  } else {
    window.prompt('Copy the file ID:', text);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function escapeJs(s) {
  if (!s) return '';
  // Escape quotes, JS line terminators (U+2028/U+2029), and the less-than
  // sign so an attacker-controlled value cannot smuggle a closing script
  // tag into a template literal. WARNING: do NOT write the literal closing
  // script-tag sequence anywhere in this source (even in comments) \u2014 the
  // HTML parser scans the script body for it before JS ever runs.
  return String(s)
    .replace(/[\\'"]/g, '\\$&')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c');
}

// Initial load + auto-refresh every 30s (Overview tab only)
loadMetrics();
setInterval(() => {
  if (document.getElementById('tab-overview').classList.contains('active')) {
    loadMetrics();
  }
}, 30000);
</script>
</body>
</html>
"""


class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log(f"{self.address_string()} {fmt % args}")

    def _auth_ok(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        token = params.get('token', [None])[0]
        return HEALTH_TOKEN and token and hmac.compare_digest(token, HEALTH_TOKEN)

    def _respond(self, code, body, content_type='application/json'):
        if content_type == 'application/json':
            payload = json.dumps(body).encode()
        else:
            payload = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _path(self):
        return urlparse(self.path).path.rstrip('/')

    def _read_json_body(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            if length <= 0 or length > 1_000_000:
                return {}
            obj = json.loads(self.rfile.read(length).decode('utf-8'))
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def do_GET(self):
        if not self._auth_ok():
            return self._respond(403, {"error": "forbidden — append ?token=<TOKEN> to the URL"})

        path = self._path()

        if path == '' or path == '/':
            html = DASHBOARD_HTML.replace('DOMAIN_PLACEHOLDER', BBB_DOMAIN)
            return self._respond(200, html, 'text/html')

        if path == '/api/metrics':
            data = {
                'domain': BBB_DOMAIN,
                'disk': get_disk_info(),
                'memory': get_memory_info(),
                'cpu': get_cpu_info(),
                'services': get_service_statuses(),
                'recordings': get_recording_stats(),
                'upload_queue': get_upload_queue_stats(),
                'rap_queue': get_rap_worker_queue_stats(),
                'meetings': get_bbb_meetings(),
                'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            }
            return self._respond(200, data)

        if path == '/api/recordings':
            params = parse_qs(urlparse(self.path).query)
            try:
                page = int(params.get('page', ['1'])[0])
            except ValueError:
                page = 1
            try:
                page_size = int(params.get('page_size', ['25'])[0])
            except ValueError:
                page_size = 25
            page_size = max(1, min(page_size, 100))
            return self._respond(200, list_recordings(page=page, page_size=page_size))

        # GET /api/recordings/<recordId>/size  → lazy size lookup
        if path.startswith('/api/recordings/') and path.endswith('/size'):
            recid = path[len('/api/recordings/'):-len('/size')]
            if not recid or not RECORD_ID_RE.match(recid):
                return self._respond(400, {"error": "invalid recordId"})
            return self._respond(200, {
                'recordId': recid,
                'size_bytes': recording_size_bytes(recid),
            })

        return self._respond(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return self._respond(403, {"error": "forbidden"})

        path = self._path()

        if path == '/api/action/delete-old-recordings':
            log("ACTION: delete-old-recordings triggered")
            ok, output = run_delete_old_recordings()
            log(f"ACTION: delete-old-recordings result={'ok' if ok else 'fail'}")
            return self._respond(200, {"success": ok, "output": output})

        if path == '/api/action/restart-bbb':
            log(f"ACTION: restart-bbb triggered (domain={BBB_DOMAIN})")
            ok, output = run_restart_bbb()
            log(f"ACTION: restart-bbb result={'ok' if ok else 'fail'}")
            return self._respond(200, {"success": ok, "output": output})

        # POST /api/recordings/delete-bulk  → delete several at once (body: {recordIds:[...]})
        if path == '/api/recordings/delete-bulk':
            body = self._read_json_body()
            result = delete_recordings_bulk(body.get('recordIds') or [])
            return self._respond(200, result)

        # POST /api/recordings/<recordId>/delete  → bbb-record --delete (BBB only)
        if path.startswith('/api/recordings/') and path.endswith('/delete'):
            recid = path[len('/api/recordings/'):-len('/delete')]
            log(f"ACTION: delete-recording recordId={recid}")
            ok, output = delete_recording_from_bbb(recid)
            log(f"ACTION: delete-recording result={'ok' if ok else 'fail'}")
            code = 200 if ok else 400
            return self._respond(code, {"success": ok, "output": output})

        # POST /api/recordings/<recordId>/upload  → enqueue for the drainer
        if path.startswith('/api/recordings/') and path.endswith('/upload'):
            recid = path[len('/api/recordings/'):-len('/upload')]
            log(f"ACTION: enqueue-upload recordId={recid}")
            ok, output = enqueue_recording_for_upload(recid)
            log(f"ACTION: enqueue-upload result={'ok' if ok else 'fail'} ({output})")
            code = 200 if ok else 400
            return self._respond(code, {"success": ok, "output": output})

        # POST /api/recordings/<recordId>/rebuild  → trigger BBB pipeline rebuild via heal service
        if path.startswith('/api/recordings/') and path.endswith('/rebuild'):
            recid = path[len('/api/recordings/'):-len('/rebuild')]
            log(f"ACTION: rebuild-pipeline recordId={recid}")
            ok, output = rebuild_recording_pipeline(recid)
            log(f"ACTION: rebuild-pipeline result={'ok' if ok else 'fail'}")
            code = 200 if ok else 400
            return self._respond(code, {"success": ok, "output": output})

        return self._respond(404, {"error": "not found"})


def main():
    if not HEALTH_TOKEN:
        log("ERROR: HEALTH_DASHBOARD_TOKEN not set in environment")
        raise SystemExit("HEALTH_DASHBOARD_TOKEN not set")
    log(f"Starting health dashboard on 127.0.0.1:{PORT} (domain={BBB_DOMAIN})")
    # ThreadingHTTPServer so a slow request (du, getMeetings, systemctl)
    # doesn't block all others — important now that the Recordings tab can
    # trigger per-row size walks while the Overview is also polling.
    ThreadingHTTPServer(('127.0.0.1', PORT), DashboardHandler).serve_forever()


if __name__ == '__main__':
    main()
