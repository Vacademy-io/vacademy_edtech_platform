import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { CheckCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface ApprovalSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  onExploreCourse?: () => void;
  onClose?: () => void;
}

export const ApprovalSuccessDialog: React.FC<ApprovalSuccessDialogProps> = ({
  open,
  onOpenChange,
  courseTitle,
  onExploreCourse,
  onClose,
}) => {
  const { t } = useTranslation("study");
  const courseLower = getTerminology(
    ContentTerms.Course,
    SystemTerms.Course
  ).toLocaleLowerCase();

  const handleClose = () => {
    onOpenChange(false);
    onClose?.();
  };

  const handleExploreCourse = () => {
    onExploreCourse?.();
    handleClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{t("approval.success.srTitle")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("approval.success.srDescription", { course: courseLower })}
          </DialogPrimitive.Description>

          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label={t("dialog.close")}
          >
            <Cross2Icon className="h-4 w-4" />
          </button>
          
          <div className="text-center py-8">
            {/* Success Icon */}
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="w-20 h-20 bg-gradient-to-br from-success-100 to-success-200 rounded-full flex items-center justify-center shadow-lg">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
                <div className="absolute -top-1 -end-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-3 h-3 text-white" />
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">
                {t("approval.success.heading")}
              </h3>
            </div>
            
            {/* Success Card */}
            <div className="mt-8 bg-gradient-to-r from-success-50 to-success-50 border border-green-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-start space-y-1">
                  <h4 className="text-sm font-semibold text-green-900">
                    {t("approval.success.readyTitle")}
                  </h4>
                  <p className="text-sm text-green-800">
                    {t("approval.success.readyMessage", { course: courseLower })}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Action Button */}
            <div className="mt-8">
              <MyButton
                buttonType="primary"
                scale="large"
                onClick={handleExploreCourse}
                className="w-full h-12 text-base font-semibold"
              >
                {t("approval.success.startLearning")}
              </MyButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
