import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "We only rent in <city>. Continue?" — shown before the storefront switches to rent mode.
 * Moved out of BuyRentSectionComponent (same copy, same city) so every way into rent mode
 * (Home's Rent card, the catalogue's Buy/Rent switch, a plan card) asks the same question.
 * Built on the shared Dialog, which portals to the body, so a parent's transform or entrance
 * animation can't trap the overlay inside a section.
 */
interface RentLocationConfirmDialogProps {
  open: boolean;
  /** Close without changing anything (X, Escape, click outside). */
  onCancel: () => void;
  /** The visitor accepts the restriction: go on into rent mode. */
  onContinue: () => void;
  /** The visitor would rather buy: switch (or stay) in buy mode. */
  onBuyInstead: () => void;
  city?: string;
}

export const RentLocationConfirmDialog: React.FC<RentLocationConfirmDialogProps> = ({
  open,
  onCancel,
  onContinue,
  onBuyInstead,
  city = "Jabalpur",
}) => {
  const { t } = useTranslation("coursePlayerB");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-sm rounded-catalogue-md p-4">
        <DialogHeader>
          <DialogTitle className="text-base">{t("buyRentSection.locationRestrictionTitle")}</DialogTitle>
          <DialogDescription>
            {t("buyRentSection.locationRestrictionMessage", { city })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBuyInstead}
            className="flex-1 px-3 py-2 text-sm font-medium text-primary-500 border border-primary-400 rounded-catalogue-sm hover:bg-primary-50 transition-colors"
          >
            {t("buyRentSection.buyInstead")}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 px-3 py-2 text-sm font-medium text-primary-foreground bg-primary-500 rounded-catalogue-sm hover:brightness-90 transition"
          >
            {t("buyRentSection.continue")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
