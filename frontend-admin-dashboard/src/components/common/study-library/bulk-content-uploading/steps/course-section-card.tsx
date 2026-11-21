// Bulk Content Uploading — one card per top-level course folder in multi mode.

import { useMemo } from 'react';
import {
    ArrowCounterClockwise,
    Folder,
    Info,
    Prohibit,
    Warning,
    XCircle,
} from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import { PreviewTree } from '../preview-tree';
import { useBulkContentUploadingStore } from '../use-bulk-content-uploading-store';
import type { SectionCallbacks } from '../bulk-content-uploading-wizard';
import type { BulkIssue, CourseSection } from '../types';

const SectionBadge = ({ section }: { section: CourseSection }) => {
    if (section.status === 'skipped') {
        return (
            <span className="rounded-sm bg-neutral-100 px-2 py-0.5 text-caption text-neutral-500">
                Skipped
            </span>
        );
    }
    if (section.status === 'blocked') {
        return (
            <span className="rounded-sm bg-danger-50 px-2 py-0.5 text-caption text-danger-700">
                Blocked
            </span>
        );
    }
    if (section.status === 'unmatched') {
        return (
            <span className="rounded-sm bg-warning-50 px-2 py-0.5 text-caption text-warning-700">
                No match found
            </span>
        );
    }
    if (section.status === 'error') {
        return (
            <span className="rounded-sm bg-danger-50 px-2 py-0.5 text-caption text-danger-700">
                Error
            </span>
        );
    }
    if (section.status === 'needs-batch') {
        return (
            <span className="rounded-sm bg-warning-50 px-2 py-0.5 text-caption text-warning-700">
                Select a batch
            </span>
        );
    }
    return (
        <span className="rounded-sm bg-success-50 px-2 py-0.5 text-caption text-success-700">
            Matched{section.courseName ? `: ${section.courseName}` : ''}
        </span>
    );
};

const IssueList = ({ issues }: { issues: BulkIssue[] }) => {
    if (issues.length === 0) return null;
    const icon = (level: BulkIssue['level']) =>
        level === 'error' ? (
            <XCircle className="size-4 shrink-0 text-danger-500" />
        ) : level === 'warning' ? (
            <Warning className="size-4 shrink-0 text-warning-600" />
        ) : (
            <Info className="size-4 shrink-0 text-neutral-400" />
        );
    return (
        <ul className="max-h-36 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-100">
            {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`} className="flex items-start gap-2 px-3 py-1.5">
                    {icon(issue.level)}
                    <span className="text-caption text-neutral-600">
                        <span className="font-medium text-neutral-700">{issue.path}</span> —{' '}
                        {issue.message}
                    </span>
                </li>
            ))}
        </ul>
    );
};

interface CourseSectionCardProps {
    section: CourseSection;
    callbacks: SectionCallbacks;
}

export const CourseSectionCard = ({ section, callbacks }: CourseSectionCardProps) => {
    const studyLibraryData = useStudyLibraryStore((state) => state.studyLibraryData);
    const items = useBulkContentUploadingStore((state) => state.items);

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);

    const courseEntry = useMemo(
        () => (studyLibraryData ?? []).find((entry) => entry.course.id === section.courseId),
        [studyLibraryData, section.courseId]
    );

    const courseOptions: SearchableSelectOption[] = useMemo(
        () =>
            (studyLibraryData ?? []).map((entry) => ({
                label: entry.course.package_name,
                value: entry.course.id,
            })),
        [studyLibraryData]
    );

    const sessionOptions: SearchableSelectOption[] = useMemo(
        () =>
            (courseEntry?.sessions ?? []).map((session) => ({
                label: session.session_dto.session_name,
                value: session.session_dto.id,
            })),
        [courseEntry]
    );
    const levelOptions: SearchableSelectOption[] = useMemo(
        () =>
            (
                (courseEntry?.sessions ?? []).find(
                    (session) => session.session_dto.id === section.sessionId
                )?.level_with_details ?? []
            ).map((level) => ({ label: level.name, value: level.id })),
        [courseEntry, section.sessionId]
    );

    const hasMultipleBatches =
        !!courseEntry &&
        (courseEntry.sessions.length > 1 ||
            (courseEntry.sessions[0]?.level_with_details.length ?? 0) > 1);
    const showBatchPickers =
        hasMultipleBatches &&
        section.status !== 'skipped' &&
        section.status !== 'unmatched' &&
        section.status !== 'blocked';

    const sectionItemCount = useMemo(
        () => Object.values(items).filter((i) => i.sectionId === section.id).length,
        [items, section.id]
    );

    const isSkipped = section.status === 'skipped';

    return (
        <div
            className={cn(
                'rounded-lg border bg-white',
                section.status === 'blocked' || section.status === 'error'
                    ? 'border-danger-200'
                    : section.status === 'ready'
                      ? 'border-neutral-200'
                      : 'border-warning-200',
                isSkipped && 'border-neutral-200 opacity-60'
            )}
        >
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
                <Folder className="size-5 shrink-0 text-primary-400" weight="fill" />
                <span
                    className={cn(
                        'text-subtitle font-semibold text-neutral-700',
                        isSkipped && 'line-through'
                    )}
                >
                    {section.topFolderDisplay}
                    {section.batchHint ? ` (${section.batchHint})` : ''}
                </span>
                <SectionBadge section={section} />
                <span className="text-caption text-neutral-400">
                    {section.fileCount} file{section.fileCount === 1 ? '' : 's'}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {!isSkipped && (
                        <div className="w-56">
                            <SearchableSelect
                                options={courseOptions}
                                value={section.courseId ?? ''}
                                placeholder={`Map to ${courseTerm.toLowerCase()}…`}
                                searchPlaceholder={`Search ${courseTerm.toLowerCase()}…`}
                                emptyText={`No ${courseTerm.toLowerCase()} found.`}
                                onChange={(value) => callbacks.onCourseChange(section.id, value)}
                            />
                        </div>
                    )}
                    <MyButton
                        buttonType="secondary"
                        onClick={() => callbacks.onToggleSkip(section.id)}
                        className="!px-3 !py-1 text-xs"
                    >
                        {isSkipped ? 'Include' : 'Skip'}
                    </MyButton>
                </div>
            </div>

            {!isSkipped && showBatchPickers && (
                <div className="flex flex-wrap gap-3 border-b border-neutral-100 bg-warning-50/50 px-4 py-3">
                    <div className="w-52">
                        <span className="text-caption font-medium text-neutral-600">
                            {sessionTerm}
                        </span>
                        <SearchableSelect
                            options={sessionOptions}
                            value={section.sessionId ?? ''}
                            placeholder={`Select ${sessionTerm.toLowerCase()}`}
                            onChange={(sessionId) => {
                                const levels =
                                    courseEntry?.sessions.find(
                                        (s) => s.session_dto.id === sessionId
                                    )?.level_with_details ?? [];
                                const onlyLevel = levels.length === 1 ? levels[0] : undefined;
                                if (onlyLevel) {
                                    callbacks.onBatchChange(section.id, sessionId, onlyLevel.id);
                                } else {
                                    callbacks.onBatchChange(section.id, sessionId, '');
                                }
                            }}
                        />
                    </div>
                    <div className="w-52">
                        <span className="text-caption font-medium text-neutral-600">
                            {levelTerm}
                        </span>
                        <SearchableSelect
                            options={levelOptions}
                            value={section.levelId ?? ''}
                            placeholder={`Select ${levelTerm.toLowerCase()}`}
                            disabled={!section.sessionId}
                            onChange={(levelId) =>
                                callbacks.onBatchChange(
                                    section.id,
                                    section.sessionId ?? '',
                                    levelId
                                )
                            }
                        />
                    </div>
                </div>
            )}

            {!isSkipped && (
                <div className="flex flex-col gap-3 p-4">
                    {section.status === 'blocked' && (
                        <div className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2">
                            <Prohibit className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <p className="text-caption text-danger-700">
                                {section.error ??
                                    `You cannot upload into this ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.`}
                            </p>
                        </div>
                    )}
                    {section.status === 'error' && (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 px-3 py-2">
                            <p className="text-caption text-danger-700">
                                {section.error ??
                                    `Failed to read this ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} structure.`}
                            </p>
                            <MyButton
                                buttonType="secondary"
                                onClick={() => callbacks.onRetrySection(section.id)}
                                className="!px-3 !py-1 text-xs"
                            >
                                <ArrowCounterClockwise className="size-3.5" />
                                Retry
                            </MyButton>
                        </div>
                    )}
                    {section.status === 'unmatched' && (
                        <p className="text-caption text-neutral-500">
                            No {courseTerm.toLowerCase()} matches “{section.topFolderDisplay}”. Map
                            it to a {courseTerm.toLowerCase()} above, or skip this folder.
                        </p>
                    )}
                    {section.status === 'loading' && (
                        <div className="flex items-center gap-2 py-2">
                            <DashboardLoader />
                            <span className="text-caption text-neutral-500">
                                Reading existing structure…
                            </span>
                        </div>
                    )}
                    {section.status === 'ready' && (
                        <>
                            <PreviewTree sectionId={section.id} />
                            <div className="flex items-center gap-2 text-caption text-neutral-500">
                                <span>
                                    {sectionItemCount}{' '}
                                    {(sectionItemCount === 1
                                        ? getTerminology(ContentTerms.Slide, SystemTerms.Slide)
                                        : getTerminologyPlural(
                                              ContentTerms.Slide,
                                              SystemTerms.Slide
                                          )
                                    ).toLowerCase()}{' '}
                                    to upload
                                </span>
                            </div>
                            <IssueList issues={section.issues} />
                        </>
                    )}
                    {section.fatalErrors.map((message) => (
                        <div
                            key={message}
                            className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2"
                        >
                            <XCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <p className="text-caption text-danger-700">{message}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
