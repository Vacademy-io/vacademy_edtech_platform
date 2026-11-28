/**
 * Per-node offline download affordance (plan §B7). Renders on subject/module/
 * chapter cards and per-slide rows. Reads live status from the offline store
 * (`useNodeOfflineStatus`) and drives `downloadManager` for actions.
 *
 * States: NOT_DOWNLOADED → download icon; QUEUED/DOWNLOADING → progress ring
 * + percent; DOWNLOADED → check; PARTIAL → half-filled check (some content is
 * online-only, per plan §7); UPDATE_AVAILABLE → refresh icon; ERROR →
 * warning + Retry; REMOVED_BY_ADMIN → notice, Delete-only.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  CloudSlash,
  DownloadSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Network } from "@/utils/network-plugin";
import { useOfflineStore } from "@/stores/offline/use-offline-store";
import { useNodeOfflineStatus, useOfflineUserId } from "@/hooks/offline/use-offline-status";
import { useOfflineAvailable } from "@/hooks/offline/use-offline-availability";
import { isOfflineSupported } from "@/lib/offline/platform";
import { downloadManager } from "@/lib/offline/download/download-manager";
import {
  slidesInSubtree,
  subtreeHasOnlineOnly,
  type ExpandableNodeType,
} from "@/lib/offline/download/expander";
import { getOfflineDb } from "@/lib/offline/db/connection";
import { useRouter } from "@tanstack/react-router";
import { metaDao, routeContextKey, type OfflineRouteContext } from "@/lib/offline/db/dao/meta-dao";
import { nodesDao } from "@/lib/offline/db/dao/nodes-dao";
import { ensureManifest, loadPersistedManifest } from "@/services/offline/manifest-service";
import { DeviceLimitReachedError, type OfflineDeviceDTO } from "@/services/offline/device-service";
import { DeviceLimitDialog } from "./device-limit-dialog";

export interface DownloadNodeButtonProps {
  nodeId: string;
  nodeType: ExpandableNodeType;
  packageSessionId: string | undefined | null;
  className?: string;
  /** Compact icon-only rendering for dense lists (chapter-sidebar-slides rows). */
  compact?: boolean;
}

export const DownloadNodeButton = ({
  nodeId,
  nodeType,
  packageSessionId,
  className,
  compact,
}: DownloadNodeButtonProps) => {
  const { t } = useTranslation("layoutCommonB");
  const userId = useOfflineUserId();
  const offlineAvailable = useOfflineAvailable();
  const router = useRouter();
  const status = useNodeOfflineStatus(nodeId);
  const [busy, setBusy] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [deviceLimitInfo, setDeviceLimitInfo] = useState<{ devices: OfflineDeviceDTO[]; message: string } | null>(
    null
  );
  /** Deleting is irreversible without a connection, so it confirms first — the
   *  same contract the Downloads screen's delete paths follow. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Whether this node has anything the admin actually allows offline.
   * `null` = manifest not read yet. The manifest is the authority: each slide
   * carries `downloadable` + `reason` (ALLOWED / PERMISSION_DENIED /
   * ONLINE_ONLY) resolved server-side. Without this check every node rendered a
   * download control — including empty chapters and ones the institute has
   * blocked — so tapping it queued nothing and looked broken.
   */
  const [hasDownloadableContent, setHasDownloadableContent] = useState<boolean | null>(null);
  /**
   * Whether anything under this node is online-only. It no longer changes the
   * rollup status (a node whose every savable slide is stored reads DOWNLOADED),
   * so it survives only as tooltip wording — the learner should still be able to
   * find out why a "downloaded" chapter has slides that need a connection.
   */
  const [hasOnlineOnly, setHasOnlineOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !packageSessionId) {
      setHasDownloadableContent(null);
      return;
    }
    (async () => {
      try {
        // ensureManifest (not loadPersistedManifest) so a fresh install can
        // resolve this at all: the manifest used to be fetched only on tap,
        // and this gate hides the tap target until a manifest exists.
        const manifest = await ensureManifest(userId, packageSessionId);
        if (cancelled) return;
        if (!manifest) {
          // Still unknown (offline, or the fetch failed) — stay hidden rather
          // than offering a download we can't validate.
          setHasDownloadableContent(null);
          return;
        }
        setHasDownloadableContent(
          slidesInSubtree(manifest, nodeId, nodeType).some((ctx) => ctx.slide.downloadable)
        );
        setHasOnlineOnly(subtreeHasOnlineOnly(manifest, nodeId, nodeType));
      } catch {
        if (!cancelled) setHasDownloadableContent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, packageSessionId, nodeId, nodeType, status]);

  useEffect(() => {
    let cancelled = false;
    if (!userId || (status !== "DOWNLOADING" && status !== "QUEUED")) {
      setProgressPercent(null);
      return;
    }
    (async () => {
      const db = await getOfflineDb();
      const node = await nodesDao.get(db, userId, nodeId);
      if (!cancelled && node && node.bytes_total > 0) {
        setProgressPercent(Math.min(100, Math.round((node.bytes_done / node.bytes_total) * 100)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, nodeId, status]);

  // Platform + institute kill switch. isOfflineSupported() covers web; the
  // availability hook adds the admin's offline setting, so a learner whose
  // institute disabled offline never sees a download control at all.
  if (!isOfflineSupported() || !userId || !packageSessionId) return null;
  if (offlineAvailable !== true) return null;
  // Nothing here is allowed offline (or the manifest isn't known yet) — show no
  // control at all, so the icon means "this really can be saved".
  if (!hasDownloadableContent) return null;

  const handleDownload = async (allowCellular = false) => {
    // On mobile data with Wi-Fi-only ON the download can't start. Without this
    // the learner taps Download and nothing visibly happens, which reads as a
    // broken button — so say why, and point at the setting that changes it.
    if (!allowCellular && useOfflineStore.getState().wifiOnly) {
      try {
        const net = await Network.getStatus();
        if (net.connected && net.connectionType !== "wifi") {
          toast.info(t("offline.downloadNodeButton.toasts.wifiOnlyTitle"), {
            description: t("offline.downloadNodeButton.toasts.wifiOnlyDescription"),
            action: {
              label: t("offline.downloadNodeButton.toasts.changeSettings"),
              onClick: () =>
                void router.navigate({ to: "/downloads", search: { tab: "settings" } }),
            },
            duration: 7000,
          });
          return;
        }
      } catch {
        // Can't read connectivity — fall through and let preflight decide.
      }
    }

    setBusy(true);
    try {
      await downloadManager.enqueueNode(userId, packageSessionId, nodeId, nodeType, {
        allowCellular,
      });
      // Remember the course route context so the Downloads screen can
      // deep-link back into this content (manifest has no courseId/levelId).
      try {
        const search = router.state.location.search as Record<string, unknown>;
        const ctx: OfflineRouteContext = {
          courseId: typeof search.courseId === "string" ? search.courseId : undefined,
          levelId: typeof search.levelId === "string" ? search.levelId : undefined,
          sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
        };
        if (ctx.courseId) {
          const db = await getOfflineDb();
          await metaDao.set(db, routeContextKey(packageSessionId), JSON.stringify(ctx));
        }
      } catch {
        // non-fatal — Downloads screen falls back to a message
      }
      toast.success(t("offline.downloadNodeButton.toasts.downloadStarted"));
    } catch (error) {
      if (error instanceof DeviceLimitReachedError) {
        setDeviceLimitInfo({ devices: error.devices, message: error.message });
      } else {
        console.error("[offline] failed to enqueue download", error);
        const message = error instanceof Error ? error.message : "";
        toast.error(
          /Network Error|Failed to fetch|timeout/i.test(message)
            ? t("offline.downloadNodeButton.toasts.networkError")
            : t("offline.downloadNodeButton.toasts.startFailed")
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = () => handleDownload();

  const handleUpdate = async () => {
    setBusy(true);
    try {
      await downloadManager.applyManifestUpdate(userId, packageSessionId);
    } catch (error) {
      console.error("[offline] failed to apply manifest update", error);
      toast.error("Couldn't update the download — please try again");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const manifest = await loadPersistedManifest(userId, packageSessionId);
      const slideIds = manifest
        ? slidesInSubtree(manifest, nodeId, nodeType)
            .filter((ctx) => ctx.slide.downloadable)
            .map((ctx) => ctx.slide.slide_id)
        : [nodeId];
      await downloadManager.deleteNode(userId, packageSessionId, slideIds);
    } finally {
      setBusy(false);
    }
  };

  const handlePauseCancel = async () => {
    setBusy(true);
    try {
      const manifest = await loadPersistedManifest(userId, packageSessionId);
      const slideIds = manifest
        ? slidesInSubtree(manifest, nodeId, nodeType)
            .filter((ctx) => ctx.slide.downloadable)
            .map((ctx) => ctx.slide.slide_id)
        : [nodeId];
      await downloadManager.cancelNode(userId, packageSessionId, slideIds);
    } finally {
      setBusy(false);
    }
  };

  const iconSize = compact ? 16 : 20;
  const wrapperClass = cn(
    "inline-flex items-center justify-center rounded-full transition-colors",
    compact ? "size-6" : "size-8",
    className
  );

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const effectiveStatus = status ?? "NOT_DOWNLOADED";

  const iconFor = () => {
    if (busy || effectiveStatus === "DOWNLOADING" || effectiveStatus === "QUEUED") {
      return (
        <span className={cn(wrapperClass, "relative text-primary-500")} title={t("offline.downloadNodeButton.status.downloading")}>
          <CircleNotch size={iconSize} className="animate-spin" />
          {!compact && progressPercent !== null && (
            <span className="absolute -bottom-4 text-3xs text-neutral-500">{progressPercent}%</span>
          )}
        </span>
      );
    }
    if (effectiveStatus === "DOWNLOADED") {
      return (
        <span
          className={cn(wrapperClass, "text-success-600")}
          title={
            hasOnlineOnly
              ? t("offline.downloadNodeButton.status.savedWithOnlineOnly")
              : t("offline.downloadNodeButton.status.downloaded")
          }
        >
          <CheckCircle size={iconSize} weight="fill" />
        </span>
      );
    }
    // PARTIAL means some of this subtree is still missing (online-only slides
    // don't count — they never get a node row). A tick, even a hollow one, told
    // the learner the job was done and left no way to fetch the rest: after
    // downloading one slide of a chapter, the chapter's control turned into an
    // inert icon. Keep offering the download instead; enqueueNode skips what is
    // already stored, so tapping it only fetches what's missing.
    if (effectiveStatus === "PARTIAL") {
      return (
        <button
          type="button"
          onClick={(e) => {
            stopPropagation(e);
            void handleDownload();
          }}
          className={cn(wrapperClass, "text-primary-600 hover:bg-primary-50")}
          title={t("offline.downloadNodeButton.status.partial")}
        >
          <DownloadSimple size={iconSize} />
        </button>
      );
    }
    if (effectiveStatus === "UPDATE_AVAILABLE") {
      return (
        <button
          type="button"
          onClick={(e) => {
            stopPropagation(e);
            void handleUpdate();
          }}
          className={cn(wrapperClass, "text-primary-500 hover:bg-primary-50")}
          title={t("offline.downloadNodeButton.status.updateAvailable")}
        >
          <ArrowClockwise size={iconSize} />
        </button>
      );
    }
    if (effectiveStatus === "ERROR") {
      return (
        <button
          type="button"
          onClick={(e) => {
            stopPropagation(e);
            void handleRetry();
          }}
          className={cn(wrapperClass, "text-danger-600 hover:bg-danger-50")}
          title={t("offline.downloadNodeButton.status.error")}
        >
          <WarningCircle size={iconSize} />
        </button>
      );
    }
    if (effectiveStatus === "REMOVED_BY_ADMIN") {
      return (
        <span className={cn(wrapperClass, "text-neutral-400")} title={t("offline.downloadNodeButton.status.removedByAdmin")}>
          <CloudSlash size={iconSize} />
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          stopPropagation(e);
          void handleDownload();
        }}
        className={cn(wrapperClass, "text-neutral-500 hover:bg-neutral-100 hover:text-primary-600")}
        title={t("offline.downloadNodeButton.status.notDownloaded")}
      >
        <DownloadSimple size={iconSize} />
      </button>
    );
  };

  /**
   * A single destructive affordance sits next to the status icon whenever this
   * node holds (or is fetching) something. It replaced a kebab whose menu had
   * one or two items — an extra tap and an extra mental step to reach the only
   * action anyone wanted. Retry already lives on the error icon itself.
   */
  const inFlight = effectiveStatus === "DOWNLOADING" || effectiveStatus === "QUEUED";
  const showTrash = effectiveStatus !== "NOT_DOWNLOADED";

  return (
    <div className="flex items-center gap-1" onClick={stopPropagation}>
      {iconFor()}
      {showTrash && (
        <button
          type="button"
          // Mid-download the stored bytes are partial and nothing is usable
          // offline yet, so this cancels rather than prompting to delete.
          onClick={() => (inFlight ? void handlePauseCancel() : setConfirmDelete(true))}
          disabled={busy}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50",
            compact ? "size-6" : "size-7"
          )}
          title={inFlight ? t("offline.downloadNodeButton.cancelDownload") : t("offline.downloadNodeButton.removeDownload")}
        >
          <Trash size={compact ? 14 : 16} />
        </button>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("offline.downloadNodeButton.confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("offline.downloadNodeButton.confirmDelete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("offline.downloadNodeButton.confirmDelete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void handleDelete()}
              className="bg-danger-600 hover:bg-danger-700"
            >
              {t("offline.downloadNodeButton.confirmDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {deviceLimitInfo && (
        <DeviceLimitDialog
          open={!!deviceLimitInfo}
          onOpenChange={(open) => !open && setDeviceLimitInfo(null)}
          devices={deviceLimitInfo.devices}
          message={deviceLimitInfo.message}
          onRetry={() => void handleDownload()}
        />
      )}
    </div>
  );
};
