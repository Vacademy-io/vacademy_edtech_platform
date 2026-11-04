import { useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarBlank, CaretRight, ClipboardText, Plus, Users } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import { getAssessmentListWithFilters } from '@/routes/assessment/assessment-list/-services/assessment-services';
import type { TestContent } from '@/types/assessments/schedule-test-list';

export const Route = createFileRoute('/evalezy/')({
    component: EvalezyHome,
});

const PAGE_SIZE = 10;

interface AssessmentPage {
    content: TestContent[];
    last: boolean;
    total_elements: number;
    total_pages: number;
}

/**
 * Step 1 of Evalezy: pick the assessment the copies belong to. Only published
 * assessments that are checked by hand (MANUAL evaluation) are listed — those
 * are the ones with answer copies to check.
 */
function EvalezyHome() {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const newAssessment = () => navigate({ to: '/evalezy/new' });
    const instituteId = getInstituteId();
    const [search, setSearch] = useState('');
    const [term, setTerm] = useState('');
    const [page, setPage] = useState(0);
    useEffect(() => {
        const timer = setTimeout(() => {
            setTerm(search.trim());
            // Page 4 of the whole list means nothing for a new search.
            setPage(0);
        }, 350);
        return () => clearTimeout(timer);
    }, [search]);

    const query = useQuery({
        queryKey: ['EVALEZY_ASSESSMENTS', instituteId, term, page],
        queryFn: () =>
            getAssessmentListWithFilters(page, PAGE_SIZE, instituteId, {
                name: term,
                batch_ids: [],
                subjects_ids: [],
                tag_ids: [],
                get_live_assessments: false,
                get_passed_assessments: false,
                get_upcoming_assessments: false,
                institute_ids: instituteId ? [instituteId] : [],
                assessment_statuses: [{ id: 'PUBLISHED', name: 'PUBLISHED' }],
                assessment_modes: [],
                access_statuses: [],
                evaluation_types: [{ id: 'MANUAL', name: 'MANUAL' }],
            }) as Promise<AssessmentPage>,
        // The current page stays up until the next one arrives, so the list does not jump.
        placeholderData: keepPreviousData,
        enabled: !!instituteId,
    });
    const assessments = query.data?.content ?? [];
    const totalPages = query.data?.total_pages ?? 0;

    // The list can shrink under an open page (a test deleted elsewhere).
    useEffect(() => {
        if (totalPages > 0 && page >= totalPages) setPage(totalPages - 1);
    }, [page, totalPages]);

    const goToPage = (next: number) => {
        setPage(next);
        window.scrollTo({ top: 0 });
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-h3 font-semibold text-neutral-800">{t('home.title')}</h1>
                    <p className="text-body text-neutral-500">{t('home.subtitle')}</p>
                </div>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    className="shrink-0"
                    onClick={newAssessment}
                >
                    <Plus size={16} weight="bold" />
                    {t('home.new')}
                </MyButton>
            </div>

            <MyInput
                inputType="search"
                inputPlaceholder={t('home.search')}
                input={search}
                onChangeFunction={(e) => setSearch(e.target.value)}
                // MyInput caps itself at sm:w-60; only a same-breakpoint class lifts it.
                className="w-full text-body sm:w-full"
            />

            {query.isLoading ? (
                <DashboardLoader />
            ) : query.isError ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center">
                    <p className="text-body text-danger-700">{t('home.error')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => void query.refetch()}
                    >
                        {t('common.retry')}
                    </MyButton>
                </div>
            ) : assessments.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
                    <ClipboardText size={32} className="text-neutral-400" />
                    <p className="text-subtitle font-medium text-neutral-700">
                        {term ? t('home.noMatch') : t('home.empty')}
                    </p>
                    {!term && <p className="text-body text-neutral-500">{t('home.emptyHint')}</p>}
                    {!term && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className="mt-2"
                            onClick={newAssessment}
                        >
                            <Plus size={16} weight="bold" />
                            {t('home.newFromPaper')}
                        </MyButton>
                    )}
                </div>
            ) : (
                <ul
                    className={cn(
                        'flex flex-col gap-2 transition-opacity',
                        query.isPlaceholderData && 'opacity-60'
                    )}
                >
                    {assessments.map((a) => (
                        <li key={a.assessment_id}>
                            <Link
                                to="/evalezy/$assessmentId"
                                params={{ assessmentId: a.assessment_id }}
                                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-primary-300 hover:bg-primary-50"
                            >
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                    <ClipboardText size={20} />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="truncate text-subtitle font-semibold text-neutral-800">
                                        {a.name}
                                    </span>
                                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-neutral-500">
                                        {a.bound_start_time && (
                                            <span className="flex items-center gap-1">
                                                <CalendarBlank size={14} />
                                                {new Date(a.bound_start_time).toLocaleDateString()}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1">
                                            <Users size={14} />
                                            {t('home.students', {
                                                count: a.user_registrations ?? 0,
                                            })}
                                        </span>
                                    </span>
                                </span>
                                <CaretRight size={18} className="shrink-0 text-neutral-400" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {!query.isError && totalPages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={goToPage}
                    totalElements={query.data?.total_elements}
                    pageSize={PAGE_SIZE}
                    compactOnPhone
                />
            )}
        </div>
    );
}
