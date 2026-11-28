import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MyButton } from "@/components/design-system/button";
import { MyInput } from "@/components/design-system/input";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { formatVideoTime } from "@/utils/study-library/tracking/formatVideoTime";
import { useTranslation } from "react-i18next";
import { CrosshairSimple } from "@phosphor-icons/react";

interface TimestampDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Returns the raw position: milliseconds for video, 0-based page for documents. */
    onTimestampSet: (timestamp: number) => void;
    initialTimestamp?: number;
}

/**
 * Optional position picker for a new doubt. It is no longer a gate before the
 * composer — the composer opens pre-filled with the learner's current position
 * and this only opens when they tap "Change" on the chip.
 */
export const TimestampDialog = ({
    open,
    onOpenChange,
    onTimestampSet,
    initialTimestamp,
}: TimestampDialogProps) => {
    const { t } = useTranslation("studyContent");
    const { activeItem } = useContentStore();
    const {
        currentYoutubeVideoLength,
        currentPdfLength,
        currentCustomVideoLength,
        currentPdfPage,
        currentYoutubeTime,
        currentUploadedVideoTime,
    } = useMediaRefsStore();

    const [hours, setHours] = useState("");
    const [minutes, setMinutes] = useState("");
    const [seconds, setSeconds] = useState("");
    const [pageNumber, setPageNumber] = useState("");
    const [validationError, setValidationError] = useState("");

    const isVideo = activeItem?.source_type === "VIDEO";
    const isDocument = activeItem?.source_type === "DOCUMENT";

    const mediaLength = isDocument
        ? currentPdfLength
        : activeItem?.video_slide?.source_type === "FILE_ID"
          ? currentCustomVideoLength
          : currentYoutubeVideoLength;

    const applyVideoSeconds = (totalSeconds: number) => {
        setHours(String(Math.floor(totalSeconds / 3600)));
        setMinutes(String(Math.floor((totalSeconds % 3600) / 60)));
        setSeconds(String(totalSeconds % 60));
    };

    // Initialize values when dialog opens or initialTimestamp changes
    useEffect(() => {
        if (!open) return;

        if (initialTimestamp !== undefined) {
            if (isDocument) {
                // Display page number + 1 for user-friendly 1-based indexing
                setPageNumber(String(initialTimestamp + 1));
            } else if (isVideo) {
                applyVideoSeconds(Math.floor(initialTimestamp / 1000));
            }
        } else {
            setHours("");
            setMinutes("");
            setSeconds("");
            setPageNumber("");
        }
        setValidationError("");
    }, [open, initialTimestamp, isDocument, isVideo]);

    const useCurrentPosition = () => {
        if (isDocument) {
            setPageNumber(String(currentPdfPage + 1));
        } else if (isVideo) {
            const currentTime =
                activeItem?.video_slide?.source_type === "FILE_ID"
                    ? currentUploadedVideoTime
                    : currentYoutubeTime;
            applyVideoSeconds(Math.floor(currentTime || 0));
        }
        setValidationError("");
    };

    const validateInput = () => {
        if (isDocument) {
            const pageNum = parseInt(pageNumber, 10) || 0;
            if (mediaLength > 0 && (pageNum > mediaLength || pageNum < 1)) {
                setValidationError(t("doubts.errorPageRange", { max: mediaLength }));
                return false;
            }
        } else if (isVideo) {
            const totalSeconds =
                (parseInt(hours, 10) || 0) * 3600 +
                (parseInt(minutes, 10) || 0) * 60 +
                (parseInt(seconds, 10) || 0);

            if (mediaLength > 0 && totalSeconds > mediaLength) {
                setValidationError(
                    t("doubts.errorTimeRange", { max: formatVideoTime(mediaLength) })
                );
                return false;
            }
        }
        setValidationError("");
        return true;
    };

    const handleNumericInput = (
        e: React.ChangeEvent<HTMLInputElement>,
        setter: React.Dispatch<React.SetStateAction<string>>,
        max?: number
    ) => {
        const value = e.target.value;
        if (value === "" || (/^\d+$/.test(value) && (!max || parseInt(value, 10) <= max))) {
            setter(value);
            setValidationError("");
        }
    };

    const handleSubmit = () => {
        if (!validateInput()) return;

        if (isDocument) {
            // Send 0-indexed page number but display 1-indexed
            onTimestampSet((parseInt(pageNumber, 10) || 1) - 1);
        } else if (isVideo) {
            const totalSeconds =
                (parseInt(hours, 10) || 0) * 3600 +
                (parseInt(minutes, 10) || 0) * 60 +
                (parseInt(seconds, 10) || 0);
            onTimestampSet(totalSeconds * 1000);
        }
        onOpenChange(false);
    };

    const isValidInput = () => {
        if (validationError) return false;
        if (isDocument) return pageNumber !== "" && parseInt(pageNumber, 10) >= 1;
        if (isVideo) return hours !== "" || minutes !== "" || seconds !== "";
        return false;
    };

    const timeInputs: Array<{
        key: string;
        value: string;
        setter: React.Dispatch<React.SetStateAction<string>>;
        max?: number;
        label: string;
    }> = [
        { key: "h", value: hours, setter: setHours, max: 23, label: t("doubts.hours") },
        { key: "m", value: minutes, setter: setMinutes, max: 59, label: t("doubts.minutes") },
        { key: "s", value: seconds, setter: setSeconds, max: 59, label: t("doubts.seconds") },
    ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-pct-95 max-w-reg-350 gap-0 rounded-xl p-0">
                <DialogHeader className="border-b border-neutral-200 px-4 py-3 pe-10 text-start">
                    <DialogTitle className="text-subtitle font-semibold text-neutral-900">
                        {isDocument ? t("doubts.setPageTitle") : t("doubts.setTimestampTitle")}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-stack p-4">
                    {isDocument ? (
                        <MyInput
                            inputType="text"
                            inputPlaceholder={t("doubts.pagePlaceholder")}
                            input={pageNumber}
                            onChangeFunction={(e) => handleNumericInput(e, setPageNumber)}
                            onBlur={validateInput}
                            size="medium"
                            inputMode="numeric"
                        />
                    ) : (
                        <div className="flex items-center gap-1.5">
                            {timeInputs.map((field, index) => (
                                <div key={field.key} className="flex items-center gap-1.5">
                                    {index > 0 && <span className="text-neutral-400">:</span>}
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder="00"
                                        input={field.value}
                                        onChangeFunction={(e) =>
                                            handleNumericInput(e, field.setter, field.max)
                                        }
                                        onBlur={validateInput}
                                        size="medium"
                                        inputMode="numeric"
                                        aria-label={field.label}
                                        className="w-14 text-center tabular-nums"
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={useCurrentPosition}
                        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary-50 px-2 py-1 text-caption font-semibold text-neutral-800 transition-colors hover:bg-primary-100"
                    >
                        <CrosshairSimple size={13} className="text-primary-500" />
                        {isDocument ? t("doubts.useCurrentPage") : t("doubts.useCurrentPosition")}
                    </button>

                    {mediaLength > 0 && (
                        <p className="text-2xs text-neutral-500">
                            {isDocument
                                ? t("doubts.totalPages", { count: mediaLength })
                                : t("doubts.videoLength", { time: formatVideoTime(mediaLength) })}
                        </p>
                    )}

                    {validationError && (
                        <p className="text-caption text-danger-600">{validationError}</p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        className="min-w-0 px-4"
                    >
                        {t("doubts.cancel")}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleSubmit}
                        disable={!isValidInput()}
                        className="min-w-0 px-4"
                    >
                        {t("doubts.apply")}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
