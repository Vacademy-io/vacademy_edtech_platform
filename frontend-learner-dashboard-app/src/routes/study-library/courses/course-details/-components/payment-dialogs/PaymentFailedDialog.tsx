import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { XCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";

interface PaymentFailedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  onTryAgain?: () => void;
  onClose?: () => void;
}

export const PaymentFailedDialog: React.FC<PaymentFailedDialogProps> = ({
  open,
  onOpenChange,
  courseTitle,
  onTryAgain,
  onClose,
}) => {
  const { t } = useTranslation("study");

  // Log when dialog opens
  React.useEffect(() => {
    if (open) {
      console.log('PaymentFailedDialog - Dialog opened', {
        courseTitle
      });
    }
  }, [open, courseTitle]);

  const handleClose = () => {
    console.log('PaymentFailedDialog - Dialog closing', {
      courseTitle
    });
    onOpenChange(false);
    onClose?.();
  };

  const handleTryAgain = () => {
    console.log('PaymentFailedDialog - Try again clicked', {
      courseTitle
    });
    onTryAgain?.();
    handleClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{t("payment.failed.srTitle")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("payment.failed.srDescription")}
          </DialogPrimitive.Description>

          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label={t("dialog.close")}
          >
            <Cross2Icon className="h-4 w-4" />
          </button>
          
          <div className="text-center py-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
            </div>
            
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("payment.failed.heading")}
            </h3>

            <p className="text-gray-600 mb-6">
              {t("payment.failed.description")}
            </p>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 space-y-2">
              <div className="flex items-center gap-x-2 text-red-800">
                <XCircle className="w-4 h-4" />
                <span className="text-sm font-medium">{t("payment.failed.nextTitle")}</span>
              </div>
              <ul className="text-sm text-red-700 space-y-1 text-start">
                <li>• {t("payment.failed.step1")}</li>
                <li>• {t("payment.failed.step2")}</li>
                <li>• {t("payment.failed.step3")}</li>
              </ul>
            </div>
            
            <div className="flex justify-center">
              <MyButton
                buttonType="primary"
                scale="medium"
                onClick={handleTryAgain}
                className="w-full max-w-xs"
              >
                {t("payment.failed.tryAgain")}
              </MyButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
