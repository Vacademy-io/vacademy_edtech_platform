import { CalendarPlus, CheckCircle, Clock, UserPlus } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { ModernCard, ModernCardContent } from "@/components/design-system/modern-card";
import type { DirectoryMentor } from "../-services/my-mentors-service";
import { mentorCta } from "../-utils/directory";
import { MentorAvatar } from "./MentorAvatar";

/**
 * One mentor in the Find-a-mentor directory. The card's action reflects the
 * learner's actual state with this mentor — already paired, request pending, or
 * requestable — so the same list serves every case without a second screen.
 */
export function DirectoryMentorCard({
    mentor,
    onRequest,
}: {
    mentor: DirectoryMentor;
    onRequest: () => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const cta = mentorCta(mentor);
    const pending = cta === "REQUEST_PENDING";
    const alreadyMentor = cta === "ALREADY_MENTOR";
    const full = cta === "FULL";

    return (
        <ModernCard variant="default" padding="md" rounded="lg">
            <ModernCardContent>
                <div className="flex h-full flex-col gap-4">
                    <div className="flex items-start gap-3">
                        <MentorAvatar
                            fileId={mentor.profile_image_file_id}
                            name={mentor.name}
                            className="size-12 text-title"
                        />
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-body font-semibold text-neutral-700">
                                {mentor.name || t("myMentors.common.mentor")}
                            </span>
                            {mentor.title && (
                                <span className="truncate text-caption text-neutral-500">
                                    {mentor.title}
                                </span>
                            )}
                            {typeof mentor.available_slots === "number" && !alreadyMentor && (
                                <span
                                    className={`mt-0.5 text-caption ${
                                        full ? "text-danger-600" : "text-neutral-400"
                                    }`}
                                >
                                    {full
                                        ? t("myMentors.directoryCard.fullyBookedNow")
                                        : t("myMentors.directoryCard.placesLeft", {
                                              count: mentor.available_slots,
                                          })}
                                </span>
                            )}
                        </div>
                    </div>

                    {(mentor.expertise_tags?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {mentor.expertise_tags?.slice(0, 4).map((tag) => (
                                <span
                                    key={tag}
                                    className="rounded-full bg-primary-50 px-2.5 py-1 text-caption text-primary-600"
                                >
                                    {tag}
                                </span>
                            ))}
                            {(mentor.expertise_tags?.length ?? 0) > 4 && (
                                <span
                                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-caption text-neutral-500"
                                    title={mentor.expertise_tags?.slice(4).join(", ")}
                                >
                                    +{(mentor.expertise_tags?.length ?? 0) - 4}
                                </span>
                            )}
                        </div>
                    )}

                    {mentor.bio && (
                        <p className="line-clamp-3 text-caption text-neutral-500">{mentor.bio}</p>
                    )}

                    <div className="mt-auto">
                        {alreadyMentor ? (
                            <span className="flex items-center gap-1.5 rounded-md bg-success-50 px-3 py-2 text-caption text-success-600">
                                <CheckCircle size={16} weight="fill" />{" "}
                                {t("myMentors.directoryCard.alreadyYourMentor")}
                            </span>
                        ) : pending ? (
                            <span className="flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 py-2 text-caption text-neutral-600">
                                <Clock size={16} /> {t("myMentors.directoryCard.requestPending")}
                            </span>
                        ) : (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                onClick={onRequest}
                                disable={full}
                                className="w-full"
                            >
                                {full ? (
                                    <>
                                        <CalendarPlus size={16} />{" "}
                                        {t("myMentors.directoryCard.fullyBooked")}
                                    </>
                                ) : (
                                    <>
                                        <UserPlus size={16} />{" "}
                                        {t("myMentors.directoryCard.requestAsMentor")}
                                    </>
                                )}
                            </MyButton>
                        )}
                    </div>
                </div>
            </ModernCardContent>
        </ModernCard>
    );
}
