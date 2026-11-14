/**
 * Web-bundle OTA for Electron shells that cannot self-update.
 *
 * The desktop app normally updates through `electron-updater` (see index.ts): it
 * downloads a whole new .app/.exe and swaps it in on quit. That is impossible in
 * a STORE build — a Mac App Store package is sandboxed and lives read-only under
 * /Applications, and Apple only lets a store app change through the store. So a
 * MAS build shipped with electron-updater alone can never be patched between
 * review cycles.
 *
 * This module fills that gap with the same trick the iOS/Android apps use
 * (@capgo/capacitor-updater): the native shell is frozen, but the WEB BUNDLE it
 * serves is just HTML/JS/CSS, so we can fetch a newer bundle into the app's own
 * writable container and serve the app from there instead. No native code is
 * downloaded or executed — only web assets rendered in the existing WebView.
 *
 * It talks to the exact same endpoint and bundle stream as mobile
 * (`/admin-core-service/public/ota/v1/check`, publish via scripts/publish-ota.sh),
 * so one published bundle reaches iOS, Android and desktop alike. The backend
 * already matches `platform = 'ALL' OR platform = :platform`, so PLATFORM=MACOS
 * needs no server change and leaves room for Mac-only bundles later.
 *
 * Update timing deliberately mirrors mobile's "auto" mode: a new bundle is
 * downloaded in the background and applied on the NEXT launch. It is never
 * swapped in mid-session, which would reload the WebView and destroy a learner's
 * in-progress exam attempt.
 */

import { app } from 'electron';
import { createHash } from 'crypto';
import { inflateRawSync } from 'zlib';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  renameSync,
} from 'fs';
import { join, dirname, resolve, sep } from 'path';

/** Where the OTA check lives. Overridable for staging/self-hosted backends. */
const BACKEND_BASE_URL = process.env.VACADEMY_BACKEND_URL || 'https://backend-stage.vacademy.io';
const OTA_CHECK_PATH = '/admin-core-service/public/ota/v1/check';

/** Platform string sent to the backend. Matches ALL-platform bundles too. */
const OTA_PLATFORM = 'MACOS';

/** Refuse absurd payloads outright rather than filling the user's disk. */
const MAX_BUNDLE_BYTES = 250 * 1024 * 1024;

/** How many superseded bundles to keep on disk (for a manual rollback). */
const KEEP_OLD_BUNDLES = 1;

interface OtaState {
  /** Version string of the bundle under bundles/<version> we should serve. */
  activeVersion: string | null;
}

interface OtaCheckResponse {
  update_available: boolean;
  version?: string;
  bundle_download_url?: string;
  checksum?: string;
  bundle_size_bytes?: number;
  force_update?: boolean;
  release_notes?: string;
}

/** Flavor file also carries the store bundle id we report to the OTA backend. */
interface FlavorFile {
  flavor?: string;
  /** App id used for OTA `target_app_ids` matching, e.g. "io.zoeedtech.app". */
  otaAppId?: string;
}

const log = (msg: string, ...rest: unknown[]) => console.log(`[ota] ${msg}`, ...rest);

function otaRoot(): string {
  return join(app.getPath('userData'), 'ota');
}

function bundlesRoot(): string {
  return join(otaRoot(), 'bundles');
}

function statePath(): string {
  return join(otaRoot(), 'state.json');
}

function readState(): OtaState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8')) as OtaState;
    if (parsed && typeof parsed.activeVersion === 'string') return parsed;
  } catch {
    // No state yet, or it is unreadable — fall back to the packaged bundle.
  }
  return { activeVersion: null };
}

function writeState(state: OtaState): void {
  mkdirSync(otaRoot(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8');
}

/** Read the flavor file that the build script writes next to package.json. */
function readFlavorFile(): FlavorFile {
  try {
    // __dirname is build/src/ after tsc; electron-flavor.json sits at the root.
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'electron-flavor.json'), 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * The app id this shell reports for OTA targeting. Falls back to the Electron
 * appId so a flavor that forgets `otaAppId` still identifies itself rather than
 * silently matching every untargeted bundle under a blank id.
 */
function otaAppId(): string {
  return readFlavorFile().otaAppId || app.getName();
}

/**
 * True when the web bundle is this shell's only patch channel.
 *
 * Currently just the Mac App Store: sandboxed, installed read-only, and
 * updatable only through the store, so electron-updater can never run there.
 *
 * The Microsoft Store (MSIX/AppX) build has the same problem and could be
 * switched on here with `|| process.windowsStore === true` — but it ships today
 * with no self-update at all, and turning one on is a change to a live product
 * that should be made deliberately, not inherited from this one.
 */
export function isWebBundleOtaShell(): boolean {
  return process.mas === true;
}

/**
 * Directory the app should be served from RIGHT NOW.
 *
 * Returns the staged OTA bundle when one is present and intact, otherwise the
 * bundle packaged inside the .app. Every failure path lands on the packaged
 * bundle, so a half-written or hand-deleted OTA directory degrades to "the app
 * that shipped" instead of a blank window.
 */
export function getActiveWebDirectory(packagedDirectory: string): string {
  if (!isWebBundleOtaShell()) return packagedDirectory;

  const { activeVersion } = readState();
  if (!activeVersion) return packagedDirectory;

  const candidate = join(bundlesRoot(), activeVersion);
  if (!existsSync(join(candidate, 'index.html'))) {
    log(`staged bundle ${activeVersion} is missing index.html — serving the packaged bundle`);
    writeState({ activeVersion: null });
    return packagedDirectory;
  }

  // A store update ships a newer packaged bundle, but the staged one survives in
  // userData. Without this check the OLDER staged bundle kept winning, and since
  // the OTA check then reported that stale version as current, no newer bundle
  // was ever offered — the app was stuck on it for good. Seen live on Shiksha
  // Nation Mac 1.0: a pre-define bundle (2.4.5) rebranded it as SSDC Horizon.
  const packaged = packagedWebVersion();
  if (compareVersions(activeVersion, packaged) <= 0) {
    log(`staged bundle ${activeVersion} is not newer than packaged ${packaged} — serving the packaged bundle`);
    writeState({ activeVersion: null });
    return packagedDirectory;
  }

  log(`serving OTA bundle ${activeVersion}`);
  return candidate;
}

/**
 * Same rule as the backend's `OtaUpdateService.compareVersions`: dot-separated
 * numeric parts, missing parts count as 0, non-numeric parts count as 0.
 * Positive when a > b.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = i < pa.length ? parseInt(pa[i], 10) || 0 : 0;
    const nb = i < pb.length ? parseInt(pb[i], 10) || 0 : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Version the running WebView is on: the staged bundle, else the packaged one. */
export function getCurrentBundleVersion(): string {
  const { activeVersion } = readState();
  if (activeVersion) return activeVersion;
  // The packaged web bundle is built from the frontend package.json, whose
  // version is also what publish-ota.sh names bundles with — so the shipped
  // bundle and the OTA stream share one numbering space.
  return packagedWebVersion();
}

/**
 * Version of the web bundle baked into the .app. Written by the build script as
 * `app/ota-bundle-version.txt`; falls back to the Electron package version,
 * which is a DIFFERENT numbering space and would make every OTA bundle look
 * older — hence the loud warning.
 */
function packagedWebVersion(): string {
  try {
    return readFileSync(join(app.getAppPath(), 'app', 'ota-bundle-version.txt'), 'utf-8').trim();
  } catch {
    log('WARNING: app/ota-bundle-version.txt missing — OTA comparisons will be wrong');
    return app.getVersion();
  }
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------
// Deliberately dependency-free. The packaged app must extract a zip inside the
// App Sandbox, where shelling out to /usr/bin/unzip is both fragile and an
// unnecessary child process. `zip -r` (what publish-ota.sh produces) only ever
// emits STORE and DEFLATE entries, which is all this handles.

interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD is at the very end, after a comment of at most 64KB.
  const maxScan = Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= buf.length - maxScan; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a zip file: no end-of-central-directory record');
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('zip64 bundles are not supported');
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`corrupt central directory at entry ${i}`);
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const fileName = buf.subarray(p + 46, p + 46 + nameLen).toString('utf-8');

    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buf: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localHeaderOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) {
    throw new Error(`corrupt local header for ${entry.fileName}`);
  }
  // The local header repeats the name/extra lengths, and they can differ from
  // the central directory's — always trust the local ones for the data offset.
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return Buffer.from(raw);
  if (entry.compressionMethod === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.compressionMethod} for ${entry.fileName}`);
}

/**
 * Extract into `destDir`, rejecting any path that escapes it (zip slip). The
 * bundle is downloaded over the network, so its file names are untrusted input.
 */
function extractZip(buf: Buffer, destDir: string): void {
  const root = resolve(destDir);
  for (const entry of readCentralDirectory(buf)) {
    if (entry.fileName.endsWith('/')) continue; // directory marker

    const target = resolve(root, entry.fileName);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`refusing entry outside the bundle directory: ${entry.fileName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readEntryData(buf, entry));
  }
}

// ---------------------------------------------------------------------------
// Download + install
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<OtaCheckResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OTA check failed: ${res.status}`);
  return (await res.json()) as OtaCheckResponse;
}

async function downloadBundle(url: string, expectedBytes?: number): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bundle download failed: ${res.status}`);

  const declared = Number(res.headers.get('content-length') || expectedBytes || 0);
  if (declared > MAX_BUNDLE_BYTES) {
    throw new Error(`bundle is ${declared} bytes, over the ${MAX_BUNDLE_BYTES} limit`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BUNDLE_BYTES) {
    throw new Error(`bundle is ${buf.length} bytes, over the ${MAX_BUNDLE_BYTES} limit`);
  }
  return buf;
}

/** Drop every bundle except the active one and the most recent superseded ones. */
function pruneOldBundles(activeVersion: string): void {
  try {
    const dirs = readdirSync(bundlesRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== activeVersion)
      .map((d) => join(bundlesRoot(), d.name));

    // readdir order is not meaningful, so keep it simple and deterministic:
    // sort by name and drop everything past the retention window.
    dirs.sort();
    for (const dir of dirs.slice(0, Math.max(0, dirs.length - KEEP_OLD_BUNDLES))) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Housekeeping only — never let it break an otherwise successful update.
  }
}

/**
 * Check for a newer web bundle and stage it for the next launch.
 *
 * Never throws: OTA is best-effort, and a backend hiccup or an offline start
 * must not affect an app the user is already using.
 */
export async function checkAndStageOtaBundle(): Promise<void> {
  if (!isWebBundleOtaShell()) return;

  try {
    const currentBundleVersion = getCurrentBundleVersion();
    const params = new URLSearchParams({
      platform: OTA_PLATFORM,
      currentBundleVersion,
      nativeVersion: app.getVersion(),
      appId: otaAppId(),
    });

    log(`checking for updates (current=${currentBundleVersion}, appId=${otaAppId()})`);
    const result = await fetchJson(`${BACKEND_BASE_URL}${OTA_CHECK_PATH}?${params}`);

    if (!result.update_available || !result.version || !result.bundle_download_url) {
      log('no update available');
      return;
    }
    if (result.version === readState().activeVersion) {
      log(`bundle ${result.version} is already staged`);
      return;
    }

    log(`downloading bundle ${result.version} (${result.bundle_size_bytes ?? '?'} bytes)`);
    const zip = await downloadBundle(result.bundle_download_url, result.bundle_size_bytes);

    // Verify BEFORE unpacking: the bundle becomes the app's own code, so an
    // unverified one is arbitrary JS from whatever answered the request.
    if (result.checksum) {
      const actual = createHash('sha256').update(zip).digest('hex');
      if (actual !== result.checksum.toLowerCase()) {
        throw new Error(`checksum mismatch (expected ${result.checksum}, got ${actual})`);
      }
    } else {
      throw new Error('bundle has no checksum — refusing to install it');
    }

    // Extract to a scratch dir first so a crash mid-write can never leave a
    // half-written bundle sitting at the path state.json points to.
    const finalDir = join(bundlesRoot(), result.version);
    const stagingDir = `${finalDir}.incoming`;
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    try {
      extractZip(zip, stagingDir);
      if (!existsSync(join(stagingDir, 'index.html'))) {
        throw new Error('bundle has no index.html at its root');
      }
      rmSync(finalDir, { recursive: true, force: true });
      // Same parent directory, so this is an atomic rename on every OS we ship.
      renameSync(stagingDir, finalDir);
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

    writeState({ activeVersion: result.version });
    pruneOldBundles(result.version);
    log(`bundle ${result.version} staged — it will be applied on the next launch`);
  } catch (err) {
    log('update check failed:', (err as Error)?.message ?? err);
  }
}
