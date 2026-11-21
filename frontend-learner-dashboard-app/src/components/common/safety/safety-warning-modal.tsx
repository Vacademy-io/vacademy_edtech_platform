import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SafetyWarningModalProps {
    open: boolean;
    onAccept: () => void;
    onReject?: () => void;
}

export function SafetyWarningModal({ open, onAccept, onReject }: SafetyWarningModalProps) {
    const { t } = useTranslation("layoutCommonB");
    const [parentalAnswer, setParentalAnswer] = useState("");
    const [error, setError] = useState("");

    // Simple math challenge for "Adult Action"
    // Challenge: 12 + 7 = ?
    const validateParentalGate = () => {
        if (parentalAnswer.trim() === "19") {
            onAccept();
        } else {
            setError(t("safetyWarningModal.incorrectAnswer"));
        }
    };

    return (
        <AlertDialog open={open}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("safetyWarningModal.title")}</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-4 text-start">
                        <p className="font-semibold text-red-600">
                            {t("safetyWarningModal.readCarefully")}
                        </p>
                        <ul className="list-disc ps-5 space-y-2">
                            <li>
                                <strong>{t("safetyWarningModal.rules.beSafeOnline.title")}</strong> {t("safetyWarningModal.rules.beSafeOnline.body")}
                            </li>
                            <li>
                                <strong>{t("safetyWarningModal.rules.chatWithCaution.title")}</strong> {t("safetyWarningModal.rules.chatWithCaution.body")}
                            </li>
                            <li>
                                <strong>{t("safetyWarningModal.rules.respectOthers.title")}</strong> {t("safetyWarningModal.rules.respectOthers.body")}
                            </li>
                        </ul>
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                            <p className="mb-2 font-medium text-gray-900">{t("safetyWarningModal.adultVerification.title")}</p>
                            <p className="text-sm text-gray-500 mb-4">
                                {t("safetyWarningModal.adultVerification.body")}
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="challenge">{t("safetyWarningModal.adultVerification.challengeLabel")}</Label>
                                <Input
                                    id="challenge"
                                    value={parentalAnswer}
                                    onChange={(e) => {
                                        setParentalAnswer(e.target.value);
                                        setError("");
                                    }}
                                    placeholder={t("safetyWarningModal.adultVerification.placeholder")}
                                />
                                {error && <p className="text-red-500 text-sm">{error}</p>}
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {onReject && (
                        <AlertDialogCancel onClick={onReject}>{t("safetyWarningModal.goBack")}</AlertDialogCancel>
                    )}
                    <AlertDialogAction onClick={(e) => {
                        e.preventDefault(); // Prevent auto-close
                        validateParentalGate();
                    }}>
                        {t("safetyWarningModal.agreeAndProceed")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
