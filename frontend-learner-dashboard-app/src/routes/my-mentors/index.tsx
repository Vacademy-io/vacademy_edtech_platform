import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MagnifyingGlass, Star, UserPlus, UsersThree } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { reportApiError } from "@/lib/report-api-error";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { MyButton } from "@/components/design-system/button";
import { MyInput } from "@/components/design-system/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import { getInstituteId } from "@/constants/helper";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import {
    cancelMentorRequest,
    handleGetMentorDirectory,
    handleGetMyMentorRequests,
    handleGetMyMentorSessions,
    handleGetMyMentors,
    handleGetPendingFeedback,
    type DirectoryMentor,
    type MyMentor,
    type MyMentorRequest,
    type PendingFeedback,
} from "./-services/my-mentors-service";
import { filterDirectory, isWithdrawable, requestStatusLabel } from "./-utils/directory";
import { nextSessionToRate } from "./-utils/feedback";
import { RateSessionDialog } from "./-components/RateSessionDialog";
import { MentorCard } from "./-components/MentorCard";
import { DirectoryMentorCard } from "./-components/DirectoryMentorCard";
import { RequestMentorDialog } from "./-components/RequestMentorDialog";
import { MentorAvatar } from "./-components/MentorAvatar";
import { MySessionsTab } from "./-components/MySessionsTab";

export const Route = createFileRoute("/my-mentors/")({
    component: MyMentorsRoute,
});

function MyMentorsRoute() {
    return (
        <LayoutContainer>
            <MyMentorsPage />
        </LayoutContainer>
    );
}

type TabKey = "mine" | "sessions" | "find" | "requests";

function MyMentorsPage() {
    const { t } = useTranslation("miscRoutesA");
    const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
    const [instituteId, setInstituteId] = useState<string | undefined>();
    const [tab, setTab] = useState<TabKey>("mine");
    const [search, setSearch] = useState("");
    const [requestTarget, setRequestTarget] = useState<DirectoryMentor | null>(null);
    const [requestOpen, setRequestOpen] = useState(false);
    const [rateSession, setRateSession] = useState<PendingFeedback | null>(null);

    useEffect(() => {
        getInstituteId().then((id) => setInstituteId(id ?? undefined));
    }, []);

    const mentorsQuery = useQuery(handleGetMyMentors(instituteId));
    const directoryQuery = useQuery(handleGetMentorDirectory(instituteId));
    const requestsQuery = useQuery(handleGetMyMentorRequests(instituteId));
    const feedbackQuery = useQuery(handleGetPendingFeedback(instituteId));
    const sessionsQuery = useQuery(handleGetMyMentorSessions(instituteId));

    const mentors = useMemo(() => mentorsQuery.data ?? [], [mentorsQuery.data]);
    const directory = useMemo(() => directoryQuery.data ?? [], [directoryQuery.data]);
    const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);
    const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
    const upcomingCount = sessions.filter((s) => s.lifecycle === "UPCOMING").length;
    const pendingCount = requests.filter((r) => r.status === "PENDING").length;
    // The directory only exists once an admin lists at least one mentor, so the
    // whole Find-a-mentor surface stays hidden for institutes that don't use it.
    const directoryAvailable = directory.length > 0;
    // Only ever prompt for one session at a time — the most recent unrated one.
    const sessionToRate = nextSessionToRate(feedbackQuery.data ?? []);

    // A learner with no mentor yet lands on Find a mentor — the empty "My mentors"
    // list is a dead end otherwise.
    useEffect(() => {
        if (!mentorsQuery.isSuccess || !directoryQuery.isSuccess) return;
        if (mentors.length === 0 && directoryAvailable) setTab("find");
    }, [mentorsQuery.isSuccess, directoryQuery.isSuccess, mentors.length, directoryAvailable]);

    const query = search.trim();
    const filteredDirectory = filterDirectory(directory, query);

    const openRequest = (mentor: DirectoryMentor | null) => {
        setRequestTarget(mentor);
        setRequestOpen(true);
    };

    const tabs: { key: TabKey; label: string; badge?: number }[] = [
        { key: "mine", label: t("myMentors.tabs.mine"), badge: mentors.length || undefined },
        // Always offered, even at zero: "where are my sessions?" is the question this
        // tab answers, and hiding it when empty is what sent learners hunting through
        // their inbox for the booking confirmation.
        { key: "sessions", label: t("myMentors.tabs.sessions"), badge: upcomingCount || undefined },
        ...(directoryAvailable ? [{ key: "find" as const, label: t("myMentors.tabs.find") }] : []),
        ...(directoryAvailable || requests.length
            ? [
                  {
                      key: "requests" as const,
                      label: t("myMentors.tabs.requests"),
                      badge: pendingCount || undefined,
                  },
              ]
            : []),
    ];

    return (
        <div className="flex flex-col gap-section p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col">
                    <h1 className="text-h3 font-semibold text-neutral-700">{t("myMentors.page.title")}</h1>
                    <p className="text-body text-neutral-500">{t("myMentors.page.subtitle")}</p>
                </div>
                {directoryAvailable && tab !== "find" && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setTab("find")}
                    >
                        <UserPlus size={16} /> {t("myMentors.page.findMentor")}
                    </MyButton>
                )}
            </div>

            {tabs.length > 1 && (
                <div className="flex flex-wrap gap-1 border-b border-neutral-200">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`-mb-px border-b-2 px-3 py-2 text-body transition-colors ${
                                tab === t.key
                                    ? "border-primary-500 font-medium text-primary-600"
                                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                            }`}
                        >
                            {t.label}
                            {t.badge ? (
                                <span className="ms-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption text-neutral-500">
                                    {t.badge}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
            )}

            {sessionToRate && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-200 bg-warning-50 p-4">
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-100">
                            <Star size={18} weight="fill" className="text-warning-600" />
                        </span>
                        <div className="flex flex-col">
                            <span className="text-body font-medium text-neutral-700">
                                {t("myMentors.rateBanner.question", {
                                    mentor: sessionToRate.mentor_name || t("myMentors.common.yourMentor"),
                                })}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t("myMentors.rateBanner.helper")}
                            </span>
                        </div>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setRateSession(sessionToRate)}
                    >
                        {t("myMentors.rateBanner.cta")}
                    </MyButton>
                </div>
            )}

            {tab === "mine" && (
                <MyMentorsTab
                    instituteId={instituteId}
                    mentors={mentors}
                    isLoading={mentorsQuery.isLoading}
                    isError={mentorsQuery.isError}
                    onRetry={() => mentorsQuery.refetch()}
                    canFind={directoryAvailable}
                    onFind={() => setTab("find")}
                />
            )}

            {tab === "sessions" && (
                <MySessionsTab
                    instituteId={instituteId}
                    sessions={sessions}
                    mentors={mentors}
                    isLoading={sessionsQuery.isLoading}
                    isError={sessionsQuery.isError}
                    onRetry={() => sessionsQuery.refetch()}
                    onFindMentor={() => setTab(directoryAvailable ? "find" : "mine")}
                />
            )}

            {tab === "find" && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="relative w-full sm:w-80">
                            <MagnifyingGlass
                                size={16}
                                className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                            />
                            <MyInput
                                input={search}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setSearch(e.target.value)
                                }
                                inputType="text"
                                inputPlaceholder={t("myMentors.find.searchPlaceholder")}
                                className="w-full ps-9"
                            />
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => openRequest(null)}
                            title={t("myMentors.find.askAnyTitle", { admin })}
                        >
                            {t("myMentors.find.askAnyCta")}
                        </MyButton>
                    </div>

                    {directoryQuery.isLoading ? (
                        <LoadingState variant="list" count={3} />
                    ) : directoryQuery.isError ? (
                        <ErrorState
                            message={t("myMentors.find.loadError")}
                            onRetry={() => directoryQuery.refetch()}
                        />
                    ) : filteredDirectory.length === 0 ? (
                        <EmptyState
                            icon={MagnifyingGlass}
                            title={
                                query
                                    ? t("myMentors.find.empty.searchTitle")
                                    : t("myMentors.find.empty.noneTitle")
                            }
                            description={
                                query
                                    ? t("myMentors.find.empty.searchDescription", { admin })
                                    : t("myMentors.find.empty.noneDescription")
                            }
                            action={
                                query
                                    ? {
                                          label: t("myMentors.find.empty.clearSearch"),
                                          onClick: () => setSearch(""),
                                      }
                                    : undefined
                            }
                        />
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {filteredDirectory.map((m) => (
                                <DirectoryMentorCard
                                    key={m.id}
                                    mentor={m}
                                    onRequest={() => openRequest(m)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tab === "requests" && (
                <MyRequestsTab
                    instituteId={instituteId}
                    requests={requests}
                    isLoading={requestsQuery.isLoading}
                    isError={requestsQuery.isError}
                    onRetry={() => requestsQuery.refetch()}
                    onBrowse={() => setTab("find")}
                />
            )}

            <RateSessionDialog
                session={rateSession}
                instituteId={instituteId}
                open={!!rateSession}
                onOpenChange={(open) => {
                    if (!open) setRateSession(null);
                }}
            />

            <RequestMentorDialog
                mentor={requestTarget}
                instituteId={instituteId}
                open={requestOpen}
                onOpenChange={(open) => {
                    setRequestOpen(open);
                    if (!open) setRequestTarget(null);
                }}
            />
        </div>
    );
}

function MyMentorsTab({
    instituteId,
    mentors,
    isLoading,
    isError,
    onRetry,
    canFind,
    onFind,
}: {
    instituteId: string | undefined;
    mentors: MyMentor[];
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    canFind: boolean;
    onFind: () => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    if (isLoading || !instituteId) return <LoadingState variant="list" count={3} />;
    if (isError) {
        return <ErrorState message={t("myMentors.mine.loadError")} onRetry={onRetry} />;
    }
    if (mentors.length === 0) {
        return (
            <EmptyState
                icon={UsersThree}
                title={t("myMentors.mine.empty.title")}
                description={
                    canFind
                        ? t("myMentors.mine.empty.descriptionCanFind")
                        : t("myMentors.mine.empty.descriptionNoFind")
                }
                action={canFind ? { label: t("myMentors.page.findMentor"), onClick: onFind } : undefined}
            />
        );
    }
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mentors.map((m) => (
                <MentorCard key={m.id} mentor={m} instituteId={instituteId} />
            ))}
        </div>
    );
}

function fmtDate(v?: number | null): string {
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function MyRequestsTab({
    instituteId,
    requests,
    isLoading,
    isError,
    onRetry,
    onBrowse,
}: {
    instituteId: string | undefined;
    requests: MyMentorRequest[];
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    onBrowse: () => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const queryClient = useQueryClient();
    const cancel = useMutation({
        mutationFn: (requestId: string) =>
            cancelMentorRequest({ instituteId: instituteId ?? "", requestId }),
        onSuccess: () => {
            toast.success(t("myMentors.requests.toast.withdrawn"));
            queryClient.invalidateQueries({ queryKey: ["GET_MY_MENTOR_REQUESTS"] });
            queryClient.invalidateQueries({ queryKey: ["GET_MENTOR_DIRECTORY"] });
        },
        onError: (error: unknown) =>
            reportApiError(error, {
                feature: "mentorship",
                tags: { "mentorship.action": "withdraw-request" },
                fallbackMessage: t("myMentors.requests.toast.withdrawFailed"),
            }),
    });

    if (isLoading) return <LoadingState variant="list" count={2} />;
    if (isError)
        return <ErrorState message={t("myMentors.requests.loadError")} onRetry={onRetry} />;
    if (requests.length === 0) {
        return (
            <EmptyState
                icon={UserPlus}
                title={t("myMentors.requests.empty.title")}
                description={t("myMentors.requests.empty.description")}
                action={{ label: t("myMentors.page.findMentor"), onClick: onBrowse }}
            />
        );
    }

    return (
        <div className="flex flex-col gap-stack">
            {requests.map((r) => (
                <div
                    key={r.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4"
                >
                    <div className="flex min-w-0 items-start gap-3">
                        <MentorAvatar
                            fileId={r.mentor_profile_image_file_id}
                            name={r.mentor_name}
                            className="size-10 text-body"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-body font-medium text-neutral-700">
                                {r.mentor_name || t("myMentors.common.anyAvailableMentor")}
                            </span>
                            {r.message && (
                                <span className="text-caption text-neutral-500">{r.message}</span>
                            )}
                            <span className="text-caption text-neutral-400">
                                {t("myMentors.requests.requestedOn", { date: fmtDate(r.created_at) })}
                            </span>
                            {r.status === "DECLINED" && r.decision_note && (
                                <span className="mt-1 rounded-md bg-neutral-50 p-2 text-caption text-neutral-600">
                                    {r.decision_note}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <RequestStatusBadge status={r.status} />
                        {isWithdrawable(r) && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => cancel.mutate(r.id)}
                                disable={cancel.isPending}
                            >
                                {t("myMentors.requests.withdraw")}
                            </MyButton>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function RequestStatusBadge({ status }: { status: string }) {
    const { t } = useTranslation("miscRoutesA");
    const tones: Record<string, string> = {
        PENDING: "bg-warning-50 text-warning-600",
        APPROVED: "bg-success-50 text-success-600",
        DECLINED: "bg-danger-50 text-danger-600",
        CANCELLED: "bg-neutral-100 text-neutral-500",
    };
    const labels: Record<string, string> = {
        PENDING: t("myMentors.requests.status.pending"),
        APPROVED: t("myMentors.requests.status.approved"),
        DECLINED: t("myMentors.requests.status.declined"),
        CANCELLED: t("myMentors.requests.status.cancelled"),
    };
    const tone = tones[status] ?? "bg-neutral-100 text-neutral-500";
    return (
        <span className={`rounded-full px-2.5 py-1 text-caption ${tone}`}>
            {labels[status] ?? requestStatusLabel(status)}
        </span>
    );
}
