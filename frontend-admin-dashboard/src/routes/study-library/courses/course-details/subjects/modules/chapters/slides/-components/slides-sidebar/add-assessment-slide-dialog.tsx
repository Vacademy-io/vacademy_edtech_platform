import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';

import { MyButton } from '@/components/design-system/button';
import { DialogFooter } from '@/components/ui/dialog';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_ASSESSMENT_LISTS } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getInstituteId, convertToLocalDateTime } from '@/constants/helper';
import {
    useSlidesMutations,
    type AssessmentSlidePayload,
    type Slide,
} from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    generateUniqueSlideTitle,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

interface AssessmentRow {
    assessment_id: string;
    name: string;
    status: string;
    duration?: number | null;
    play_mode?: string | null;
    evaluation_type?: string | null;
    submission_type?: string | null;
    bound_start_time?: string | null;
    bound_end_time?: string | null;
}

interface AssessmentListResponse {
    content?: AssessmentRow[];
    total_pages?: number;
    total_elements?: number;
    page_no?: number;
    page_size?: number;
}

const PAGE_SIZE = 20;

const AssessmentSlideRow = ({
    row,
    isSelected,
    onSelect,
    fallbackName,
}: {
    row: AssessmentRow;
    isSelected: boolean;
    onSelect: () => void;
    fallbackName: string;
}) => {
    const { t } = useTranslation('studyLibraryAddAssessmentSlideDialog');
    const isDraft = row.status === 'DRAFT';
    const displayName = row.name?.trim() || fallbackName;
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                isSelected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-semibold text-neutral-900">
                    {displayName}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    {row.play_mode && (
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-neutral-600">
                            {row.play_mode}
                        </span>
                    )}
                    <span
                        className={`rounded px-2 py-0.5 text-2xs font-semibold uppercase ${
                            isDraft
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                        }`}
                        title={
                            isDraft
                                ? t('tooltips.draftAssessmentTooltip')
                                : undefined
                        }
                    >
                        {row.status}
                    </span>
                </div>
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
                {typeof row.duration === 'number' && row.duration > 0 ? (
                    <span>{t('labels.durationMinutes', { count: row.duration })}</span>
                ) : null}
                {row.evaluation_type ? <span>{row.evaluation_type}</span> : null}
                {row.bound_end_time && new Date(`${row.bound_end_time.replace(" ", "T")}Z`).getFullYear() !== 9999 ? (
                    <span>
                        {t('labels.ends', { date: convertToLocalDateTime(row.bound_end_time) })}
                    </span>
                ) : null}
            </div>
        </button>
    );
};

export const AddAssessmentSlideDialog = ({
    openState,
}: {
    openState?: ((open: boolean) => void) | undefined;
}) => {
    const { t } = useTranslation('studyLibraryAddAssessmentSlideDialog');
    const router = useRouter();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        router.state.location.search;
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { items, setActiveItem } = useContentStore();

    const packageSessionId =
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || '';

    const { addUpdateAssessmentSlide, updateSlideOrder, isUpdating } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        packageSessionId
    );

    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedRow, setSelectedRow] = useState<AssessmentRow | null>(null);
    const [pageNo, setPageNo] = useState(0);

    useEffect(() => {
        const handle = setTimeout(() => {
            setDebouncedSearch(searchInput.trim());
            setPageNo(0);
        }, 300);
        return () => clearTimeout(handle);
    }, [searchInput]);

    const instituteId = getInstituteId();

    const { data, isLoading, isError } = useQuery<AssessmentListResponse>({
        queryKey: [
            'GET_ASSESSMENT_LIST_FOR_SLIDE_PICKER',
            instituteId,
            debouncedSearch,
            pageNo,
        ],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance({
                method: 'POST',
                url: GET_ASSESSMENT_LISTS,
                params: {
                    pageNo,
                    pageSize: PAGE_SIZE,
                    instituteId,
                },
                data: {
                    name: debouncedSearch,
                    // Backend dereferences these lists with .isEmpty() — send
                    // explicit empty arrays so we don't NPE on the server.
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
            return response?.data;
        },
        enabled: Boolean(instituteId),
        staleTime: 30 * 1000,
    });

    const rows = useMemo(() => data?.content ?? [], [data?.content]);
    const totalPages = data?.total_pages ?? 0;

    // Build a stable per-row fallback "Assessment N" label using the page-
    // global page offset so it doesn't reset on each re-render.
    const fallbackNameFor = (index: number) =>
        t('fallbackAssessmentName', { number: pageNo * PAGE_SIZE + index + 1 });

    // Shared: create the ASSESSMENT slide for a given assessment, append it, and
    // activate it. Used by both "link existing" and "quick create".
    const linkAssessmentAsSlide = async (assessmentId: string, assessmentName: string) => {
        const slideId = crypto.randomUUID();
        const assessmentSlideId = crypto.randomUUID();
        const title = t('assessmentSlideTitle', { name: assessmentName });

        const payload: AssessmentSlidePayload = {
            id: slideId,
            source_id: assessmentSlideId,
            source_type: 'ASSESSMENT',
            title,
            description: '',
            image_file_id: '',
            slide_order: getNextSlideOrder((items as Slide[]) || []),
            status: getSlideStatusForUser(),
            new_slide: true,
            notify: false,
            assessment_slide: {
                id: assessmentSlideId,
                assessment_id: assessmentId,
                allow_reattempt: true,
                show_result: true,
            },
        };

        const response = await addUpdateAssessmentSlide(payload);
        if (!response) throw new Error(t('errors.linkFailed'));

        // Reorder so the new slide appears at the bottom
        const currentSlides = (items as Slide[]) || [];
        const reordered = buildAppendReorderPayload(slideId, currentSlides);
        await updateSlideOrder({
            chapterId: chapterId || '',
            slideOrderPayload: reordered,
        });

        // Optimistically activate
        const newSlide: Slide = {
            id: slideId,
            source_id: assessmentSlideId,
            source_type: 'ASSESSMENT',
            title,
            image_file_id: '',
            description: '',
            status: payload.status,
            slide_order: payload.slide_order ?? 0,
            video_slide: null,
            document_slide: null,
            question_slide: null,
            assignment_slide: null,
            quiz_slide: null,
            audio_slide: null,
            scorm_slide: null,
            assessment_slide: {
                id: assessmentSlideId,
                assessment_id: assessmentId,
                allow_reattempt: true,
                show_result: true,
            },
            is_loaded: true,
            new_slide: true,
        };
        setActiveItem(newSlide);
    };

    const handleLink = async () => {
        if (!selectedRow) return;
        try {
            const selectedIndex = rows.findIndex(
                (r) => r.assessment_id === selectedRow.assessment_id
            );
            const fallback =
                selectedIndex >= 0
                    ? fallbackNameFor(selectedIndex)
                    : generateUniqueSlideTitle((items as Slide[]) || [], t('assessmentFallbackBaseName'));
            const assessmentName = selectedRow.name?.trim() || fallback;

            await linkAssessmentAsSlide(selectedRow.assessment_id, assessmentName);

            toast.success(t('toasts.linkedAsSlide'));
            openState?.(false);
        } catch (err) {
            console.error('Failed to link assessment slide', err);
            toast.error((err as Error)?.message || t('errors.linkFailed'));
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="relative">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={t('search.placeholder')}
                    className="w-full rounded-md border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
                    autoFocus
                />
            </div>

            <div className="max-h-96 min-h-52 overflow-y-auto rounded-md border border-neutral-200 p-2">
                {isLoading ? (
                    <div className="py-10 text-center text-sm text-neutral-500">
                        {t('states.loading')}
                    </div>
                ) : isError ? (
                    <div className="py-10 text-center text-sm text-red-500">
                        {t('states.loadFailed')}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-neutral-500">
                        {debouncedSearch
                            ? t('states.noSearchMatches')
                            : t('states.noAssessmentsAvailable')}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {rows.map((row, index) => (
                            <AssessmentSlideRow
                                key={row.assessment_id}
                                row={row}
                                isSelected={selectedRow?.assessment_id === row.assessment_id}
                                onSelect={() => setSelectedRow(row)}
                                fallbackName={fallbackNameFor(index)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>
                        {t('pagination.pageOf', { page: pageNo + 1, totalPages })}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={pageNo === 0}
                            onClick={() => setPageNo((p) => Math.max(0, p - 1))}
                            className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
                        >
                            {t('pagination.prev')}
                        </button>
                        <button
                            type="button"
                            disabled={pageNo + 1 >= totalPages}
                            onClick={() => setPageNo((p) => p + 1)}
                            className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
                        >
                            {t('pagination.next')}
                        </button>
                    </div>
                </div>
            )}

            <DialogFooter className="mt-1 flex justify-end gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => openState?.(false)}
                    disable={isUpdating}
                >
                    {t('actions.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleLink}
                    disable={!selectedRow || isUpdating}
                >
                    {isUpdating ? t('actions.linking') : t('actions.linkAsSlide')}
                </MyButton>
            </DialogFooter>
        </div>
    );
};
