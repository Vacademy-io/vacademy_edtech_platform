/**
 * Course-scoped "unsaved changes" dialog.
 *
 * Lists every slide in the CURRENT course that has a local (browser-only)
 * unsaved draft, grouped subject → module → chapter, each row clickable to
 * jump straight to that slide. Two entry points share it:
 *
 *  - mode="review": opened from the amber count chip / sidebar banner. Purely
 *    informative — jump to a slide or close.
 *  - mode="leave": shown by the leave-editor navigation blocker. Adds
 *    "Keep in browser" (proceed) and "Discard changes" (drop the listed
 *    drafts, then proceed).
 *
 * Deliberately NO "Save all": only document-type drafts are stashed locally,
 * so a bulk save could not honestly cover every listed slide. Saving happens
 * by opening a slide and saving it there.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from '@tanstack/react-router';
import { Warning, ArrowSquareOut, FileDoc } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { type SlideDraft } from '../-utils/slide-draft-store';
import { useContentStore } from '../-stores/chapter-sidebar-store';

interface UnsavedDraftsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Course-scoped drafts (already filtered via listCourseDrafts). */
    drafts: SlideDraft[];
    mode: 'review' | 'leave';
    /** Called right before navigating to a listed slide (leave mode uses it to cancel the blocked navigation). */
    onBeforeJump?: () => void;
    /** leave mode: keep drafts in the browser and proceed with the navigation. */
    onKeep?: () => void;
    /** leave mode: discard the listed drafts and proceed with the navigation. */
    onDiscard?: () => void;
}

/** subject → module → chapter grouping of the flat draft list. */
interface ChapterGroup {
    chapterId: string;
    chapterName: string;
    drafts: SlideDraft[];
}
interface ModuleGroup {
    moduleId: string;
    moduleName: string;
    chapters: ChapterGroup[];
}
interface SubjectGroup {
    subjectId: string;
    subjectName: string;
    modules: ModuleGroup[];
}

function groupDrafts(drafts: SlideDraft[]): SubjectGroup[] {
    const subjects = new Map<string, SubjectGroup>();
    for (const draft of drafts) {
        const ctx = draft.context;
        const subjectKey = ctx?.subjectId || 'unknown';
        let subject = subjects.get(subjectKey);
        if (!subject) {
            subject = {
                subjectId: subjectKey,
                subjectName:
                    ctx?.subjectName || getTerminology(ContentTerms.Subject, SystemTerms.Subject),
                modules: [],
            };
            subjects.set(subjectKey, subject);
        }
        const moduleKey = ctx?.moduleId || 'unknown';
        let moduleGroup = subject.modules.find((m) => m.moduleId === moduleKey);
        if (!moduleGroup) {
            moduleGroup = {
                moduleId: moduleKey,
                moduleName:
                    ctx?.moduleName || getTerminology(ContentTerms.Module, SystemTerms.Module),
                chapters: [],
            };
            subject.modules.push(moduleGroup);
        }
        const chapterKey = ctx?.chapterId || 'unknown';
        let chapter = moduleGroup.chapters.find((c) => c.chapterId === chapterKey);
        if (!chapter) {
            chapter = {
                chapterId: chapterKey,
                chapterName:
                    ctx?.chapterName || getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                drafts: [],
            };
            moduleGroup.chapters.push(chapter);
        }
        chapter.drafts.push(draft);
    }
    return [...subjects.values()];
}

function timeAgo(epochMs: number, t: TFunction): string {
    const mins = Math.max(0, Math.round((Date.now() - epochMs) / 60000));
    if (mins < 1) return t('justNow');
    if (mins < 60) return t('minAgo', { count: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('hrAgo', { count: hours });
    const days = Math.round(hours / 24);
    return t('dayAgo', { count: days });
}

export const UnsavedDraftsDialog = ({
    open,
    onOpenChange,
    drafts,
    mode,
    onBeforeJump,
    onKeep,
    onDiscard,
}: UnsavedDraftsDialogProps) => {
    const { t } = useTranslation('studyLibraryUnsavedDraftsDialog');
    const navigate = useNavigate();
    const subjectGroups = useMemo(() => groupDrafts(drafts), [drafts]);
    const showSubjectHeaders = subjectGroups.length > 1;
    const slideTerm = getTerminology(ContentTerms.Slide, SystemTerms.Slide).toLowerCase();
    const slidesTermPlural = getTerminologyPlural(
        ContentTerms.Slide,
        SystemTerms.Slide
    ).toLowerCase();

    const jumpToSlide = (draft: SlideDraft) => {
        const ctx = draft.context;
        if (!ctx?.chapterId) return;
        onBeforeJump?.();
        onOpenChange(false);
        navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: {
                courseId: ctx.courseId || '',
                levelId: ctx.levelId || '',
                subjectId: ctx.subjectId || '',
                moduleId: ctx.moduleId || '',
                chapterId: ctx.chapterId || '',
                slideId: draft.slideId,
                sessionId: ctx.sessionId || '',
            },
        });
        // Same-chapter jump: the URL slideId changes but the sidebar's URL→active
        // sync early-returns while the current slide still exists in the list, so
        // it never switches. Set the target active directly (what a sidebar click
        // does). Cross-chapter jumps refetch a fresh list and resolve via slideId.
        const target = useContentStore
            .getState()
            .items.find((s) => s.id === draft.slideId);
        if (target) useContentStore.getState().setActiveItem(target);
    };

    if (!open) return null;

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-lg"
            footer={
                <div className="flex w-full flex-col gap-3">
                    <p className="text-caption text-neutral-500">
                        {t('keptOnDeviceHint', { slideTerm })}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {mode === 'leave' ? (
                            <>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => onKeep?.()}
                                >
                                    {t('keepInBrowser')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    className="border-danger-400 text-danger-600 hover:bg-danger-50"
                                    onClick={() => onDiscard?.()}
                                >
                                    {t('discardChanges')}
                                </MyButton>
                            </>
                        ) : (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => onOpenChange(false)}
                            >
                                {t('close')}
                            </MyButton>
                        )}
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-600">
                        <Warning size={20} weight="fill" />
                    </span>
                    <p className="text-subtitle text-neutral-600">
                        {mode === 'leave'
                            ? t('unsavedEditsHintLeave', { slidesTermPlural })
                            : t('unsavedEditsHintReview', { slidesTermPlural })}
                    </p>
                </div>

                <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
                    {subjectGroups.map((subject) => (
                        <div key={subject.subjectId} className="flex flex-col gap-2">
                            {showSubjectHeaders && (
                                <p className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                    {subject.subjectName}
                                </p>
                            )}
                            {subject.modules.map((moduleGroup) => (
                                <div key={moduleGroup.moduleId} className="flex flex-col gap-1.5">
                                    <p className="text-caption font-semibold text-neutral-500">
                                        {moduleGroup.moduleName}
                                    </p>
                                    {moduleGroup.chapters.map((chapter) => (
                                        <div
                                            key={chapter.chapterId}
                                            className="flex flex-col gap-1 pl-3"
                                        >
                                            <p className="text-caption text-neutral-400">
                                                {chapter.chapterName}
                                            </p>
                                            {chapter.drafts.map((draft) => (
                                                <button
                                                    key={draft.slideId}
                                                    type="button"
                                                    onClick={() => jumpToSlide(draft)}
                                                    className="group flex w-full items-center gap-2 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-left transition-colors hover:border-warning-400 hover:bg-warning-100"
                                                >
                                                    <FileDoc className="size-4 shrink-0 text-warning-600" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-body font-medium text-neutral-700">
                                                            {draft.context?.slideTitle ||
                                                                t('untitled')}
                                                        </span>
                                                        <span className="block text-caption text-neutral-500">
                                                            {t('editedAgo', {
                                                                timeAgo: timeAgo(
                                                                    draft.savedAt,
                                                                    t
                                                                ),
                                                            })}
                                                        </span>
                                                    </span>
                                                    <ArrowSquareOut className="size-4 shrink-0 text-neutral-400 transition-colors group-hover:text-warning-600" />
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ))}
                    {drafts.length === 0 && (
                        <p className="py-4 text-center text-body text-neutral-400">
                            {t('noUnsavedChanges')}
                        </p>
                    )}
                </div>
            </div>
        </MyDialog>
    );
};
