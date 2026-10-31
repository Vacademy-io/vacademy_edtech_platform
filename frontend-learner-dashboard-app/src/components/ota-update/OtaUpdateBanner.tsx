import { useTranslation } from "react-i18next";
import { useOtaUpdate } from "@/stores/useOtaUpdate";
import { downloadAndApplyUpdate } from "@/services/ota-update";

export function OtaUpdateBanner() {
  const { t } = useTranslation("miscComponents");
  const {
    otaUpdateAvailable,
    otaVersion,
    otaDownloadUrl,
    otaChecksum,
    otaForceUpdate,
    otaReleaseNotes,
    otaDownloading,
    otaAutoUpdating,
    setOtaDownloading,
    resetOta,
  } = useOtaUpdate();

  // Auto-updating dialog ("auto" mode): non-dismissible loader shown at launch
  // while the new bundle downloads + applies in place. No user action needed.
  if (otaAutoUpdating) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="mx-4 flex max-w-sm flex-col items-center rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            {t("otaUpdate.autoUpdating.title")}
          </h2>
          {otaVersion && (
            <p className="mb-1 text-sm text-gray-500">
              {t("otaUpdate.version", { version: otaVersion })}
            </p>
          )}
          <p className="text-sm text-gray-600">
            {t("otaUpdate.autoUpdating.pleaseWait")}
          </p>
        </div>
      </div>
    );
  }

  if (!otaUpdateAvailable) return null;

  const handleUpdate = async () => {
    if (!otaDownloadUrl || !otaVersion || !otaChecksum) return;
    try {
      setOtaDownloading(true);
      await downloadAndApplyUpdate(otaDownloadUrl, otaVersion, otaChecksum);
      // Bundle is staged — it will load on next app restart.
      // The set() call in the service already triggers a reload.
    } catch (e) {
      console.error("OTA download failed:", e);
      setOtaDownloading(false);
    }
  };

  // Force update: full-screen blocking overlay
  if (otaForceUpdate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="mx-4 max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            {t("otaUpdate.forceUpdate.title")}
          </h2>
          <p className="mb-1 text-sm text-gray-500">
            {t("otaUpdate.version", { version: otaVersion })}
          </p>
          {otaReleaseNotes && (
            <p className="mb-4 text-sm text-gray-600">{otaReleaseNotes}</p>
          )}
          {otaDownloading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-sm text-gray-500">
                {t("otaUpdate.forceUpdate.downloading")}
              </p>
            </div>
          ) : (
            <button
              onClick={handleUpdate}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {t("otaUpdate.forceUpdate.updateNow")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Optional update: dismissible top banner
  return (
    <div className="fixed start-0 end-0 top-0 z-40 flex items-center justify-between bg-primary/90 px-4 py-2 text-white backdrop-blur-sm">
      <span className="text-sm">
        {t("otaUpdate.banner.updateAvailable", { version: otaVersion })}
        {otaReleaseNotes
          ? t("otaUpdate.banner.releaseNotesSuffix", { notes: otaReleaseNotes })
          : ""}
      </span>
      <div className="flex items-center gap-2">
        {otaDownloading ? (
          <span className="text-xs">{t("otaUpdate.banner.downloading")}</span>
        ) : (
          <button
            onClick={handleUpdate}
            className="rounded bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30"
          >
            {t("otaUpdate.banner.update")}
          </button>
        )}
        <button
          onClick={resetOta}
          className="rounded px-2 py-1 text-xs hover:bg-white/20"
        >
          {t("otaUpdate.banner.dismiss")}
        </button>
      </div>
    </div>
  );
}
