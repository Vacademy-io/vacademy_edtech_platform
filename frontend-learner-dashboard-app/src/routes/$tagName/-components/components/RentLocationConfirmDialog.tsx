import React from "react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "We only rent in <city>. Continue?" — shown before the storefront switches to rent mode, and
 * only when the catalogue names its rent city (`globalSettings.rentLocationCity`, see
 * rentLocationCityOf). Every way into rent mode (the Buy/Rent section's Rent card, the
 * catalogue's Buy/Rent switch, a plan card) asks the same question. Built on the shared Dialog,
 * which portals to the body, so a parent's transform or entrance animation can't trap the
 * overlay inside a section.
 */
interface RentLocationConfirmDialogProps {
  open: boolean;
  /** Close without changing anything (X, Escape, click outside). */
  onCancel: () => void;
  /** The visitor accepts the restriction: go on into rent mode. */
  onContinue: () => void;
  /** The visitor would rather buy: switch (or stay) in buy mode. */
  onBuyInstead: () => void;
  /** The city the storefront rents in, from the catalogue config. */
  city: string;
}

export const RentLocationConfirmDialog: React.FC<RentLocationConfirmDialogProps> = ({
  open,
  onCancel,
  onContinue,
  onBuyInstead,
  city,
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
          <MyButton
            type="button"
            buttonType="secondary"
            scale="medium"
            className="min-w-0 flex-1"
            onClick={onBuyInstead}
          >
            {t("buyRentSection.buyInstead")}
          </MyButton>
          <MyButton
            type="button"
            buttonType="primary"
            scale="medium"
            className="min-w-0 flex-1"
            onClick={onContinue}
          >
            {t("buyRentSection.continue")}
          </MyButton>
        </div>
      </DialogContent>
    </Dialog>
  );
};
