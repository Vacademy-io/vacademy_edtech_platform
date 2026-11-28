import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Row } from '@tanstack/react-table';
import {
    SubjectOverviewBatchColumnType,
    ChapterReport,
    ChapterOverviewColumns,
} from '../../-types/types';
import { useMutation } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyTable } from '@/components/design-system/table';
import { fetchChapterWiseProgress, fetchLearnersChapterWiseProgress } from '../../-services/utils';
import { usePacageDetails } from '../../-store/usePacageDetails';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { resolveInstituteLogoUrl } from '../live/-utils/instituteLogo';
import { exportModuleDetailPdf } from '../../-utils/exportModuleDetailPdf';
import dayjs from 'dayjs';
import { formatToTwoDecimalPlaces, convertMinutesToTimeFormat } from '../../-services/helper';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { toast } from 'sonner';
import { Export } from '@phosphor-icons/react';

/** Small labelled pill for the report's course/session/level/date metadata. */
const MetaChip = ({ label, value }: { label: string; value: string }) => (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-caption">
        <span className="font-medium uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="font-semibold text-neutral-700">{value || '—'}</span>
    </span>
);

export const ViewDetails = ({ row }: { row: Row<SubjectOverviewBatchColumnType> }) => {
    const { t } = useTranslation([
        'studyLibraryBatchViewDetailsDialogBox',
        'studyLibraryExportModuleDetailPdf',
    ]);
    const [viewDetailsState, setViewDetailsState] = useState(false);
    const [chapterReportData, setChapterReportData] = useState<ChapterReport>();
    const store = usePacageDetails();
    // Multi-batch reports tag every row with its own batch; the store only
    // remembers the first batch generated, so prefer the row.
    const pacageSessionId = row.original.package_session_id || store.pacageSessionId;
    const course = row.original.course_name ?? store.course;
    const session = row.original.session_name ?? store.session;
    const level = row.original.level_name ?? store.level;
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const ChapterWiseMutation = useMutation({
        mutationFn: fetchChapterWiseProgress,
    });
    const LearnersChapterWiseMutation = useMutation({
        mutationFn: fetchLearnersChapterWiseProgress,
    });
    const { isPending: isChapterPending, error: chapterError } = ChapterWiseMutation;
    const { isPending: isLearnerPending, error: learnerError } = LearnersChapterWiseMutation;
    const [isExporting, setIsExporting] = useState(false);

    // Courses shallower than the full Subject → Module → Chapter structure come
    // back with the literal "DEFAULT" placeholder for the missing level(s).
    // Skip rendering a level's label/heading when it is that placeholder so we
    // don't surface "Subjects: DEFAULT" / a "Chapters: DEFAULT" heading.
    const isDefaultLevel = (value: unknown) =>
        (value ?? '').toString().trim().toUpperCase() === 'DEFAULT';

    // Module/Chapter names usually already carry their term (e.g. "MODULE 1 …",
    // "Unit 4 …"), and the content structure shows those bare names with no term
    // prefix. Mirror that: only prepend the term label when the name doesn't
    // already start with it — avoids "Module: MODULE 1" / "Unit  Unit 4".
    const nameHasTermPrefix = (name: unknown, term: string) =>
        (name ?? '').toString().trim().toLowerCase().startsWith(term.trim().toLowerCase());

    const handleExportPDF = async () => {
        if (!chapterReportData?.length) {
            toast.error(t('toast.noDataToExport'));
            return;
        }
        setIsExporting(true);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportModuleDetailPdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    courseName: course,
                    sessionName: session,
                    levelName: level,
                    subjectName: (row.getValue('subject') as string) || '',
                    moduleName: (row.getValue('module') as string) || '',
                    courseTerm: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    sessionTerm: getTerminology(ContentTerms.Session, SystemTerms.Session),
                    levelTerm: getTerminology(ContentTerms.Level, SystemTerms.Level),
                    subjectTerm: getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                    moduleTerm: getTerminology(ContentTerms.Modules, SystemTerms.Modules),
                    chapterTerm: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters),
                    batchTerm: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
                },
                chapterReportData,
                t
            );
            toast.success(t('toast.exportSuccess'));
        } catch {
            toast.error(t('toast.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    const date = new Date().toString();
    const currDate = dayjs(date).format('DD/MM/YYYY');
    useEffect(() => {
        if (viewDetailsState) {
            if (row.getValue('user_id')) {
                LearnersChapterWiseMutation.mutate(
                    {
                        packageSessionId: pacageSessionId,
                        userId: row.getValue('user_id'),
                        moduleId: row.getValue('module_id'),
                    },
                    {
                        onSuccess: (data) => {
                            setChapterReportData(data);
                        },
                        onError: (error) => {
                            console.error('Error:', error);
                        },
                    }
                );
            } else {
                ChapterWiseMutation.mutate(
                    {
                        packageSessionId: pacageSessionId,
                        moduleId: row.getValue('module_id'),
                    },
                    {
                        onSuccess: (data) => {
                            setChapterReportData(data);
                        },
                        onError: (error) => {
                            console.error('Error:', error);
                        },
                    }
                );
            }
        }
    }, [viewDetailsState]);

    return (
        <div
            className="cursor-pointer text-primary-500"
            onClick={() => {
                setViewDetailsState(!viewDetailsState);
            }}
        >
            {t('viewDetails')}
            <MyDialog
                heading={t('heading')}
                open={viewDetailsState}
                onOpenChange={setViewDetailsState}
                dialogWidth="max-w-4xl"
            >
                <div className="flex flex-col gap-5">
                    {/* Header card: module title + metadata chips + export */}
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-2.5">
                                {!isDefaultLevel(row.getValue('module')) && (
                                    <h3 className="break-words text-h3 font-semibold text-primary-500">
                                        {row.getValue('module') as string}
                                    </h3>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                    <MetaChip
                                        label={getTerminology(
                                            ContentTerms.Course,
                                            SystemTerms.Course
                                        )}
                                        value={course}
                                    />
                                    <MetaChip
                                        label={getTerminology(
                                            ContentTerms.Session,
                                            SystemTerms.Session
                                        )}
                                        value={session}
                                    />
                                    <MetaChip
                                        label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
                                        value={level}
                                    />
                                    {!isDefaultLevel(row.getValue('subject')) && (
                                        <MetaChip
                                            label={getTerminology(
                                                ContentTerms.Subjects,
                                                SystemTerms.Subjects
                                            )}
                                            value={row.getValue('subject') as string}
                                        />
                                    )}
                                    <MetaChip label={t('date')} value={currDate} />
                                </div>
                            </div>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleExportPDF();
                                }}
                                disabled={isExporting}
                                className="shrink-0"
                            >
                                {isExporting ? (
                                    <div className="flex items-center gap-2">
                                        <div className="size-4 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-500"></div>
                                        <span>{t('exporting')}</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        <Export className="size-4" />
                                        <span>{t('exportPdf')}</span>
                                    </div>
                                )}
                            </MyButton>
                        </div>
                    </div>

                    {(isChapterPending || isLearnerPending) && <DashboardLoader />}

                    {chapterReportData &&
                        chapterReportData.length === 0 &&
                        !(isChapterPending || isLearnerPending) && (
                            <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-body text-neutral-400">
                                {t('noActivity', {
                                    term: getTerminology(
                                        ContentTerms.Module,
                                        SystemTerms.Module
                                    ).toLowerCase(),
                                })}
                            </div>
                        )}

                    {chapterReportData?.map((chapter) => (
                        <div
                            key={chapter.chapter_id}
                            className="overflow-hidden rounded-lg border border-neutral-200 shadow-sm [&_table]:!w-full [&_table]:!min-w-full"
                        >
                            {!isDefaultLevel(chapter.chapter_name) && (
                                <div className="flex items-center gap-2 border-b border-neutral-200 bg-primary-50 px-4 py-2.5">
                                    <span className="h-4 w-1 rounded-full bg-primary-500" />
                                    <span className="text-body font-semibold text-primary-600">
                                        {nameHasTermPrefix(
                                            chapter.chapter_name,
                                            getTerminology(ContentTerms.Chapter, SystemTerms.Chapter)
                                        )
                                            ? chapter.chapter_name
                                            : `${getTerminology(
                                                  ContentTerms.Chapters,
                                                  SystemTerms.Chapters
                                              )}: ${chapter.chapter_name}`}
                                    </span>
                                </div>
                            )}
                            <MyTable
                                key={chapter.chapter_id}
                                data={{
                                    content:
                                        chapter.slides?.map((slide) => ({
                                            study_slide: slide.slide_title,
                                            batch_concentration_score: `${formatToTwoDecimalPlaces(
                                                slide.avg_concentration_score
                                            )} %`,
                                            average_time_spent: `${convertMinutesToTimeFormat(
                                                slide.avg_time_spent
                                            )}`,
                                        })) || [],
                                    total_pages: 0,
                                    page_no: 0,
                                    page_size: 10,
                                    total_elements: 0,
                                    last: false,
                                }}
                                columns={ChapterOverviewColumns}
                                isLoading={isChapterPending || isLearnerPending}
                                error={chapterError || learnerError}
                                currentPage={0}
                            />
                        </div>
                    ))}
                </div>
            </MyDialog>
        </div>
    );
};
