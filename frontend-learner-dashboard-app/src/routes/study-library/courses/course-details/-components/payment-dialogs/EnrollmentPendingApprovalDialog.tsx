import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Clock } from "@phosphor-icons/react";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface EnrollmentPendingApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle?: string;
}

export const EnrollmentPendingApprovalDialog: React.FC<EnrollmentPendingApprovalDialogProps> = ({
  open,
  onOpenChange,
  courseTitle = getTerminology(ContentTerms.Course, SystemTerms.Course),
}) => {
  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Pending for Approval</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Your enrollment request is being reviewed by an administrator
          </DialogPrimitive.Description>
          
          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label="Close"
          >
            <Cross2Icon className="h-4 w-4" />
          </button>
          
          <div className="text-center py-8">
            {/* Pending Icon */}
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="w-20 h-20 bg-gradient-to-br from-warning-100 to-primary-200 rounded-full flex items-center justify-center shadow-lg">
                  <Clock className="w-10 h-10 text-yellow-600" />
                </div>
                <div className="absolute -top-1 -end-1 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                  <Clock className="w-3 h-3 text-white" />
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">
                Pending for Approval
              </h3>
            </div>

            {/* Approval Card */}
            <div className="mt-8 bg-gradient-to-r from-warning-50 to-primary-50 border border-yellow-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-start space-y-stack">
                  <p className="text-sm text-yellow-800">
                    Your enrollment request is being reviewed by an administrator.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-sm text-yellow-700">
                      <div className="w-1.5 h-1.5 bg-yellow-600 rounded-full"></div>
                      <span>You will receive an email notification once approved</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-yellow-700">
                      <div className="w-1.5 h-1.5 bg-yellow-600 rounded-full"></div>
                      <span>{getTerminology(ContentTerms.Course, SystemTerms.Course)} access will be granted automatically</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};


