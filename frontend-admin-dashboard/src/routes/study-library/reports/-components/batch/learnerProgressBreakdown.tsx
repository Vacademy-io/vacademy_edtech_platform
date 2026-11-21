import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight, Stack, VideoCamera, FileText } from '@phosphor-icons/react';

import { MyDropdown } from '@/components/design-system/dropdown';
import { StatusChip } from '@/components/design-system/status-chips';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';

import {
    ProfileSectionCard,
    ProfileEmpty,
    ProfileMiniBar,
} from '@/routes/manage-students/students-list/-components/students-list/student-side-view/profile-ui';
import { InlineProgress } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-learning-progress/inline-progress';
import type {
    StudentSubjectsDetailsTypes,
    SubjectWithDetails,
} from '@/routes/manage-students/students-list/-types/student-subjects-details-types';

/**
 * Expanded row of Course Details → Reports → Student Progress.
 *
 * Deliberately a copy of the learner side-view Progress panel's "Course Content"
 * card — same subject picker, same module accordion with a tinted header strip
 * and mini bar, same chapter rows with a tone-coded media chip — so an admin
 * reads one learner the same way in both places.
 *
 * Renders straight from the subject tree the parent already fetched; expanding
 * costs no request. Stops at chapter (no slide level).
 */

/** Subject % = mean of its modules' canonical percentages. Mirrors the backend rollup. */
export const subjectPercentage = (subject: SubjectWithDetails): number => {
    const modules = subject.modules ?? [];
    if (!modules.length) return 0;
    const total = modules.reduce((sum, mod) => sum + (mod.percentage_completed ?? 0), 0);
    return total / modules.length;
};

interface LearnerProgressBreakdownProps {
    subjects: StudentSubjectsDetailsTypes | null;
    isLoading: boolean;
}

export const LearnerProgressBreakdown = ({
    subjects,
    isLoading,
}: LearnerProgressBreakdownProps) => {
    const { t } = useTranslation('studyLibraryLearnerProgressBreakdown');
    const subjectTerm = getTerminology(ContentTerms.Subject, SystemTerms.Subject);
    const moduleTerm = getTerminology(ContentTerms.Module, SystemTerms.Module);

    const [currentSubject, setCurrentSubject] = useState<SubjectWithDetails | null>(null);
    // Only one module accordion open at a time — same rule as the side view.
    const [openModuleId, setOpenModuleId] = useState<string>('');

    useEffect(() => {
        const first = subjects?.[0] ?? null;
        setCurrentSubject(first);
        setOpenModuleId(first?.modules?.[0]?.module.id.toString() ?? '');
    }, [subjects]);

    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <DashboardLoader size={22} />
            </div>
        );
    }

    if (!subjects || subjects.length === 0) {
        return (
            <div className="p-4">
                <ProfileEmpty
                    icon={Stack}
                    title={t('emptyTitle')}
                    hint={t('emptyHint', { term: subjectTerm.toLowerCase() })}
                />
            </div>
        );
    }

    const handleSubjectChange = (name: string) => {
        const next = subjects.find((s) => s.subject_dto.subject_name === name);
        if (!next) return;
        setCurrentSubject(next);
        setOpenModuleId(next.modules[0]?.module.id.toString() ?? '');
    };

    return (
        <div className="space-y-3 bg-neutral-50 p-4">
            {/* Subject strip — every subject with its rolled-up %, so the admin sees
                where the learner stands before drilling into one. */}
            <ProfileSectionCard icon={Stack} heading={t('subjectProgressHeading', { term: subjectTerm })}>
                <div className="flex flex-wrap gap-2">
                    {subjects.map((subject) => {
                        const pct = subjectPercentage(subject);
                        const isActive = currentSubject?.subject_dto.id === subject.subject_dto.id;
                        return (
                            <button
                                key={subject.subject_dto.id}
                                type="button"
                                onClick={() =>
                                    handleSubjectChange(subject.subject_dto.subject_name)
                                }
                                className={cn(
                                    'flex min-w-52 flex-1 flex-col gap-1.5 rounded-md border p-2.5 text-left transition',
                                    isActive
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-neutral-200 bg-white hover:border-primary-200'
                                )}
                            >
                                <span className="truncate text-caption font-semibold text-neutral-800">
                                    {subject.subject_dto.subject_name}
                                </span>
                                <ProfileMiniBar value={pct} />
                                <span className="text-2xs text-neutral-500">
                                    {t('moduleCount', {
                                        count: (subject.modules ?? []).length,
                                        term: moduleTerm.toLowerCase(),
                                    })}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </ProfileSectionCard>

            {/* Course content — module accordion, chapters inside. Mirrors the
                side-view Progress panel one-for-one. */}
            <ProfileSectionCard
                icon={Stack}
                heading={t('moduleChapterBreakdownHeading', { term: moduleTerm })}
                action={
                    subjects.length > 1 ? (
                        <MyDropdown
                            currentValue={currentSubject?.subject_dto.subject_name ?? ''}
                            dropdownList={subjects.map((s) => s.subject_dto.subject_name)}
                            placeholder={t('selectSubjectPlaceholder', {
                                term: subjectTerm.toLowerCase(),
                            })}
                            handleChange={handleSubjectChange}
                        />
                    ) : null
                }
            >
                {currentSubject == null || currentSubject.modules.length === 0 ? (
                    <p className="px-1 py-2 text-caption italic text-muted-foreground">
                        {t('noModulesForSubject', {
                            moduleTerm: moduleTerm.toLowerCase(),
                            subjectTerm: subjectTerm.toLowerCase(),
                        })}
                    </p>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {currentSubject.modules.map((mod) => {
                            const modPct = mod.percentage_completed ?? 0;
                            const isOpen = openModuleId === mod.module.id.toString();

                            return (
                                <div
                                    key={mod.module.id}
                                    className="overflow-hidden rounded-md border border-border"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setOpenModuleId(isOpen ? '' : mod.module.id.toString())
                                        }
                                        aria-expanded={isOpen}
                                        className={cn(
                                            'flex w-full items-center gap-3 bg-muted px-4 py-3 text-left transition',
                                            'hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                                        )}
                                    >
                                        <span className="shrink-0 text-muted-foreground">
                                            {isOpen ? (
                                                <CaretDown className="size-4" weight="bold" />
                                            ) : (
                                                <CaretRight className="size-4" weight="bold" />
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-body font-semibold text-card-foreground">
                                            {t('moduleLabel', {
                                                term: moduleTerm,
                                                name: mod.module.module_name,
                                            })}
                                        </span>
                                        <div className="w-24 shrink-0">
                                            <ProfileMiniBar value={modPct} label="" />
                                        </div>
                                        <span className="w-10 shrink-0 text-right text-caption font-semibold text-primary-600">
                                            {Math.round(modPct)}%
                                        </span>
                                    </button>

                                    {isOpen && (
                                        <div className="flex flex-col bg-card px-4 pb-3 pt-1.5">
                                            {mod.chapters.length === 0 ? (
                                                <p className="py-2 text-caption italic text-muted-foreground">
                                                    {t('noChaptersInModule', {
                                                        term: moduleTerm.toLowerCase(),
                                                    })}
                                                </p>
                                            ) : (
                                                mod.chapters.map((chapter, idx) => {
                                                    const chapterPct =
                                                        chapter.percentage_completed ?? 0;
                                                    const isDone = chapterPct >= 100;
                                                    const isVideo = (chapter.video_count ?? 0) > 0;
                                                    const TypeIcon = isVideo
                                                        ? VideoCamera
                                                        : FileText;
                                                    return (
                                                        <div
                                                            key={chapter.id}
                                                            className={cn(
                                                                'flex items-center gap-3 py-2',
                                                                idx > 0 &&
                                                                    'border-t border-neutral-100'
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    'flex size-7 shrink-0 items-center justify-center rounded-md',
                                                                    isDone
                                                                        ? 'bg-success-50 text-success-600'
                                                                        : 'bg-warning-50 text-warning-600'
                                                                )}
                                                            >
                                                                <TypeIcon
                                                                    className="size-4"
                                                                    weight="duotone"
                                                                />
                                                            </span>
                                                            <span className="min-w-0 flex-1 truncate text-body text-card-foreground">
                                                                {chapter.chapter_name}
                                                            </span>
                                                            {isDone && (
                                                                <StatusChip
                                                                    status="SUCCESS"
                                                                    textSize="text-caption"
                                                                    text={t('done')}
                                                                />
                                                            )}
                                                            <InlineProgress
                                                                percentage={chapterPct}
                                                            />
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </ProfileSectionCard>
        </div>
    );
};

export default LearnerProgressBreakdown;
