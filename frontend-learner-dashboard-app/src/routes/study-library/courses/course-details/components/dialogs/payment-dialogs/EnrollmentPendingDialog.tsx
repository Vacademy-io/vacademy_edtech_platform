import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, CheckCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface EnrollmentPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
}

export const EnrollmentPendingDialog: React.FC<EnrollmentPendingDialogProps> = ({
  open,
  onOpenChange,
  courseTitle,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold text-blue-700">
            Enrollment Request Submitted
          </DialogTitle>
        </DialogHeader>
        
        <div className="text-center py-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Clock className="w-8 h-8 text-blue-600" />
            </div>
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Request Submitted Successfully
          </h3>
          
          {/* <p className="text-gray-600 mb-6">
            Your enrollment request for <strong>{courseTitle}</strong> has been submitted successfully.
          </p>
           */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-2 text-blue-800">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">What happens next?</span>
            </div>
            <ul className="text-sm text-blue-700 mt-2 space-y-1">
              <li>• Admin will review your enrollment request</li>
              <li>• You'll receive notification once approved</li>
              <li>• Access to {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} slides will be granted</li>
            </ul>
          </div>
          
          <MyButton
            type="button"
            scale="large"
            buttonType="secondary"
            layoutVariant="default"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Close
          </MyButton>
        </div>
      </DialogContent>
    </Dialog>
  );
};

