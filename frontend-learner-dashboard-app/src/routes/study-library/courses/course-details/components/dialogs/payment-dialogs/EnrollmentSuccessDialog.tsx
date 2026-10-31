import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, ArrowRight } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface EnrollmentSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  onExploreCourse: () => void;
}

export const EnrollmentSuccessDialog: React.FC<EnrollmentSuccessDialogProps> = ({
  open,
  onOpenChange,
  courseTitle,
  onExploreCourse,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold text-green-700">
            Enrollment Successful!
          </DialogTitle>
        </DialogHeader>
        
        <div className="text-center py-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Welcome to {courseTitle}!
          </h3>
          
          <p className="text-gray-600 mb-6">
            You have successfully enrolled in the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}. You can now access all the slides and start learning.
          </p>
          
          <MyButton
            type="button"
            scale="large"
            buttonType="primary"
            layoutVariant="default"
            onClick={onExploreCourse}
            className="w-full flex items-center justify-center space-x-2"
          >
            <span>Explore {getTerminology(ContentTerms.Course, SystemTerms.Course)}</span>
            <ArrowRight className="w-4 h-4" />
          </MyButton>
        </div>
      </DialogContent>
    </Dialog>
  );
};

