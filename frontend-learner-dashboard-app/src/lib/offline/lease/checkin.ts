/**
 * Lease check-in loop core (plan §B6). `performCheckIn` is the single call
 * site that talks to `POST /devices/{id}/check-in`
 * (LearnerOfflineDeviceController#checkIn) and applies everything the
 * response can ask for: lease renewal, per-course revocation purges,
 * whole-device revocation, and "update available" manifest diffs.
 *
 * Registration is folded in here too (`ensureDeviceRegistered`) so any
 * caller — the periodic loop or a pre-download gate — can call one function
 * and be sure a device row exists before it tries to check in.
 */

import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { OFFLINE_DEVICES_URL } from "@/constants/urls";
import { getOfflineDb } from "../db/connection";
import { deviceStateDao } from "../db/dao/device-state-dao";
import { manifestsDao } from "../db/dao/manifests-dao";
import { nodesDao } from "../db/dao/nodes-dao";
import { noticesDao } from "../db/dao/notices-dao";
import { loadPersistedManifest } from "@/services/offline/manifest-service";
import { registerDevice, type RegisterResult } from "@/services/offline/device-service";
import { downloadManager } from "../download/download-manager";
import { destroyOfflineKey } from "../crypto/keys";
import { useOfflineStore } from "@/stores/offline/use-offline-store";
import { eventFlusher } from "../events/event-flusher";
import { isLeaseValid } from "./lease-state";
import type { DeviceStateRow } from "../db/types";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface InstalledCourseDTO {
  package_session_id: string;
  manifest_version: number;
}

interface CheckInResponse {
  device_status: "ACTIVE" | "REVOKED";
  lease_expires_at: number | string | null;
  revocations: Array<{
    package_session_id: string;
    reason: "DEVICE_REVOKED" | "UNENROLLED" | "OFFLINE_DISABLED";
    action: "PURGE";
  }>;
  manifest_updates: Array<{ package_session_id: string; current_manifest_version: number }>;
}

function toEpochMs(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Registers this device if it hasn't been (plan §B6 point 4 — "if no device_state row when the user first taps Download"). Idempotent. */
export async function ensureDeviceRegistered(userId: string): Promise<RegisterResult | { status: "already_registered" }> {
  const db = await getOfflineDb();
  const existing = await deviceStateDao.get(db, userId);
  if (existing?.device_registration_id && !existing.revoked) {
    return { status: "already_registered" };
  }

  const result = await registerDevice();
  if (result.status === "registered") {
    await deviceStateDao.upsert(db, {
      user_id: userId,
      device_id: result.device.client_device_id,
      device_registration_id: result.device.id,
      lease_expires_at: toEpochMs(result.device.lease_expires_at),
      last_checkin_at: Date.now(),
      last_checkin_monotonic: Math.floor(performance.now()),
      revoked: 0,
    });
  }
  return result;
}

/** Refreshes the store's leaseState from the current device_state row. */
async function syncLeaseStateToStore(userId: string, row: DeviceStateRow | null): Promise<void> {
  if (!row) {
    useOfflineStore.getState().setLeaseState({ kind: "none" });
    return;
  }
  if (row.revoked) {
    useOfflineStore.getState().setLeaseState({ kind: "revoked" });
  } else if (row.lease_expires_at && row.last_checkin_at !== null) {
    useOfflineStore
      .getState()
      .setLeaseState(
        isLeaseValid(row)
          ? { kind: "valid", expiresAt: row.lease_expires_at }
          : { kind: "expired", expiredAt: row.lease_expires_at }
      );
  } else {
    useOfflineStore.getState().setLeaseState({ kind: "none" });
  }
  void userId; // kept for symmetry with other per-user helpers; store is process-global today
}

/**
 * Runs one check-in cycle: gathers installed courses from the local
 * manifest snapshots, POSTs, and applies the response (lease renewal,
 * revocation purges, device-revoked full purge, update-available flags).
 * No-ops silently if no device is registered yet or the request fails
 * (network hiccups just mean the lease clock keeps ticking toward expiry —
 * handled client-side by lease-state.ts).
 */
export async function performCheckIn(userId: string): Promise<void> {
  const db = await getOfflineDb();
  const deviceState = await deviceStateDao.get(db, userId);
  if (!deviceState?.device_registration_id || deviceState.revoked) return;

  const manifests = await manifestsDao.listForUser(db, userId);
  const installedCourses: InstalledCourseDTO[] = manifests.map((m) => ({
    package_session_id: m.package_session_id,
    manifest_version: m.version,
  }));

  let response: CheckInResponse;
  try {
    const res = await authenticatedAxiosInstance.post<CheckInResponse>(
      `${OFFLINE_DEVICES_URL}/${deviceState.device_registration_id}/check-in`,
      { installed_courses: installedCourses }
    );
    response = res.data;
  } catch (error) {
    console.error("[offline-checkin] check-in request failed", error);
    return;
  }

  if (response.device_status === "REVOKED") {
    await handleDeviceRevoked(userId);
    return;
  }

  await deviceStateDao.upsert(db, {
    user_id: userId,
    device_id: deviceState.device_id,
    device_registration_id: deviceState.device_registration_id,
    lease_expires_at: toEpochMs(response.lease_expires_at) ?? deviceState.lease_expires_at,
    last_checkin_at: Date.now(),
    last_checkin_monotonic: Math.floor(performance.now()),
    revoked: 0,
  });

  for (const revocation of response.revocations ?? []) {
    // Read the course name BEFORE purging — the purge deletes the manifest this
    // comes from, and "this course" is meaningless on the Downloads screen,
    // which lists every course at once.
    const revoked = await loadPersistedManifest(userId, revocation.package_session_id);
    const courseName = revoked?.course_name?.trim() || null;
    await downloadManager.purgePackageSession(userId, revocation.package_session_id);
    await noticesDao.insert(
      db,
      userId,
      revocation.reason,
      revocation.package_session_id,
      revocationMessage(revocation.reason, courseName)
    );
  }

  for (const update of response.manifest_updates ?? []) {
    await manifestsDao.setUpdateAvailable(db, userId, update.package_session_id, true);
    // Mark every node the learner actually holds, at any depth — not just roots.
    // Restricting this to `parent_id === null` meant the flag landed on the
    // subject, while the chapter/module the learner downloaded (and the
    // Downloads screen lists) stayed DOWNLOADED. The result was a "New content
    // is available" notice with no Update button anywhere the learner could
    // reach it. Tapping any of these runs applyManifestUpdate, which diffs the
    // new manifest and re-downloads only what genuinely changed, so the extra
    // breadth here costs nothing beyond the badge.
    const nodes = await nodesDao.listByPackageSession(db, userId, update.package_session_id);
    for (const node of nodes) {
      if (node.status === "DOWNLOADED" || node.status === "PARTIAL") {
        await nodesDao.setStatus(db, userId, node.node_id, "UPDATE_AVAILABLE");
        useOfflineStore.getState().setNodeStatus(node.node_id, "UPDATE_AVAILABLE");
      }
    }
    // Deliberately NO notice card here. Notices only ever render on the
    // Downloads screen, which is the same screen that now shows the named
    // course banner and a per-item "Update available" badge + button — so the
    // card was pure duplication, and its "Open Downloads to update it" copy
    // was telling the learner to go where they already were. The manifest flag
    // and node statuses set above are what drive the UI.
  }

  await syncLeaseStateToStore(userId, await deviceStateDao.get(db, userId));
  await useOfflineStore.getState().hydrate(userId);
  void eventFlusher.flush(userId);
}

/**
 * Full device-revocation handling: purge everything for this user, drop the
 * device-local key, and mark `device_state.revoked`. Shared by two trigger
 * paths — a check-in response with `device_status: "REVOKED"`, and the
 * event-flusher discovering the same thing after a sync batch (wired via
 * `setOnDeviceRevoked`, see useOfflineCheckin.ts) — so both converge on one
 * purge implementation.
 */
export async function handleDeviceRevoked(
  userId: string,
  options?: { selfInitiated?: boolean }
): Promise<void> {
  const db = await getOfflineDb();
  await downloadManager.purgeAllForUser(userId);
  await destroyOfflineKey(userId);
  await deviceStateDao.setRevoked(db, userId, true);
  // A learner who just tapped "Remove" on their own device shouldn't be told
  // their institute did it, nor be shown the alarming revoked modal.
  await noticesDao.insert(
    db,
    userId,
    "DEVICE_REVOKED",
    null,
    options?.selfInitiated
      ? "You removed this device from offline access. Downloaded content was deleted."
      : "This device's offline access was revoked by your institute."
  );
  if (!options?.selfInitiated) {
    useOfflineStore.getState().setRevokedDialogOpen(true);
  }
  await syncLeaseStateToStore(userId, await deviceStateDao.get(db, userId));
  await useOfflineStore.getState().hydrate(userId);
  void eventFlusher.flush(userId);
}

/**
 * Names the course when we know it. "this course" reads as nonsense on the
 * Downloads screen, which is a global list — the learner has no way to tell
 * which course the notice is about. OFFLINE_DISABLED is also an institute-wide
 * switch, so its copy must not imply a single course was singled out.
 */
function revocationMessage(
  reason: "DEVICE_REVOKED" | "UNENROLLED" | "OFFLINE_DISABLED",
  courseName: string | null
): string {
  const course = courseName ? `"${courseName}"` : null;
  switch (reason) {
    case "UNENROLLED":
      return course
        ? `You're no longer enrolled in ${course} — its offline content was removed.`
        : `You're no longer enrolled — that ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}'s offline content was removed.`;
    case "OFFLINE_DISABLED":
      return course
        ? `Your institute turned off offline downloads, so ${course} was removed from this device.`
        : "Your institute turned off offline downloads, so saved content was removed from this device.";
    case "DEVICE_REVOKED":
    default:
      return course
        ? `Offline access was removed by your institute, so ${course} was removed from this device.`
        : "Offline access was removed by your institute, so saved content was removed from this device.";
  }
}
