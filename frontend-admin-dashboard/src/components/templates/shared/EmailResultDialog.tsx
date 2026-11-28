import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface EmailResultDialogProps {
    isOpen: boolean;
    onClose: () => void;
    result: {
        success: boolean;
        totalStudents: number;
        processedStudents: number;
        failedStudents: number;
        inProgress?: boolean;
        errors?: Array<{ studentId: string; error: string }>;
    };
}

export const EmailResultDialog: React.FC<EmailResultDialogProps> = ({
    isOpen,
    onClose,
    result
}) => {
    const { success, totalStudents, processedStudents, failedStudents, errors, inProgress } = result;
    const successCount = processedStudents - failedStudents;

    const getDialogContent = () => {
        if (inProgress) {
            return {
                icon: <CheckCircle className="h-12 w-12 text-green-500" />,
                title: "Sending in the Background",
                message: `Your email to ${totalStudents} student(s) is going out at a paced rate. This continues even if you close this page, so please do not send it again.`,
                buttonText: "Close",
                buttonVariant: "default" as const
            };
        }
        if (success && failedStudents === 0) {
            return {
                icon: <CheckCircle className="h-12 w-12 text-green-500" />,
                title: "Email Sent Successfully!",
                message: `Successfully sent ${successCount} personalized email(s) to ${totalStudents} student(s).`,
                buttonText: "Close",
                buttonVariant: "default" as const
            };
        } else if (success && failedStudents > 0) {
            return {
                icon: <AlertTriangle className="h-12 w-12 text-yellow-500" />,
                title: "Partially Successful",
                message: `Sent ${successCount} email(s) successfully, but ${failedStudents} failed.`,
                buttonText: "View Details",
                buttonVariant: "secondary" as const
            };
        } else {
            return {
                icon: <XCircle className="h-12 w-12 text-red-500" />,
                title: "Failed to Send Emails",
                message: `Could not complete this send to ${failedStudents} student(s). Please check the details before sending again.`,
                buttonText: "Close",
                buttonVariant: "destructive" as const
            };
        }
    };

    const content = getDialogContent();

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[95vw] max-w-md sm:w-[90vw] md:w-[85vw] lg:w-[80vw] xl:w-[75vw] 2xl:max-w-md">
                <DialogHeader className="px-4 sm:px-6">
                    <DialogTitle className="text-center text-lg sm:text-xl">
                        {content.title}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col items-center space-y-3 sm:space-y-4 py-3 sm:py-4 px-4 sm:px-6">
                    <div className="scale-75 sm:scale-100">
                        {content.icon}
                    </div>
                    <p className="text-center text-xs sm:text-sm text-gray-600 break-words">
                        {content.message}
                    </p>

                    {errors && errors.length > 0 && (
                        <div className="w-full">
                            <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2">Error Details:</h4>
                            <div className="max-h-24 sm:max-h-32 overflow-y-auto space-y-1">
                                {errors.map((error, index) => (
                                    <div key={index} className="text-xs text-red-600 bg-red-50 p-2 rounded break-words">
                                        Student {error.studentId}: {error.error}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-center px-4 sm:px-6 pb-4 sm:pb-6">
                    <Button
                        onClick={onClose}
                        variant={content.buttonVariant}
                        className="w-full text-xs sm:text-sm px-4 py-2"
                    >
                        {content.buttonText}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
