/**
 * Offline lease-expired / revoked lock overlay (plan §B6/§B7). Sibling of
 * `requires-internet-slide.tsx` — same layout language, different copy and
 * icon per `LockReason` (see `src/lib/offline/resolve.ts`).
 */

import { useTranslation } from "react-i18next";
import { LockKey, Prohibit } from "@phosphor-icons/react";
import type { LockReason } from "@/lib/offline/resolve";

export const LeaseLockOverlay = ({ reason }: { reason: LockReason }) => {
  const { t } = useTranslation("libraryCommonB");
  const COPY: Record<LockReason, { title: string; body: string }> = {
    LEASE_EXPIRED: {
      title: t("leaseLockOverlay.leaseExpired.title"),
      body: t("leaseLockOverlay.leaseExpired.body"),
    },
    REVOKED: {
      title: t("leaseLockOverlay.revoked.title"),
      body: t("leaseLockOverlay.revoked.body"),
    },
  };
  const { title, body } = COPY[reason];
  const Icon = reason === "REVOKED" ? Prohibit : LockKey;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
        <Icon size={32} className="text-neutral-400" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-title font-semibold text-neutral-700">{title}</p>
        <p className="max-w-sm text-body text-neutral-500">{body}</p>
      </div>
    </div>
  );
};
