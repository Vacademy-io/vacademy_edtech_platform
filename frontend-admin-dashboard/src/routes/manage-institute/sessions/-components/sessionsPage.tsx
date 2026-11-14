import { useEffect, useState } from 'react';
import { SessionsEnhancedCounts, type SessionStatusView } from './SessionsEnhancedCounts';
import { useTranslation } from 'react-i18next';
import SessionHeader from './sessionHeader';
import { useSessionData } from '@/services/study-library/session-management/getSessionData';
import { SessionsResponse } from '@/types/study-library/session-types';
import { SessionCard } from './sessionCard';
import { SessionsMatrix } from './SessionsMatrix';
import { useQuery } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { EmptySessionImage } from '@/assets/svgs';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { DownloadSimple, Info, MagnifyingGlass, SquaresFour, Table } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { buildCsv, downloadCsv } from '@/routes/manage-custom-teams/-utils/list-export';

type SessionsView = 'cards' | 'matrix';

export function SessionsPage() {
    const { t } = useTranslation('manageInstituteSessionsPage');
    const { data, isLoading, isError } = useQuery({
        ...useSessionData(),
    });
    const [isOpen, setIsOpen] = useState(false);
    const [sessionData, setSessionData] = useState<SessionsResponse>();
    const { getCourseFromPackage, instituteDetails } = useInstituteDetailsStore();
    const [status, setStatus] = useState<SessionStatusView>('all');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<SessionsView>('cards');

    useEffect(() => {
        const courseList = getCourseFromPackage();
        if (courseList.length === 0) {
            setIsOpen(true);
        }
    }, [instituteDetails]);

    useEffect(() => {
        setSessionData(data);
    }, [data]);

    if (isLoading) {
        return <DashboardLoader />;
    }

    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const sessionsTerm = getTerminologyPlural(ContentTerms.Session, SystemTerms.Session);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);

    // Status + search over the list already loaded; matching a course or level
    // name keeps the whole session card (its other courses stay visible).
    const query = search.trim().toLowerCase();
    const visibleSessions = (sessionData ?? []).filter((s) => {
        if (status === 'active' && s.session.status !== 'ACTIVE') return false;
        if (status === 'inactive' && s.session.status === 'ACTIVE') return false;
        if (!query) return true;
        return (
            s.session.session_name?.toLowerCase().includes(query) ||
            s.packages.some(
                (p) =>
                    p.package_dto.package_name?.toLowerCase().includes(query) ||
                    p.level.some((l) => l.level_dto.level_name?.toLowerCase().includes(query))
            )
        );
    });

    /** One row per course × level × session, from the loaded list (no request). */
    const exportSessions = () => {
        const rows = visibleSessions.flatMap((s) =>
            s.packages.flatMap((p) =>
                p.level.map((l) => [
                    s.session.session_name,
                    s.session.status,
                    s.session.start_date ?? '',
                    p.package_dto.package_name,
                    l.level_dto.level_name,
                    l.package_session_status,
                ])
            )
        );
        downloadCsv(
            buildCsv(
                [
                    sessionTerm,
                    t('csv.status'),
                    t('csv.startDate'),
                    courseTerm,
                    levelTerm,
                    t('csv.levelStatus'),
                ],
                rows
            ),
            `${sessionsTerm}.csv`.replace(/\s+/g, '-')
        );
    };

    const views: Array<[SessionsView, typeof SquaresFour, string]> = [
        ['cards', SquaresFour, t('view.cards')],
        ['matrix', Table, t('view.matrix', { course: courseTerm, session: sessionTerm })],
    ];

    return (
        <div className="flex flex-col gap-5">
            <SessionHeader
                actions={
                    sessionData?.length ? (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="gap-2"
                            onClick={exportSessions}
                        >
                            <DownloadSimple size={18} />
                            {t('export')}
                        </MyButton>
                    ) : null
                }
            />
            <SessionsEnhancedCounts sessions={sessionData} status={status} onStatus={setStatus} />
            {isError ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-danger-200 bg-danger-50 px-4 py-10 text-center">
                    <p className="text-body text-danger-700">{t('fetchError')}</p>
                </div>
            ) : sessionData?.length ? (
                <>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative grow">
                            <MagnifyingGlass
                                size={18}
                                className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                            />
                            <MyInput
                                inputType="text"
                                input={search}
                                onChangeFunction={(e) => setSearch(e.target.value)}
                                inputPlaceholder={t('searchPlaceholder', {
                                    session: sessionTerm.toLocaleLowerCase(),
                                    course: courseTerm.toLocaleLowerCase(),
                                    level: levelTerm.toLocaleLowerCase(),
                                })}
                                size="large"
                                className="w-full rounded-lg border-neutral-200 ps-10 sm:w-full"
                            />
                        </div>
                        <div className="flex w-fit items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
                            {views.map(([value, ViewIcon, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={view === value}
                                    onClick={() => setView(value)}
                                    className={cn(
                                        'flex h-8 items-center gap-1.5 rounded-md px-3 text-caption font-medium transition-colors',
                                        view === value
                                            ? 'bg-primary-500 text-white'
                                            : 'text-neutral-600 hover:bg-neutral-100'
                                    )}
                                >
                                    <ViewIcon size={16} />
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {visibleSessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-12 text-center">
                            <p className="text-subtitle font-medium text-neutral-600">
                                {t('noMatches', { sessions: sessionsTerm.toLocaleLowerCase() })}
                            </p>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => {
                                    setSearch('');
                                    setStatus('all');
                                }}
                            >
                                {t('clearFilters')}
                            </MyButton>
                        </div>
                    ) : view === 'matrix' ? (
                        <SessionsMatrix sessions={visibleSessions} />
                    ) : (
                        <div className="flex flex-col gap-4 text-neutral-600">
                            {visibleSessions.map((session) => (
                                <SessionCard key={session.session.id} data={session} />
                            ))}
                        </div>
                    )}
                    <div className="flex items-start gap-2 rounded-xl border border-info-100 bg-info-50 px-4 py-3 text-info-700">
                        <Info size={18} className="mt-0.5 shrink-0" />
                        <p className="text-caption">
                            {t('deleteNote', {
                                session: sessionTerm.toLocaleLowerCase(),
                                batches: getTerminologyPlural(
                                    ContentTerms.Batch,
                                    SystemTerms.Batch
                                ).toLocaleLowerCase(),
                            })}
                        </p>
                    </div>
                </>
            ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-16 text-center">
                    <EmptySessionImage className="size-24 sm:size-32" />
                    <p className="text-body text-neutral-600">{t('noSessionsFound')}</p>
                </div>
            )}
            <NoCourseDialog
                isOpen={isOpen}
                setIsOpen={setIsOpen}
                type={t('noCourseDialog.type')}
                content={t('noCourseDialog.content')}
            />
        </div>
    );
}
