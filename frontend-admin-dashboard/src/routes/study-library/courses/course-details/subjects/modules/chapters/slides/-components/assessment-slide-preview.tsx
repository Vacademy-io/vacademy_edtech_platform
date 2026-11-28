'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    ListChecks,
    ArrowSquareOut,
    CalendarBlank,
    FileText,
    Lock,
    Trophy,
    Users,
} from '@phosphor-icons/react';

import { Slide } from '../-hooks/use-slides';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_OVERVIEW_URL,
    GET_ASSESSMENT_TOTAL_MARKS_URL,
    GET_ASSESSMENT_LISTS,
} from '@/constants/urls';
import { getInstituteId, convertToLocalDateTime } from '@/constants/helper';
import { StatusChip } from '@/components/design-system/status-chips';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { MyButton } from '@/components/design-system/button';
import AssessmentSubmissionsPanel from './assessment-submissions-panel';

interface AssessmentSlidePreviewProps {
    activeItem: Slide;
    isLearnerView?: boolean;
}

// /assessment-service/assessment/admin/get-overview wraps the overview in
// `assessment_overview_dto`. We only consume the slice we need.
interface AssessmentOverviewResponse {
    assessment_overview_dto?: {
        duration_in_min?: number | null;
        start_date_and_time?: string | null;
        end_date_and_time?: string | null;
        subject_id?: string | null;
        total_participants?: number | null;
        total_attempted?: number | null;
        total_ongoing?: number | null;
    };
}

interface TotalMarksResponse {
    total_achievable_marks?: number | null;
    section_wise_achievable_marks?: Record<string, number> | null;
}

/** Sentinel "never closes" end date written when the admin sets no date range. */
const NO_EXPIRY_YEAR = 9999;

/**
 * Backend timestamps are UTC but often arrive without a zone marker; force UTC
 * so the window is judged against the right instant.
 */
const toUtcDate = (raw: string | null | undefined): Date | null => {
    if (!raw) return null;
    const hasZone = /Z$|[+-]\d{2}:?\d{2}$/i.test(raw);
    const date = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};

type WindowState = 'NOT_STARTED' | 'OPEN' | 'CLOSED';

/**
 * Where the assessment sits in its own schedule. Learners can only open this
 * slide while the window is OPEN, so the admin needs to see the same state here
 * — otherwise a slide that looks fine in the course reads as "locked" to them.
 */
const resolveWindow = (
    startRaw: string | null | undefined,
    endRaw: string | null | undefined
): { start: Date | null; end: Date | null; noExpiry: boolean; state: WindowState } => {
    const start = toUtcDate(startRaw);
    const end = toUtcDate(endRaw);
    // UTC, and ">=": the sentinel is 9999-12-31T23:59:59.999Z, so in a timezone
    // ahead of UTC the local year is 10000 and an equality check misses it —
    // making an "always available" assessment advertise a Jan 1, 10000 close.
    const noExpiry = !end || end.getUTCFullYear() >= NO_EXPIRY_YEAR;
    const now = Date.now();

    let state: WindowState = 'OPEN';
    if (start && start.getTime() > now) state = 'NOT_STARTED';
    else if (end && !noExpiry && end.getTime() <= now) state = 'CLOSED';

    return { start, end, noExpiry, state };
};

const Stat = ({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number | null | undefined;
}) => (
    <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
        <span className="text-primary-500">{icon}</span>
        <div className="flex flex-col">
            <span className="text-2xs uppercase tracking-wide text-neutral-500">{label}</span>
            <span className="text-sm font-semibold text-neutral-800">
                {value ?? '—'}
            </span>
        </div>
    </div>
);

const AssessmentSlidePreview = ({ activeItem }: AssessmentSlidePreviewProps) => {
    const { t } = useTranslation('studyLibraryAssessmentSlidePreview');
    const router = useRouter();
    const assessmentSlide = activeItem.assessment_slide;
    const assessmentId = assessmentSlide?.assessment_id;
    const instituteId = getInstituteId();

    const overviewQuery = useQuery<AssessmentOverviewResponse>({
        queryKey: ['ASSESSMENT_SLIDE_OVERVIEW_ADMIN', assessmentId, instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_OVERVIEW_URL,
                params: { assessmentId, instituteId },
            });
            return response?.data;
        },
        enabled: Boolean(assessmentId && instituteId),
        staleTime: 30 * 1000,
    });

    const totalMarksQuery = useQuery<TotalMarksResponse>({
        queryKey: ['ASSESSMENT_SLIDE_TOTAL_MARKS_ADMIN', assessmentId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_ASSESSMENT_TOTAL_MARKS_URL,
                params: { assessmentId },
            });
            return response?.data;
        },
        enabled: Boolean(assessmentId),
        staleTime: 30 * 1000,
    });

    // Resolve the assessment's play_mode + visibility so the deep-links can open
    // this assessment's details page. get-overview doesn't carry these, so look
    // the assessment up by id in the assessment list (name-filtered to narrow the
    // page, then matched by assessment_id).
    const routeParamsQuery = useQuery<{
        playMode?: string | null;
        visibility?: string | null;
    } | null>({
        queryKey: ['ASSESSMENT_SLIDE_ROUTE_PARAMS_ADMIN', assessmentId, instituteId, activeItem.title],
        queryFn: async () => {
            const searchName = (activeItem.title?.replace(/^Assessment:\s*/, '') ?? '').trim();
            const response = await authenticatedAxiosInstance({
                method: 'POST',
                url: GET_ASSESSMENT_LISTS,
                params: { pageNo: 0, pageSize: 25, instituteId },
                data: {
                    name: searchName,
                    batch_ids: [],
                    subjects_ids: [],
                    tag_ids: [],
                    evaluation_types: [],
                    institute_ids: instituteId ? [instituteId] : [],
                    assessment_modes: [],
                    access_statuses: [],
                    sort_columns: {},
                    assessment_statuses: ['PUBLISHED', 'DRAFT'],
                    assessment_types: ['ASSESSMENT'],
                },
            });
            const rows: Array<{
                assessment_id: string;
                play_mode?: string | null;
                assessment_visibility?: string | null;
            }> = response?.data?.content ?? [];
            const match = rows.find((r) => r.assessment_id === assessmentId);
            return match
                ? {
                      playMode: match.play_mode,
                      visibility: match.assessment_visibility,
                  }
                : null;
        },
        enabled: Boolean(assessmentId && instituteId),
        staleTime: 60 * 1000,
    });

    // Assessment instructions live on the basic-info step — fetch once play_mode
    // is resolved so we can show what participants see before they begin.
    const detailsQuery = useQuery({
        ...getAssessmentDetails({
            assessmentId: assessmentId ?? '',
            instituteId,
            type: routeParamsQuery.data?.playMode ?? undefined,
        }),
        enabled: Boolean(assessmentId && instituteId && routeParamsQuery.data?.playMode),
    });
    const instructionsHtml: string =
        detailsQuery.data?.[0]?.saved_data?.instructions?.content || '';

    const overview = overviewQuery.data?.assessment_overview_dto;
    const totalMarks = totalMarksQuery.data;
    const isLoading = overviewQuery.isLoading || totalMarksQuery.isLoading;
    const isError = overviewQuery.isError && totalMarksQuery.isError;

    // Slide title is set as "Assessment: <name>" at link time. Strip the
    // prefix so the preview shows the bare assessment name.
    const displayName = activeItem.title?.replace(/^Assessment:\s*/, '') || activeItem.title;

    if (!assessmentId) {
        return (
            <div className="flex h-96 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50">
                <ListChecks className="size-8 text-neutral-400" />
                <p className="mt-3 text-sm text-neutral-500">
                    {t('noAssessmentLinked')}
                </p>
            </div>
        );
    }

    // Deep-link into this assessment's details page. play_mode/visibility come from
    // the resolver; if unresolved (e.g. a renamed assessment off the filtered page),
    // fall back to the generic list so the action never dead-ends.
    const goToAssessmentDetails = (tab: 'overview' | 'submissions') => {
        const routeParams = routeParamsQuery.data;
        if (routeParams?.playMode) {
            router.navigate({
                to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
                params: {
                    assessmentId,
                    examType: routeParams.playMode,
                    assesssmentType: routeParams.visibility ?? 'PRIVATE',
                    assessmentTab: tab,
                },
            });
        } else {
            router.navigate({ to: '/assessment/assessment-list' });
        }
    };

    // Submission counts come for free from the overview we already fetch. The
    // precise evaluated/pending breakdown lives in the submissions tab (one click).
    const submittedCount = overview?.total_attempted ?? 0;
    const participantCount = overview?.total_participants ?? 0;

    // The schedule chosen when this assessment was created from the slide. It is
    // what decides whether learners can open the slide at all.
    const availability = resolveWindow(
        overview?.start_date_and_time,
        overview?.end_date_and_time
    );
    const availabilityChip: { text: string; status: 'SUCCESS' | 'WARNING' | 'INFO' } =
        availability.state === 'NOT_STARTED'
            ? { text: t('status.scheduled'), status: 'WARNING' }
            : availability.state === 'CLOSED'
              ? { text: t('status.closed'), status: 'INFO' }
              : { text: t('status.open'), status: 'SUCCESS' };

    const availabilityLabel = (() => {
        const opens = availability.start
            ? convertToLocalDateTime(availability.start.toISOString())
            : null;
        const closes =
            availability.end && !availability.noExpiry
                ? convertToLocalDateTime(availability.end.toISOString())
                : null;
        if (opens && closes) return t('availability.range', { opens, closes });
        if (opens) return t('availability.from', { opens });
        if (closes) return t('availability.until', { closes });
        return t('availability.anytime');
    })();

    return (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="rounded-md bg-rose-50 p-2 text-rose-500">
                        <ListChecks className="size-5" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-2xs uppercase tracking-wide text-neutral-500">
                            {t('linkedAssessment')}
                        </span>
                        <h3 className="text-base font-semibold text-neutral-900">
                            {isLoading && !displayName ? t('loadingEllipsis') : displayName}
                        </h3>
                        {/* Only once the overview actually resolved — a failed
                            fetch must not read as a confident "Open". */}
                        {!isLoading && overview && (
                            <div className="mt-1.5">
                                <StatusChip
                                    text={availabilityChip.text}
                                    textSize="text-xs"
                                    status={availabilityChip.status}
                                    showIcon={false}
                                />
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => goToAssessmentDetails('submissions')}
                    >
                        <span className="inline-flex items-center gap-1 text-xs">
                            {t('viewSubmissions')}
                            <ArrowSquareOut className="size-3.5" />
                        </span>
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => goToAssessmentDetails('overview')}
                    >
                        <span className="inline-flex items-center gap-1 text-xs">
                            {t('manageInAssessments')}
                            <ArrowSquareOut className="size-3.5" />
                        </span>
                    </MyButton>
                </div>
            </div>

            {isError && (
                <p className="text-xs text-red-500">
                    {t('couldNotLoadDetails')}
                </p>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Stat
                    icon={<Trophy className="size-4" />}
                    label={t('totalMarks')}
                    value={
                        typeof totalMarks?.total_achievable_marks === 'number'
                            ? totalMarks.total_achievable_marks
                            : null
                    }
                />
                <Stat
                    icon={<CalendarBlank className="size-4" />}
                    label={t('availableToLearners')}
                    value={availabilityLabel}
                />
            </div>

            {/* Outside its window the slide is locked for learners — say so here
                so an admin doesn't read an empty submissions list as a bug. */}
            {availability.state !== 'OPEN' && (
                <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                    <Lock className="mt-0.5 size-4 shrink-0 text-warning-600" weight="fill" />
                    <p className="text-xs text-warning-700">
                        {availability.state === 'NOT_STARTED'
                            ? t('lockedUntil', {
                                  date: availability.start
                                      ? convertToLocalDateTime(availability.start.toISOString())
                                      : t('itOpens'),
                              })
                            : availability.end
                              ? t('closedOnDate', {
                                    date: convertToLocalDateTime(availability.end.toISOString()),
                                })
                              : t('closedNoDate')}
                    </p>
                </div>
            )}

            {/* Assessment instructions — what participants see before they begin. */}
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-2">
                    <FileText className="size-4 text-primary-500" />
                    <span className="text-2xs uppercase tracking-wide text-neutral-500">
                        {t('instructions')}
                    </span>
                </div>
                {detailsQuery.isLoading ? (
                    <p className="text-sm text-neutral-400">{t('loadingInstructions')}</p>
                ) : instructionsHtml ? (
                    <div
                        dangerouslySetInnerHTML={{ __html: instructionsHtml }}
                        className="custom-html-content prose prose-sm max-w-none text-sm text-neutral-700"
                    />
                ) : (
                    <p className="text-sm text-neutral-500">{t('noInstructionsProvided')}</p>
                )}
            </div>

            {/* Submissions at-a-glance — full evaluated/pending breakdown is in the
                submissions tab via "View Submissions". */}
            <div className="flex items-center gap-3 rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                <Users className="size-4 text-primary-500" />
                <span>
                    <span className="font-semibold text-neutral-800">{submittedCount}</span>{' '}
                    {t('submitted')}
                </span>
                <span className="text-neutral-400">·</span>
                <span>
                    <span className="font-semibold text-neutral-800">{participantCount}</span>{' '}
                    {t('enrolled')}
                </span>
            </div>

            {/* Per-student submissions with status + a deep-link into the PDF
                evaluator (view answer + give marks/remarks). */}
            <AssessmentSubmissionsPanel
                assessmentId={assessmentId}
                instituteId={instituteId}
                playMode={routeParamsQuery.data?.playMode}
                visibility={routeParamsQuery.data?.visibility}
            />
        </div>
    );
};

export default AssessmentSlidePreview;
