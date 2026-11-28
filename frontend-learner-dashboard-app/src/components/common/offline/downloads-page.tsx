/**
 * "Downloads" screen (plan §B7), split into two tabs so the thing a learner
 * opens this screen for — their saved content — isn't buried under storage,
 * lease and device plumbing:
 *
 *   Content  — downloaded courses/chapters, per-item update + open, Clear all.
 *   Settings — storage (used AND free on device), offline validity, download
 *              settings, registered offline devices.
 *
 * Notices render above the tabs: a revocation or expired lease has to be seen
 * from either tab.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise, Bell, CaretRight, CloudCheck, CloudSlash, DeviceMobile, HardDrives, Trash, WifiHigh, WifiSlash, X } from "@phosphor-icons/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { metaDao, routeContextKey, type OfflineRouteContext } from "@/lib/offline/db/dao/meta-dao";
import type { OfflineManifestChapter } from "@/services/offline/manifest-service";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOfflineStore } from "@/stores/offline/use-offline-store";
import { useOfflineUserId } from "@/hooks/offline/use-offline-status";
import { refreshOfflineAvailability, useOfflineAvailable } from "@/hooks/offline/use-offline-availability";
import { downloadManager } from "@/lib/offline/download/download-manager";
import { getOfflineDb } from "@/lib/offline/db/connection";
import { manifestsDao } from "@/lib/offline/db/dao/manifests-dao";
import { noticesDao } from "@/lib/offline/db/dao/notices-dao";
import { deviceStateDao } from "@/lib/offline/db/dao/device-state-dao";
import type { NoticeRow } from "@/lib/offline/db/types";
import { loadPersistedManifest, type OfflineManifest } from "@/services/offline/manifest-service";
import { slidesInSubtree } from "@/lib/offline/download/expander";
import { MyButton } from "@/components/design-system/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFreeDiskSpace } from "@/lib/offline/native/offline-media";
import { handleDeviceRevoked, performCheckIn } from "@/lib/offline/lease/checkin";
import { listDevices, selfRevokeDevice, type OfflineDeviceDTO } from "@/services/offline/device-service";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

/**
 * A manifest describes the whole course, not what this device actually holds,
 * so the Downloads screen must filter it by live node status. Listing every
 * chapter made never-downloaded chapters look saved and offered an "Open" that
 * could only fail.
 */
const ON_DEVICE_STATUSES = new Set([
  "DOWNLOADED",
  "PARTIAL",
  "DOWNLOADING",
  "QUEUED",
  // Still on the device — just superseded by a newer teacher edit. Omitting this
  // made a whole course disappear from Downloads the moment an update was
  // detected, which is exactly when the learner needs the Update button.
  "UPDATE_AVAILABLE",
]);

const isOnDevice = (
  statuses: Record<string, string>,
  nodeId: string | undefined | null
): boolean => (nodeId ? ON_DEVICE_STATUSES.has(statuses[nodeId] ?? "") : false);

/** Below this, a download is likely to fail preflight (size x1.05 + 200MB headroom). */
const LOW_SPACE_BYTES = 300 * 1024 * 1024;

type TabValue = "content" | "settings";

/**
 * Courses that don't use subjects/modules still get scaffold rows, and the
 * platform names them literally "default" / "DEFAULT". Showing that as the
 * heading above a learner's downloads is meaningless — they see "default"
 * where the course name belongs.
 */
const PLACEHOLDER_NAMES = new Set(["default", "untitled", "n/a", "-"]);

const isPlaceholderName = (name: string | null | undefined): boolean =>
  !name || !name.trim() || PLACEHOLDER_NAMES.has(name.trim().toLowerCase());

/**
 * Best human label for a downloaded group: the subject when it's real,
 * otherwise walk up to the course name. Chapters keep their own (real) names.
 */
const groupLabel = (
  subjectName: string | undefined,
  manifest: OfflineManifest,
  fallbackLabel: string
): string => {
  if (!isPlaceholderName(subjectName)) return subjectName as string;
  if (!isPlaceholderName(manifest.course_name)) return manifest.course_name as string;
  return fallbackLabel;
};

/**
 * A queued destructive action awaiting confirmation. Deleting downloaded content
 * is irreversible (the ciphertext is erased and has to be re-downloaded), so it
 * must never happen on a single stray tap.
 */
type PendingDelete =
  | { kind: "subject"; manifest: OfflineManifest; subjectId: string; label: string }
  | { kind: "all" }
  | { kind: "device"; deviceId: string; label: string; isThisDevice: boolean };

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export const DownloadsPage = () => {
  const { t } = useTranslation("layoutCommonB");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const userId = useOfflineUserId();
  const { storageUsedBytes, wifiOnly, leaseState, setWifiOnly, hydrate, nodeStatuses } =
    useOfflineStore();
  const [manifests, setManifests] = useState<OfflineManifest[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [devices, setDevices] = useState<OfflineDeviceDTO[]>([]);
  const [thisDeviceRegistrationId, setThisDeviceRegistrationId] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  /** package_session_ids whose teacher-side content changed since download. */
  const [updatable, setUpdatable] = useState<string[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /** Free space on the volume backing the app's files dir; null when unavailable. */
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  /**
   * Controlled so `/downloads?tab=settings` can land directly on Settings —
   * that's where the Wi-Fi-only download toast sends the learner.
   */
  const router = useRouter();
  const [tab, setTab] = useState<TabValue>(() =>
    (router.state.location.search as { tab?: string })?.tab === "settings"
      ? "settings"
      : "content"
  );
  /** Confirmation state for destructive actions (null = nothing pending). */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  /**
   * The nav entry is hidden when offline isn't available, but the route is still
   * reachable by URL — including from a plain browser, where none of this can
   * work. Gate the screen itself too.
   */
  const offlineAvailable = useOfflineAvailable();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const space = await getFreeDiskSpace();
      if (!cancelled) setFreeBytes(space?.freeBytes ?? null);
    })();
    return () => {
      cancelled = true;
    };
    // Re-read after downloads/deletions change what's on disk.
  }, [storageUsedBytes]);

  const loadManifests = async (uid: string) => {
    const db = await getOfflineDb();
    const rows = await manifestsDao.listForUser(db, uid);
    const parsed = await Promise.all(
      rows.map((row) => loadPersistedManifest(uid, row.package_session_id))
    );
    setManifests(parsed.filter((m): m is OfflineManifest => m !== null));
    setUpdatable(rows.filter((r) => r.update_available).map((r) => r.package_session_id));
    // UPDATE_AVAILABLE is represented inline (course banner + per-item badge and
    // button) on this very screen, so its notice card is redundant. We no longer
    // create them; this filter also hides ones already stored on the device.
    const unseen = await noticesDao.listUnseen(db, uid);
    setNotices(unseen.filter((n) => n.kind !== "UPDATE_AVAILABLE"));
    const deviceState = await deviceStateDao.get(db, uid);
    setThisDeviceRegistrationId(deviceState?.device_registration_id ?? null);
  };

  useEffect(() => {
    if (!userId) return;
    // Check in on open. Revocations (institute disabled offline, un-enrolled,
    // device removed by an admin) otherwise only landed on app start or the 6h
    // tick, so an admin revoking access saw no effect on the learner's device
    // until they killed and reopened the app. This is the screen where that
    // state actually matters, so re-verify every time it's opened.
    void (async () => {
      try {
        // Institute-level switch first: it decides whether this screen should
        // exist at all, and it's cached for the session otherwise.
        await refreshOfflineAvailability();
        await performCheckIn(userId);
      } catch {
        // offline / server down — the cached view below is still correct
      }
      await hydrate(userId);
      await loadManifests(userId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hydrate]);

  /**
   * Pulls the teacher's changes for one course. applyManifestUpdate re-fetches
   * the manifest, diffs it against the downloaded snapshot, and only re-downloads
   * slides whose content actually changed.
   */
  const handleApplyUpdate = async (packageSessionId: string) => {
    if (!userId) return;
    setUpdatingId(packageSessionId);
    try {
      await downloadManager.applyManifestUpdate(userId, packageSessionId);
      await hydrate(userId);
      await loadManifests(userId);
      toast.success(t("offline.downloadsPage.toasts.updateStarted"));
    } catch (error) {
      console.error("[downloads] failed to apply update", error);
      toast.error(t("offline.downloadsPage.toasts.updateFetchFailed"));
    } finally {
      setUpdatingId(null);
    }
  };

  const refreshDevices = async () => {
    setDevicesLoading(true);
    try {
      setDevices(await listDevices());
    } catch (error) {
      console.error("[offline] failed to load devices", error);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    if (userId) void refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleRevokeDevice = async (deviceId: string, isThisDevice: boolean) => {
    setRevokingId(deviceId);
    try {
      await selfRevokeDevice(deviceId);
      // Revoking THIS device has to take effect here and now. Previously only
      // the server was told, and the local purge waited for a check-in to
      // report REVOKED — up to 6h later — so the learner saw "removed from
      // offline access" while every downloaded file was still on disk and
      // playable. Another device purges itself on its own next check-in.
      if (isThisDevice && userId) {
        await handleDeviceRevoked(userId, { selfInitiated: true });
        await loadManifests(userId);
      }
      await refreshDevices();
      toast.success(
        isThisDevice
          ? t("offline.downloadsPage.toasts.thisDeviceRemoved")
          : t("offline.downloadsPage.toasts.deviceRemoved")
      );
    } catch (error) {
      console.error("[offline] failed to revoke device", error);
      toast.error(t("offline.downloadsPage.toasts.deviceRemoveFailed"));
    } finally {
      setRevokingId(null);
    }
  };

  const handleDismissNotice = async (id: string) => {
    if (!userId) return;
    const db = await getOfflineDb();
    await noticesDao.markSeen(db, userId, id);
    setNotices((prev) => prev.filter((n) => n.id !== id));
  };

  if (!userId) return null;

  // Unknown yet — render nothing rather than flashing the screen in and out.
  if (offlineAvailable === null) return null;
  if (!offlineAvailable) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 p-8 text-center">
        <CloudSlash size={28} className="text-neutral-300" />
        <p className="text-body font-medium text-neutral-600">
          {t("offline.downloadsPage.unavailable.title")}
        </p>
        <p className="text-caption text-neutral-400">
          {t("offline.downloadsPage.unavailable.description")}
        </p>
      </div>
    );
  }

  /**
   * Deep-link a downloaded chapter into the normal slides view (which is
   * offline-aware). Route context (courseId/levelId) was captured at
   * download time — without it we can only point the user back to the course.
   */
  const handleOpenChapter = async (
    manifest: OfflineManifest,
    subjectId: string,
    moduleId: string,
    chapter: OfflineManifestChapter
  ) => {
    try {
      const db = await getOfflineDb();
      const raw = await metaDao.get(db, routeContextKey(manifest.package_session_id));
      const ctx: OfflineRouteContext = raw ? JSON.parse(raw) : {};
      const firstSlide = chapter.slides.find((s) => s.downloadable) ?? chapter.slides[0];
      navigate({
        to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
        search: {
          courseId: ctx.courseId ?? "",
          levelId: ctx.levelId ?? "",
          sessionId: ctx.sessionId ?? manifest.package_session_id,
          subjectId,
          moduleId,
          chapterId: chapter.chapter_id,
          slideId: firstSlide?.slide_id ?? "",
        },
      });
    } catch (error) {
      console.error("[downloads] failed to open chapter", error);
      toast.error(t("offline.downloadsPage.toasts.openChapterFailed", { course: course.toLocaleLowerCase() }));
    }
  };

  const handleDeleteSubject = async (manifest: OfflineManifest, subjectId: string) => {
    setBusy(true);
    try {
      const slideIds = slidesInSubtree(manifest, subjectId, "SUBJECT")
        .filter((ctx) => ctx.slide.downloadable)
        .map((ctx) => ctx.slide.slide_id);
      await downloadManager.deleteNode(userId, manifest.package_session_id, slideIds);
      await hydrate(userId);
      await loadManifests(userId);
      toast.success(t("offline.downloadsPage.toasts.removedFromDownloads"));
    } catch (error) {
      console.error("[downloads] failed to delete subject", error);
      toast.error(t("offline.downloadsPage.toasts.removeDownloadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      for (const manifest of manifests) {
        const slideIds = slidesInSubtree(manifest)
          .filter((ctx) => ctx.slide.downloadable)
          .map((ctx) => ctx.slide.slide_id);
        await downloadManager.deleteNode(userId, manifest.package_session_id, slideIds);
      }
      await hydrate(userId);
      await loadManifests(userId);
      toast.success(t("offline.downloadsPage.toasts.allCleared"));
    } catch (error) {
      console.error("[downloads] failed to clear downloads", error);
      toast.error(t("offline.downloadsPage.toasts.clearFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** Runs whichever destructive action the learner just confirmed. */
  const runPendingDelete = async () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    if (pending.kind === "all") {
      await handleClearAll();
    } else if (pending.kind === "device") {
      await handleRevokeDevice(pending.deviceId, pending.isThisDevice);
    } else {
      await handleDeleteSubject(pending.manifest, pending.subjectId);
    }
  };

  // Only what this device actually holds. Subjects and courses with nothing
  // on-device drop out entirely so the empty state stays accurate.
  const visibleManifests = manifests
    .map((manifest) => ({
      manifest,
      subjects: manifest.subjects
        .map((subject) => ({
          subject,
          entries: subject.modules.flatMap((module) =>
            module.chapters
              .filter((chapter) => isOnDevice(nodeStatuses, chapter.chapter_id))
              .map((chapter) => ({ module, chapter }))
          ),
        }))
        .filter((group) => group.entries.length > 0),
    }))
    .filter((group) => group.subjects.length > 0);

  const downloadedCount = visibleManifests.reduce(
    (total, group) =>
      total + group.subjects.reduce((n, s) => n + s.entries.length, 0),
    0
  );

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-neutral-800">{t("offline.downloadsPage.heading")}</h2>
        <p className="text-body text-neutral-500">{t("offline.downloadsPage.subheading")}</p>
      </div>

      {/* Notices stay above the tabs: a revocation or expired lease must be seen
          regardless of which tab the learner happens to be on. */}
      {notices.length > 0 && (
        <div className="flex flex-col gap-2">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3"
            >
              <div className="flex items-start gap-2">
                <Bell size={16} className="mt-0.5 shrink-0 text-warning-600" />
                <span className="text-caption text-neutral-700">{notice.message}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleDismissNotice(notice.id)}
                className="shrink-0 text-neutral-400 hover:text-neutral-600"
                title={t("offline.downloadsPage.dismiss")}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="content">
            {downloadedCount > 0
              ? t("offline.downloadsPage.tabs.contentWithCount", { count: downloadedCount })
              : t("offline.downloadsPage.tabs.content")}
          </TabsTrigger>
          <TabsTrigger value="settings">{t("offline.downloadsPage.tabs.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="flex flex-col gap-4">
          {/* Storage: what downloads take, and what the device has left — the
              second half is what tells a learner whether another download will
              even fit. */}
          <div className="flex flex-col gap-stack rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center gap-2">
              <HardDrives size={18} className="text-neutral-500" />
              <span className="text-body font-medium text-neutral-700">{t("offline.downloadsPage.storage.title")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption text-neutral-500">{t("offline.downloadsPage.storage.usedByDownloads")}</span>
              <span className="text-body font-medium text-neutral-700">
                {formatBytes(storageUsedBytes)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption text-neutral-500">{t("offline.downloadsPage.storage.availableOnDevice")}</span>
              <span className="text-body font-medium text-neutral-700">
                {freeBytes === null ? "—" : formatBytes(freeBytes)}
              </span>
            </div>
            {freeBytes !== null && freeBytes < LOW_SPACE_BYTES && (
              <p className="text-caption text-warning-600">
                {t("offline.downloadsPage.storage.lowSpace")}
              </p>
            )}
          </div>

          {/* Offline validity */}
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center gap-2">
              <CloudCheck size={18} className="text-neutral-500" />
              <span className="text-body font-medium text-neutral-700">{t("offline.downloadsPage.offlineAccess.title")}</span>
            </div>
            <LeaseStatusLine leaseState={leaseState} />
          </div>

          {/* Download settings */}
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
            <span className="text-body font-medium text-neutral-700">{t("offline.downloadsPage.downloadSettings.title")}</span>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {wifiOnly ? (
                  <WifiHigh size={18} className="text-neutral-500" />
                ) : (
                  <WifiSlash size={18} className="text-neutral-500" />
                )}
                <div className="flex flex-col">
                  <span className="text-body text-neutral-700">{t("offline.downloadsPage.downloadSettings.wifiOnly")}</span>
                  <span className="text-caption text-neutral-400">
                    {wifiOnly ? t("offline.downloadsPage.downloadSettings.waitsForWifi") : t("offline.downloadsPage.downloadSettings.mobileDataAllowed")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={wifiOnly}
                onClick={() => setWifiOnly(!wifiOnly)}
                className={cn(
                  "h-6 w-11 shrink-0 rounded-full transition-colors",
                  wifiOnly ? "bg-primary-500" : "bg-neutral-300"
                )}
              >
                <span
                  className={cn(
                    "block size-5 rounded-full bg-white shadow transition-transform",
                    wifiOnly ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center gap-2">
          <DeviceMobile size={18} />
          <span className="text-body font-medium text-neutral-700">{t("offline.downloadsPage.devices.title")}</span>
        </div>
        {devicesLoading && devices.length === 0 && (
          <p className="text-caption text-neutral-400">{t("offline.downloadsPage.devices.loading")}</p>
        )}
        {!devicesLoading && devices.length === 0 && (
          <p className="text-caption text-neutral-400">{t("offline.downloadsPage.devices.none")}</p>
        )}
        {devices.map((device) => {
          const isThisDevice = device.id === thisDeviceRegistrationId;
          return (
            <div key={device.id} className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-body text-neutral-700">
                  {device.device_name ?? t("offline.downloadsPage.devices.unnamedDevice")}
                  {isThisDevice && <span className="ms-1 text-caption text-primary-500">{t("offline.downloadsPage.devices.thisDeviceSuffix")}</span>}
                </span>
                <span className="text-caption text-neutral-400">{device.platform ?? t("offline.downloadsPage.devices.unknownPlatform")}</span>
              </div>
              <button
                type="button"
                disabled={revokingId === device.id}
                onClick={() =>
                  setPendingDelete({
                    kind: "device",
                    deviceId: device.id,
                    label: device.device_name ?? t("offline.downloadsPage.devices.thisDeviceFallbackLabel"),
                    isThisDevice,
                  })
                }
                className="inline-flex items-center gap-1 text-caption text-danger-600 hover:underline disabled:opacity-50"
              >
                <Trash size={14} /> {t("offline.downloadsPage.devices.remove")}
              </button>
            </div>
          );
        })}
          </div>
        </TabsContent>

        <TabsContent value="content" className="flex flex-col gap-stack">
        {visibleManifests.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-4 py-10 text-center">
            <CloudSlash size={28} className="text-neutral-300" />
            <p className="text-body font-medium text-neutral-600">{t("offline.downloadsPage.content.emptyTitle")}</p>
            <p className="text-caption text-neutral-400">
              {t("offline.downloadsPage.content.emptyDescription", { course: course.toLocaleLowerCase() })}
            </p>
          </div>
        )}
        {visibleManifests.map(({ manifest, subjects }) => (
          <div key={manifest.package_session_id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
            {updatable.includes(manifest.package_session_id) && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ArrowClockwise size={16} className="shrink-0 text-primary-600" />
                  <span className="text-caption text-neutral-700">
                    {t("offline.downloadsPage.content.newContentInPrefix")}{" "}
                    <span className="font-medium">
                      {groupLabel(subjects[0]?.subject.subject_name, manifest, t("offline.downloadsPage.downloadedContent"))}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={updatingId === manifest.package_session_id}
                  onClick={() => void handleApplyUpdate(manifest.package_session_id)}
                  className="shrink-0 rounded-md bg-primary-500 px-3 py-1 text-caption font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  {updatingId === manifest.package_session_id ? t("offline.downloadsPage.content.updating") : t("offline.downloadsPage.content.update")}
                </button>
              </div>
            )}
            {subjects.map(({ subject, entries }) => (
              <div key={subject.subject_id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-body font-medium text-neutral-700">
                    {groupLabel(subject.subject_name, manifest, t("offline.downloadsPage.downloadedContent"))}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setPendingDelete({
                        kind: "subject",
                        manifest,
                        subjectId: subject.subject_id,
                        label: groupLabel(subject.subject_name, manifest, t("offline.downloadsPage.downloadedContent")),
                      })
                    }
                    className="inline-flex items-center gap-1 text-caption text-danger-600 hover:underline disabled:opacity-50"
                  >
                    <Trash size={14} /> {t("offline.downloadsPage.content.delete")}
                  </button>
                </div>
                {entries.map(({ module, chapter }) => {
                  // Per-item update: the badge belongs on the thing the learner
                  // downloaded, next to it, not only on a course-wide banner.
                  const chapterHasUpdate =
                    nodeStatuses[chapter.chapter_id] === "UPDATE_AVAILABLE";
                  return (
                    <div
                      key={chapter.chapter_id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md border px-3 py-2",
                        chapterHasUpdate
                          ? "border-primary-200 bg-primary-50"
                          : "border-neutral-100 bg-neutral-50"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void handleOpenChapter(manifest, subject.subject_id, module.module_id, chapter)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-start"
                      >
                        <span className="truncate text-caption text-neutral-600">
                          {chapter.chapter_name}
                        </span>
                        {chapterHasUpdate && (
                          <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-3xs font-medium text-primary-700">
                            {t("offline.downloadsPage.content.updateAvailable")}
                          </span>
                        )}
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {chapterHasUpdate && (
                          <button
                            type="button"
                            disabled={updatingId === manifest.package_session_id}
                            onClick={() => void handleApplyUpdate(manifest.package_session_id)}
                            className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-2.5 py-1 text-caption font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                          >
                            <ArrowClockwise size={12} />
                            {updatingId === manifest.package_session_id ? t("offline.downloadsPage.content.updating") : t("offline.downloadsPage.content.update")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void handleOpenChapter(manifest, subject.subject_id, module.module_id, chapter)
                          }
                          className="inline-flex items-center gap-1 text-caption font-medium text-primary-600"
                        >
                          {t("offline.downloadsPage.content.open")} <CaretRight size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}

        {visibleManifests.length > 0 && (
          <MyButton buttonType="secondary" disable={busy} onClick={() => setPendingDelete({ kind: "all" })}>
            {t("offline.downloadsPage.content.clearAll")}
          </MyButton>
        )}
        </TabsContent>
      </Tabs>

      {/* Deleting downloaded content erases the encrypted files and forces a
          re-download, so both destructive paths confirm first. */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "all"
                ? t("offline.downloadsPage.confirmDialog.clearAllTitle")
                : pendingDelete?.kind === "device"
                  ? pendingDelete.isThisDevice
                    ? t("offline.downloadsPage.confirmDialog.removeThisDeviceTitle")
                    : t("offline.downloadsPage.confirmDialog.removeNamedTitle", { label: pendingDelete.label })
                  : t("offline.downloadsPage.confirmDialog.removeNamedTitle", {
                      label: pendingDelete?.kind === "subject" ? pendingDelete.label : "",
                    })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "all"
                ? t("offline.downloadsPage.confirmDialog.clearAllDescription")
                : pendingDelete?.kind === "device"
                  ? pendingDelete.isThisDevice
                    ? t("offline.downloadsPage.confirmDialog.removeThisDeviceDescription")
                    : t("offline.downloadsPage.confirmDialog.removeOtherDeviceDescription")
                  : t("offline.downloadsPage.confirmDialog.removeContentDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("offline.downloadsPage.confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void runPendingDelete()}
              className="bg-danger-600 hover:bg-danger-700"
            >
              {pendingDelete?.kind === "all" ? t("offline.downloadsPage.confirmDialog.clearAllConfirm") : t("offline.downloadsPage.confirmDialog.removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function LeaseStatusLine({ leaseState }: { leaseState: { kind: string; expiresAt?: number } }) {
  const { t, i18n } = useTranslation("layoutCommonB");
  if (leaseState.kind === "valid") {
    return (
      <div className="flex items-center gap-1.5 text-caption text-neutral-500">
        <CloudCheck size={14} className="text-success-600" />
        <span>
          {t("offline.downloadsPage.lease.validUntil", {
            date: new Date(leaseState.expiresAt ?? 0).toLocaleDateString(i18n.language),
          })}
        </span>
      </div>
    );
  }
  if (leaseState.kind === "expired") {
    return <div className="text-caption text-warning-600">{t("offline.downloadsPage.lease.expired")}</div>;
  }
  if (leaseState.kind === "revoked") {
    // Neutral wording: this state is reached both when the institute revokes the
    // device AND when the learner removes it themselves. The notice above the
    // tabs says which one it was.
    return (
      <div className="text-caption text-danger-600">
        {t("offline.downloadsPage.lease.revoked")}
      </div>
    );
  }
  return <div className="text-caption text-neutral-400">{t("offline.downloadsPage.lease.none")}</div>;
}
