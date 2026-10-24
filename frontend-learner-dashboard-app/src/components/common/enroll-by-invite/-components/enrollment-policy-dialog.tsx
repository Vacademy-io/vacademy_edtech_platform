import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import {
    ChatCircle,
    Warning,
    CheckCircle,
    ArrowSquareOut,
    Sparkle,
    X
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// Types for the enrollment policy response
export interface EnrollmentPolicyFrontendAction {
    type: string;
    description: string;
    buttonText: string;
    actionUrl: string;
}

export interface EnrollmentPolicyUpgradeOption {
    type: string;
    text: string;
    url: string;
}

export interface EnrollmentPolicyReenrollment {
    activeRepurchaseBehavior: string;
    allowReenrollmentAfterExpiry: boolean;
    reenrollmentGapInDays: number;
    alreadyEnrolledMessage: string;
    reenrollmentBlockedMessage: string;
    upgradeOptions?: {
        paid_upgrade?: EnrollmentPolicyUpgradeOption;
    };
}

export interface EnrollmentPolicyResponse {
    onExpiry?: {
        waitingPeriodInDays: number;
        enableAutoRenewal: boolean | null;
    };
    notifications?: Array<{
        trigger: string;
        notificationConfig?: {
            type: string;
            content?: {
                subject: string;
                body: string;
            };
        };
    }>;
    reenrollmentPolicy?: EnrollmentPolicyReenrollment;
    onEnrollment?: {
        terminateActiveSessions: string[];
        blockIfActiveIn: string[];
        blockMessage: string;
    };
    workflow?: {
        enabled: boolean;
        workflows?: Array<{
            workflowId: string;
            triggerOn: string;
        }>;
        frontendActions?: Record<string, EnrollmentPolicyFrontendAction>;
    };
}

export type EnrollmentPolicyDialogType =
    | "success_with_actions"
    | "already_enrolled"
    | "reenrollment_blocked"
    | "paid_member_blocked";

interface EnrollmentPolicyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dialogType: EnrollmentPolicyDialogType;
    policyResponse: EnrollmentPolicyResponse | null;
    courseName?: string;
    /**
     * The message the backend actually returned for this failure. Used only by
     * the re-enrollment dialog, whose configured copy is a template the backend
     * has already resolved (see below); the other variants keep their own copy.
     */
    serverMessage?: string;
    /**
     * Where "Login now" sends an already-registered learner: the institute's own
     * learner portal (learner_portal_base_url) + /login. When set, the
     * already-enrolled dialog offers login instead of "Go to dashboard" — the
     * learner on the public enrol form is not signed in, and their next step
     * (renew / pay to continue) lives behind login on their dashboard.
     */
    loginUrl?: string;
    onContinue?: () => void;
    onUpgrade?: (url: string) => void;
}

const EnrollmentPolicyDialog = ({
    open,
    onOpenChange,
    dialogType,
    policyResponse,
    courseName,
    serverMessage,
    loginUrl,
    onContinue,
    onUpgrade,
}: EnrollmentPolicyDialogProps) => {
    const { t } = useTranslation("enrollmentA");
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const session = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const resolvedCourseName = courseName ?? t("enrollmentPolicy.thisCourse", { course });
    const [isRedirecting, setIsRedirecting] = useState(false);

    // Extract frontend actions from policy response
    const frontendActions = policyResponse?.workflow?.frontendActions || {};
    const reenrollmentPolicy = policyResponse?.reenrollmentPolicy;
    const onEnrollment = policyResponse?.onEnrollment;

    // Handle action button click. These are post-enrollment activation steps
    // (e.g. WhatsApp verification), NOT purchases, so they stay functional on
    // iOS — only the paid-upgrade CTAs below are reader-mode gated.
    const handleActionClick = (action: EnrollmentPolicyFrontendAction) => {
        if (action.actionUrl) {
            setIsRedirecting(true);
            window.open(action.actionUrl, "_blank");
            setTimeout(() => setIsRedirecting(false), 1000);
        }
    };

    // Handle upgrade button click
    const handleUpgradeClick = (url: string) => {
        if (shouldHidePaidPurchaseUI()) return;
        if (url) {
            setIsRedirecting(true);
            if (onUpgrade) {
                onUpgrade(url);
            } else {
                window.open(url, "_blank");
            }
            setTimeout(() => setIsRedirecting(false), 1000);
        }
    };

    // Get the icon based on action type
    const getActionIcon = (type: string) => {
        switch (type) {
            case "whatsapp":
                return <ChatCircle className="w-5 h-5" />;
            default:
                return <ArrowSquareOut className="w-5 h-5" />;
        }
    };

    // Render success with actions (WhatsApp verification, etc.)
    const renderSuccessWithActions = () => (
        <>
            <DialogHeader className="flex flex-col items-center space-y-4 pb-2 pt-4">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping duration-1000" />
                    <div className="relative mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/30 ring-4 ring-white">
                        <CheckCircle className="w-10 h-10 text-white" />
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <DialogTitle className="hidden">{t("enrollmentPolicy.successTitle")}</DialogTitle>
                    <DialogDescription className="text-gray-600 text-base max-w-xs mx-auto">
                        {t("enrollmentPolicy.completeStepsPrefix")} <span className="font-semibold text-gray-900">{resolvedCourseName}</span>
                    </DialogDescription>
                </div>
            </DialogHeader>

            <div className="w-full space-y-3 py-6 px-1">
                {Object.entries(frontendActions).map(([key, action]) => (
                    <Card key={key} className="border-gray-100 shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden group">
                        <CardContent className="p-0">
                            <div className="flex flex-col sm:flex-row items-center p-4 gap-4">
                                <div className={cn(
                                    "p-3 rounded-2xl flex-shrink-0 transition-colors",
                                    action.type === "whatsapp"
                                        ? "bg-whatsapp/10 text-whatsapp group-hover:bg-whatsapp/20"
                                        : "bg-primary/10 text-primary group-hover:bg-primary/20"
                                )}>
                                    {getActionIcon(action.type)}
                                </div>

                                <div className="flex-1 text-center sm:text-start space-y-1">
                                    <h4 className="font-bold text-gray-900 text-base">
                                        {action.type === "whatsapp" ? t("enrollmentPolicy.whatsappVerification") : key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                                    </h4>
                                    <p className="text-sm text-gray-500 leading-snug">
                                        {action.description}
                                    </p>
                                </div>

                                <button
                                    onClick={() => handleActionClick(action)}
                                    disabled={isRedirecting}
                                    className={cn(
                                        "flex-shrink-0 w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 transform active:scale-[0.98]",
                                        action.type === "whatsapp"
                                            ? "bg-whatsapp hover:bg-whatsapp-hover text-white shadow-lg shadow-green-500/20"
                                            : "bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
                                    )}
                                >
                                    {getActionIcon(action.type)}
                                    <span>{action.buttonText}</span>
                                    <ArrowSquareOut className="w-3.5 h-3.5 opacity-80" />
                                </button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>


        </>
    );

    // Render already enrolled message
    const renderAlreadyEnrolled = () => (
        <>
            <DialogHeader className="space-y-4 pb-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-warning-400 to-primary-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                    <Warning className="w-8 h-8 text-white" />
                </div>
                <div className="text-center space-y-2">
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-gray-800">
                        {t("enrollmentPolicy.alreadyEnrolledTitle")}
                    </DialogTitle>
                    <DialogDescription className="text-gray-600 text-sm sm:text-base leading-relaxed">
                        {serverMessage ||
                            reenrollmentPolicy?.alreadyEnrolledMessage ||
                            t("enrollmentPolicy.alreadyEnrolledMessage", { course })}
                    </DialogDescription>
                </div>
            </DialogHeader>

            <div className="py-4 space-y-4">
                {/* <div className="rounded-xl bg-gradient-to-br from-warning-50 to-primary-50 border border-amber-200 p-4">
                    <div className="flex items-start gap-3">
                        <Sparkle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-amber-800">
                            Your existing enrollment gives you full access to all course content. Continue learning from where you left off!
                        </p>
                    </div>
                </div> */}

                {/* Upgrade option if available */}
                {!shouldHidePaidPurchaseUI() && reenrollmentPolicy?.upgradeOptions?.paid_upgrade && (
                    <div className="rounded-xl bg-gradient-to-br from-primary-50 to-info-50 border border-primary-200 p-5">
                        <div className="flex flex-col items-center text-center space-y-3">
                            <Sparkle className="w-6 h-6 text-primary-600" />
                            <h4 className="font-semibold text-gray-900">{t("enrollmentPolicy.wantToUpgrade")}</h4>
                            <p className="text-sm text-gray-600">
                                {reenrollmentPolicy.upgradeOptions.paid_upgrade.text || t("enrollmentPolicy.upgradePremiumFallback")}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={() => handleUpgradeClick(reenrollmentPolicy.upgradeOptions?.paid_upgrade?.url || "")}
                                disabled={isRedirecting}
                                className="flex items-center gap-2 px-6 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40"
                            >
                                <span>{t("enrollmentPolicy.upgradeNow")}</span>
                                <ArrowSquareOut className="w-4 h-4 ms-2" />
                            </MyButton>
                        </div>
                    </div>
                )}
            </div>

            <DialogFooter className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row gap-stack">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    onClick={() => onOpenChange(false)}
                    className="w-full sm:w-auto order-2 sm:order-1"
                >
                    <X className="w-4 h-4 me-2" />
                    {t("enrollmentPolicy.close")}
                </MyButton>
                {loginUrl ? (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => {
                            onOpenChange(false);
                            window.location.href = loginUrl;
                        }}
                        className="w-full sm:w-auto order-1 sm:order-2 bg-gradient-to-r from-primary-500 to-primary-600"
                    >
                        {t("enrollmentPolicy.loginNow")}
                    </MyButton>
                ) : (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => {
                            onOpenChange(false);
                            onContinue?.();
                        }}
                        className="w-full sm:w-auto order-1 sm:order-2 bg-gradient-to-r from-primary-500 to-primary-600"
                    >
                        {t("enrollmentPolicy.goToDashboard")}
                    </MyButton>
                )}
            </DialogFooter>
        </>
    );

    // Render reenrollment blocked message
    const renderReenrollmentBlocked = () => (
        <>
            <DialogHeader className="space-y-4 pb-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-danger-400 to-danger-500 flex items-center justify-center shadow-lg shadow-red-500/30">
                    <Warning className="w-8 h-8 text-white" />
                </div>
                <div className="text-center space-y-2">
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-gray-800">
                        {t("enrollmentPolicy.readyToContinue")}
                    </DialogTitle>
                    <DialogDescription className="text-gray-600 text-sm sm:text-base leading-relaxed">
                        {/* The backend substitutes {{allowed_date}} into the configured
                            copy before throwing, so its message is the only version with
                            a real date in it — the stored template still reads
                            "{{allowed_date}}" literally. Prefer the resolved text, and
                            keep a fallback so this never renders an empty dialog. */}
                        {serverMessage ||
                            reenrollmentPolicy?.reenrollmentBlockedMessage ||
                            t("enrollmentPolicy.reenrollmentBlockedFallback")}
                    </DialogDescription>
                </div>
            </DialogHeader>

            {!shouldHidePaidPurchaseUI() && reenrollmentPolicy?.upgradeOptions?.paid_upgrade && (
                <div className="py-4">
                    <div className="rounded-xl bg-gradient-to-br from-primary-50 to-info-50 border border-primary-200 p-5">
                        <div className="flex flex-col items-center text-center space-y-3">
                            <Sparkle className="w-6 h-6 text-primary-600" />
                            <h4 className="font-semibold text-gray-900">{t("enrollmentPolicy.upgradeToContinueLearning")}</h4>
                            <p className="text-sm text-gray-600">
                                {t("enrollmentPolicy.clickBelowToJoin")}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={() => handleUpgradeClick(reenrollmentPolicy.upgradeOptions?.paid_upgrade?.url || "")}
                                disabled={isRedirecting}
                                className="flex items-center gap-2 px-6 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40"
                            >
                                <span>{reenrollmentPolicy.upgradeOptions.paid_upgrade.text}</span>
                                <ArrowSquareOut className="w-4 h-4 ms-2" />
                            </MyButton>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    // Render paid member blocked message
    const renderPaidMemberBlocked = () => (
        <>
            <DialogHeader className="space-y-4 pb-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-info-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Warning className="w-8 h-8 text-white" />
                </div>
                <div className="text-center space-y-2">
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-gray-800">
                        {t("enrollmentPolicy.activeMembershipTitle")}
                    </DialogTitle>
                    <DialogDescription className="text-gray-600 text-sm sm:text-base leading-relaxed">
                        {onEnrollment?.blockMessage ||
                            t("enrollmentPolicy.activeMembershipMessage", { session })}
                    </DialogDescription>
                </div>
            </DialogHeader>

            {!shouldHidePaidPurchaseUI() && reenrollmentPolicy?.upgradeOptions?.paid_upgrade && (
                <div className="py-4">
                    <div className="rounded-xl bg-gradient-to-br from-primary-50 to-info-50 border border-primary-200 p-5">
                        <div className="flex flex-col items-center text-center space-y-3">
                            <Sparkle className="w-6 h-6 text-primary-600" />
                            <h4 className="font-semibold text-gray-900">{t("enrollmentPolicy.upgradeToContinueLearning")}</h4>
                            <p className="text-sm text-gray-600">
                                {t("enrollmentPolicy.clickBelowToJoin")}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={() => handleUpgradeClick(reenrollmentPolicy.upgradeOptions?.paid_upgrade?.url || "")}
                                disabled={isRedirecting}
                                className="flex items-center gap-2 px-6 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40"
                            >
                                <span>{reenrollmentPolicy.upgradeOptions.paid_upgrade.text}</span>
                                <ArrowSquareOut className="w-4 h-4 ms-2" />
                            </MyButton>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    // Render content based on dialog type
    const renderContent = () => {
        switch (dialogType) {
            case "success_with_actions":
                return renderSuccessWithActions();
            case "already_enrolled":
                return renderAlreadyEnrolled();
            case "reenrollment_blocked":
                return renderReenrollmentBlocked();
            case "paid_member_blocked":
                return renderPaidMemberBlocked();
            default:
                return null;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md md:max-w-lg p-6 rounded-2xl border-0 shadow-2xl bg-white">
                {renderContent()}
            </DialogContent>
        </Dialog>
    );
};

export default EnrollmentPolicyDialog;
