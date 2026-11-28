import { TestContent } from '@/types/assessments/schedule-test-list';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowSquareOut,
    CalendarBlank,
    CalendarCheck,
    CheckSquareOffset,
    FolderSimple,
    PlugsConnected,
    Timer,
    UsersThree,
} from '@phosphor-icons/react';
import { format } from 'date-fns';
import { resolveSubjectName } from '@/services/subject-names';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { ScheduleTestMainDropdownComponent } from './ScheduleTestDetailsDropdownMenu';
import { PrivateLinkInfo } from './assessment-share';
import { useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { getBatchNamesByIds } from '../assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-utils/helper';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';
import {
    AccessBadge,
    SessionBatches,
    SessionCardFooter,
    SessionCardShell,
    SessionMetaDivider,
    SessionMetaItem,
    SessionMetaRow,
} from '@/routes/study-library/live-session/-components/session-card-shell';
import { AssessmentTag, statusForTab, typeMetaFor } from './assessment-presentation';
import { isApiSourced } from '../-utils.ts/assessment-source';

/**
 * "26 Sep 2026, 6:15 PM" in the viewer's zone. Same UTC handling as
 * convertToLocalDateTime (the API sometimes omits the trailing Z), shorter text
 * so the metadata row fits on one line.
 */
const toCardDate = (value: string | null | undefined): string => {
    if (!value) return '';
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(value);
    const date = new Date(hasTimezone ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? '' : format(date, 'dd MMM yyyy, h:mm a');
};

/** Start / end for windowed tests, duration for timed ones, then participants and evaluation. */
function CardMetaRow({ test }: { test: TestContent }) {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    const hasWindow = test.play_mode === 'EXAM' || test.play_mode === 'SURVEY';
    const hasDuration = test.play_mode === 'EXAM' || test.play_mode === 'MOCK';
    const hours = Math.floor(test.duration / 60);
    const minutes = test.duration % 60;
    const durationLabel =
        hours > 0
            ? [
                  t('info.duration.hours', { count: hours }),
                  minutes > 0 ? t('info.duration.minutes', { count: minutes }) : null,
              ]
                  .filter(Boolean)
                  .join(' ')
            : t('info.duration.minutes', { count: test.duration });
    return (
        <SessionMetaRow>
            {hasWindow && (
                <SessionMetaItem
                    icon={<CalendarBlank size={16} />}
                    tone="primary"
                    label={t('meta.starts')}
                    value={toCardDate(test.bound_start_time)}
                />
            )}
            {hasWindow && (
                <SessionMetaItem
                    icon={<CalendarCheck size={16} />}
                    tone="info"
                    label={t('meta.ends')}
                    value={toCardDate(test.bound_end_time)}
                />
            )}
            {hasDuration && (
                <SessionMetaItem
                    icon={<Timer size={16} />}
                    tone="warning"
                    label={t('meta.duration')}
                    value={durationLabel}
                />
            )}
            {hasWindow || hasDuration ? <SessionMetaDivider /> : null}
            <SessionMetaItem
                icon={<UsersThree size={16} />}
                tone="success"
                label={t('meta.participants')}
                value={
                    <span className="font-semibold text-neutral-900">
                        {test.user_registrations}
                    </span>
                }
            />
            <SessionMetaItem
                icon={<CheckSquareOffset size={16} />}
                tone="neutral"
                label={t('meta.evaluation')}
                value={
                    test.evaluation_type === 'MANUAL'
                        ? t('meta.evaluationManual')
                        : t('meta.evaluationAuto')
                }
            />
        </SessionMetaRow>
    );
}

/**
 * One assessment in the list, drawn with the same card system as the live
 * session list (shell, metadata row, batches, footer) so the two lists read
 * alike. The join link, its QR code and the UTM builder live in the ⋮ menu;
 * the type (exam, mock, practice …) is a badge so it reads at a glance.
 */
const ScheduleTestDetails = ({
    scheduleTestContent,
    selectedTab,
    handleRefetchData,
    subjectNamesById = {},
    folderName,
}: {
    scheduleTestContent: TestContent;
    selectedTab: string;
    handleRefetchData: () => void;
    /** Names for the subject ids the institute list cannot resolve — see subject-names.ts. */
    subjectNamesById?: Record<string, string>;
    /** Assessment folder this test is in (folders on); shown as a chip. */
    folderName?: string;
}) => {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    const navigate = useNavigate();
    const cardRef = useRef<HTMLDivElement>(null);
    const { data: instituteDetails, isLoading } = useSuspenseQuery(useInstituteQuery());
    const batchNames = getBatchNamesByIds(
        instituteDetails?.batches_for_sessions,
        scheduleTestContent.batch_ids
    );
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
                assessmentTab: selectedTab,
            },
        });
    };

    // Dialogs and popovers portal to document.body, but React re-bubbles their
    // clicks through the component tree — only a click that really lands inside
    // the card opens the assessment.
    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current?.contains(e.target as Node)) return;
        handleNavigateAssessment(scheduleTestContent.assessment_id);
    };

    const type = typeMetaFor(scheduleTestContent.play_mode);
    const status = statusForTab(selectedTab);
    const subjectName = resolveSubjectName(
        instituteDetails?.subjects,
        subjectNamesById,
        scheduleTestContent.subject_id
    );
    const isPrivate = scheduleTestContent.assessment_visibility === 'PRIVATE';
    const subtitle = [
        subjectName &&
            t('info.subject', {
                label: getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                name: subjectName,
            }),
        scheduleTestContent.created_at &&
            t('meta.createdOn', { date: toCardDate(scheduleTestContent.created_at) }),
    ]
        .filter(Boolean)
        .join(' · ');

    if (isLoading) return <DashboardLoader />;
    return (
        <SessionCardShell cardRef={cardRef} onClick={handleCardClick}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="min-w-0">
                        <h3
                            className="truncate text-base font-semibold text-neutral-900 sm:text-lg"
                            title={scheduleTestContent.name}
                        >
                            {scheduleTestContent.name}
                        </h3>
                        {subtitle ? (
                            <p
                                className="mt-0.5 truncate text-sm text-neutral-500"
                                title={subtitle}
                            >
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                </div>
                <div
                    className="flex shrink-0 flex-wrap items-center justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    {folderName ? (
                        <span title={folderName}>
                            <AssessmentTag tone="neutral" icon={<FolderSimple size={12} />}>
                                <span className="inline-block max-w-32 truncate align-bottom">
                                    {folderName}
                                </span>
                            </AssessmentTag>
                        </span>
                    ) : null}
                    <AssessmentTag tone={type.tone}>{t(`types.${type.key}`)}</AssessmentTag>
                    {isApiSourced(scheduleTestContent.source) ? (
                        <span title={t('source.apiTooltip')}>
                            <AssessmentTag tone="info" icon={<PlugsConnected size={12} />}>
                                {t('source.api')}
                            </AssessmentTag>
                        </span>
                    ) : null}
                    <AssessmentTag tone={status.tone} dot>
                        {t(`status.${status.key}`)}
                    </AssessmentTag>
                    <span className="inline-flex items-center gap-0.5">
                        <AccessBadge
                            accessLevel={scheduleTestContent.assessment_visibility?.toLowerCase()}
                        />
                        {isPrivate ? <PrivateLinkInfo /> : null}
                    </span>
                    <ScheduleTestMainDropdownComponent
                        scheduleTestContent={scheduleTestContent}
                        selectedTab={selectedTab}
                        handleRefetchData={handleRefetchData}
                    />
                </div>
            </div>

            <CardMetaRow test={scheduleTestContent} />

            <SessionCardFooter>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-3">
                    {batchNames.length ? (
                        <SessionBatches
                            batches={batchNames}
                            maxVisible={2}
                            label={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                            moreLabel={(count) => t('batchDialog.moreLink', { count })}
                            lessLabel={t('batches.less')}
                        />
                    ) : null}
                </div>
                <div
                    className="flex shrink-0 items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        className="w-full gap-1.5 sm:w-auto sm:!min-w-0 sm:px-5"
                        onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
                    >
                        <ArrowSquareOut size={16} />
                        {t('actions.viewDetails')}
                    </MyButton>
                </div>
            </SessionCardFooter>
        </SessionCardShell>
    );
};

export default ScheduleTestDetails;
