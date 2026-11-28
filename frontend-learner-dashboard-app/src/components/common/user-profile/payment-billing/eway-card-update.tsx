import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { SpinnerGap } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import EwayCardForm from "@/components/common/enroll-by-invite/-components/eway-card-form";
import { confirmEwayCardUpdate } from "./payment-method-services";

interface EwayCardUpdateProps {
  instituteId: string;
  onUpdated: () => void;
  onCancel: () => void;
}

interface EncryptedCard {
  encryptedNumber: string;
  encryptedCVN: string;
  cardData: {
    name: string;
    expiryMonth: string;
    expiryYear: string;
  };
}

/**
 * Collects a new card with the existing eWay encrypted form and replaces the
 * card on the learner's eWay Token Customer (UpdateTokenCustomer — same token,
 * so renewals keep working). Must be rendered inside an EwayProvider.
 */
export const EwayCardUpdate = ({
  instituteId,
  onUpdated,
  onCancel,
}: EwayCardUpdateProps) => {
  const { t } = useTranslation("userProfileExtra");
  const [encryptedCard, setEncryptedCard] = useState<EncryptedCard | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!encryptedCard) {
      toast.error(t("cardUpdate.eway.incomplete"));
      return;
    }
    setIsSaving(true);
    try {
      await confirmEwayCardUpdate(instituteId, {
        cardName: encryptedCard.cardData.name,
        expiryMonth: encryptedCard.cardData.expiryMonth,
        expiryYear: encryptedCard.cardData.expiryYear,
        encryptedCardNumber: encryptedCard.encryptedNumber,
        encryptedCvn: encryptedCard.encryptedCVN,
      });
      toast.success(t("cardUpdate.success"));
      onUpdated();
    } catch (error) {
      console.error("eWay card update failed:", error);
      toast.error(t("cardUpdate.genericError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <EwayCardForm
        isProcessing={isSaving}
        onPaymentReady={setEncryptedCard}
        onError={(error) => toast.error(error)}
      />
      <div className="flex items-center justify-end gap-3">
        <MyButton
          type="button"
          scale="medium"
          buttonType="secondary"
          layoutVariant="default"
          onClick={onCancel}
          disabled={isSaving}
        >
          {t("common.cancel")}
        </MyButton>
        <MyButton
          type="button"
          scale="medium"
          buttonType="primary"
          layoutVariant="default"
          onClick={handleSave}
          disabled={isSaving || !encryptedCard}
        >
          {isSaving ? (
            <>
              <SpinnerGap className="me-2 size-4 animate-spin" />
              {t("common.saving")}
            </>
          ) : (
            t("common.saveCard")
          )}
        </MyButton>
      </div>
    </div>
  );
};
