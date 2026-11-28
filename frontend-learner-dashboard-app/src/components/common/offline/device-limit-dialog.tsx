/**
 * Device-cap UX (plan §B6 point 4): shown when registering this device for
 * offline access hits `DEVICE_LIMIT_REACHED` (409). Lists the institute's
 * current offline devices for this learner and lets them free a slot with
 * "Remove", then retries the download that triggered the dialog.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { MyDialog } from "@/components/design-system/dialog";
import { MyButton } from "@/components/design-system/button";
import { selfRevokeDevice, type OfflineDeviceDTO } from "@/services/offline/device-service";

export interface DeviceLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: OfflineDeviceDTO[];
  message: string;
  /** Re-attempts the download that triggered this dialog after a device is freed. */
  onRetry: () => void;
}

export const DeviceLimitDialog = ({ open, onOpenChange, devices, message, onRetry }: DeviceLimitDialogProps) => {
  const { t } = useTranslation("layoutCommonB");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const handleRemove = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      await selfRevokeDevice(deviceId);
      setRemoved((prev) => new Set(prev).add(deviceId));
      toast.success(t("offline.deviceLimitDialog.toasts.removed"));
    } catch (error) {
      console.error("[offline] failed to self-revoke device", error);
      toast.error(t("offline.deviceLimitDialog.toasts.removeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = () => {
    onOpenChange(false);
    onRetry();
  };

  return (
    <MyDialog open={open} onOpenChange={onOpenChange} heading={t("offline.deviceLimitDialog.heading")} dialogWidth="w-96">
      <div className="flex flex-col gap-4 p-2">
        <p className="text-body text-neutral-600">{message}</p>
        <div className="flex flex-col gap-2">
          {devices.map((device) => {
            const isRemoved = removed.has(device.id);
            return (
              <div
                key={device.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-body font-medium text-neutral-700">
                    {device.device_name ?? t("offline.deviceLimitDialog.unnamedDevice")}
                  </span>
                  <span className="text-caption text-neutral-400">{device.platform ?? t("offline.deviceLimitDialog.unknownPlatform")}</span>
                </div>
                {isRemoved ? (
                  <span className="text-caption text-success-600">{t("offline.deviceLimitDialog.removed")}</span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === device.id}
                    onClick={() => void handleRemove(device.id)}
                    className="inline-flex items-center gap-1 text-caption text-danger-600 hover:underline disabled:opacity-50"
                  >
                    <Trash size={14} /> {t("offline.deviceLimitDialog.remove")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <MyButton buttonType="primary" disable={removed.size === 0} onClick={handleRetry}>
          {t("offline.deviceLimitDialog.retryDownload")}
        </MyButton>
      </div>
    </MyDialog>
  );
};
