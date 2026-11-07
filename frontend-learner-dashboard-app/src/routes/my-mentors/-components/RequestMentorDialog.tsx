import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { reportApiError } from "@/lib/report-api-error";
import { MyButton } from "@/components/design-system/button";
import { MyDialog } from "@/components/design-system/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import {
    requestMentor,
    type DirectoryMentor,
} from "../-services/my-mentors-service";
import { MentorAvatar } from "./MentorAvatar";

const MAX_MESSAGE = 500;

/**
 * Asks for a mentor. The note is optional but strongly encouraged — it is the
 * only context the admin approving the request has to go on, and it is what
 * turns "someone wants a mentor" into a decision they can actually make.
 */
export function RequestMentorDialog({
    mentor,
    instituteId,
    open,
    onOpenChange,
}: {
    /** null means an open-ended "any available mentor" request. */
    mentor: DirectoryMentor | null;
    instituteId: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
    const [message, setMessage] = useState("");
    const queryClient = useQueryClient();

    useEffect(() => {
        if (open) setMessage("");
    }, [open, mentor]);

    const submit = useMutation({
        mutationFn: () =>
            requestMentor({
                instituteId: instituteId ?? "",
                mentorId: mentor?.id,
                message: message.trim() || undefined,
            }),
        onSuccess: () => {
            toast.success(t("myMentors.requestDialog.toast.sent", { admin }));
            queryClient.invalidateQueries({ queryKey: ["GET_MENTOR_DIRECTORY"] });
            queryClient.invalidateQueries({ queryKey: ["GET_MY_MENTOR_REQUESTS"] });
            onOpenChange(false);
        },
        onError: (error: unknown) =>
            // The server explains refusals precisely (already requested, mentor full,
            // already your mentor) — showing that beats a generic failure message.
            // Those are expected 4xx, so they breadcrumb rather than burn Sentry quota.
            reportApiError(error, {
                feature: "mentorship",
                tags: { "mentorship.action": "request-mentor" },
                extra: { mentorId: mentor?.id ?? "any" },
                fallbackMessage: t("myMentors.requestDialog.toast.sendFailed"),
            }),
    });

    return (
        <MyDialog
            heading={
                mentor
                    ? t("myMentors.requestDialog.headingNamed", {
                          mentor: mentor.name || t("myMentors.common.thisMentor"),
                      })
                    : t("myMentors.requestDialog.headingAny")
            }
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t("myMentors.common.cancel")}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => submit.mutate()}
                        disable={submit.isPending || !instituteId}
                    >
                        {submit.isPending
                            ? t("myMentors.requestDialog.sending")
                            : t("myMentors.requestDialog.sendRequest")}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-1">
                {mentor ? (
                    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3">
                        <MentorAvatar
                            fileId={mentor.profile_image_file_id}
                            name={mentor.name}
                            className="size-10 text-body"
                        />
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-body font-medium text-neutral-700">
                                {mentor.name || t("myMentors.common.mentor")}
                            </span>
                            {mentor.title && (
                                <span className="truncate text-caption text-neutral-500">
                                    {mentor.title}
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-body text-neutral-600">
                        {t("myMentors.requestDialog.anyMentorHelp", { admin })}
                    </p>
                )}

                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="mentor-request-message"
                        className="text-caption font-medium text-neutral-600"
                    >
                        {t("myMentors.requestDialog.messageLabel")}
                    </label>
                    <Textarea
                        id="mentor-request-message"
                        value={message}
                        maxLength={MAX_MESSAGE}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t("myMentors.requestDialog.messagePlaceholder")}
                        className="min-h-24 resize-none"
                    />
                    <span className="flex items-center justify-between text-caption text-neutral-400">
                        <span>{t("myMentors.requestDialog.messageHelper", { admin })}</span>
                        <span>
                            {message.length}/{MAX_MESSAGE}
                        </span>
                    </span>
                </div>
            </div>
        </MyDialog>
    );
}
