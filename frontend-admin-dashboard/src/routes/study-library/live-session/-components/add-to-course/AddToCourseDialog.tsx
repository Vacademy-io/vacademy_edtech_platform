import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Notebook,
    ListChecks,
    LinkSimple,
    Info,
    FilePdf,
    NotePencil,
    CheckCircle,
    Plus,
    Trash,
    Exam,
} from '@phosphor-icons/react';

import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Checkbox } from '@/components/ui/checkbox';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import { getBase64FromUrl } from '@/components/common/export-offline/utils/utils';
import { cn } from '@/lib/utils';

import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { useModulesWithChaptersQuery } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import {
    canBulkUploadToCourse,
    loadRoleDisplayForBulk,
} from '@/components/common/study-library/bulk-content-uploading/course-edit-gate';
import type { DisplaySettingsData } from '@/types/display-settings';
import type { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';

import {
    useAddToCourse,
    type AddToCourseContent,
    type AddToCourseDestination,
    type AssessmentSlideMode,
    type NotesFormat,
} from './use-add-to-course';
import { countAnswerable } from './transformGeneratedQuestions';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    content: AddToCourseContent;
    /**
     * Provided by the notes flow: captures the already-rendered notes node to a
     * PDF blob (identical to the "Download PDF" output). When present, the PDF
     * slide is built from this instead of re-rasterising raw HTML, so it matches
     * the preview exactly.
     */
    capturePdf?: (opts?: {
        watermarkDataUrl?: string | null;
    }) => Promise<{ blob: Blob; totalPages: number }>;
    /**
     * Provided by the assessment flow: publishes the generated assessment (if not
     * already) and resolves to its assessmentId. Lets the "Assessment slide"
     * option create the native course assessment slide in one click — publishing
     * then linking — instead of requiring a separate manual publish.
     */
    publishAssessment?: (opts?: {
        packageSessionIds?: string[];
        skipBatchRegistration?: boolean;
    }) => Promise<string | null>;
    /**
     * The assessment's schedule/marking/visibility config form (the same
     * FormFields the normal Create-Assessment flow uses). Shown for the
     * publishing modes (Assessment slide / Assessment only) so the teacher sets
     * date/time/marks here instead of publishing with silent defaults.
     */
    assessmentConfig?: ReactNode;
    /**
     * The live class's linked batches. The first one's course/level/session is
     * pre-selected as the default destination, and they enable the resolver for
     * the "add to multiple courses" flow.
     */
    linkedBatches?: Array<{ package_session_id: string; package_name?: string }>;
}

interface AddedDestination {
    key: string;
    dest: AddToCourseDestination;
    label: string;
}

const toOptions = <T,>(
    items: T[],
    value: (t: T) => string,
    label: (t: T) => string
): SearchableSelectOption[] => items.map((t) => ({ value: value(t), label: label(t) }));

const stripHtml = (html: string) =>
    html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const looksLikeId = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s.trim());

/** Derive a human title — first notes heading, or a clean fallback (never a raw id). */
const deriveTitle = (content: AddToCourseContent, t: TFunction): string => {
    if (content.kind === 'NOTES') {
        const heading = (content.markdown || '').match(/^#{1,6}\s+(.+?)\s*$/m)?.[1];
        if (heading) {
            const clean = stripHtml(heading).slice(0, 120);
            if (clean && !looksLikeId(clean)) return clean;
        }
    }
    const suggested = content.suggestedTitle?.trim() ?? '';
    if (suggested && !looksLikeId(suggested)) return suggested;
    return content.kind === 'NOTES' ? t('defaultTitle.notes') : t('defaultTitle.assessment');
};

interface Cascade {
    courseId: string;
    sessionId: string;
    levelId: string;
    subjectId: string;
    moduleId: string;
    chapterId: string;
}
const EMPTY: Cascade = {
    courseId: '',
    sessionId: '',
    levelId: '',
    subjectId: '',
    moduleId: '',
    chapterId: '',
};

/**
 * Widget that pushes transcript-derived content (lecture notes or an AI
 * assessment) into a course slide. Opened from the recording-side flows.
 * Walks Course → Session → Level → Subject → Module → Chapter (each field is
 * searchable), then creates the right slide type via {@link useAddToCourse}.
 */
export function AddToCourseDialog({
    open,
    onOpenChange,
    content,
    capturePdf,
    publishAssessment,
    linkedBatches,
    assessmentConfig,
}: Props) {
    const { t } = useTranslation('studyLibraryAddToCourseDialog');
    const [sel, setSel] = useState<Cascade>(EMPTY);
    const [destinations, setDestinations] = useState<AddedDestination[]>([]);
    const [title, setTitle] = useState('');
    const [assessmentMode, setAssessmentMode] = useState<AssessmentSlideMode>('QUIZ');
    const [notesFormat, setNotesFormat] = useState<NotesFormat>('DOC');
    const [slideStatus, setSlideStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
    // Batches the published assessment registers to (Assessment-only mode).
    // Defaults to the live class's batches; the teacher can pick any others.
    const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
    const [watermark, setWatermark] = useState(false);
    const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    const [roleLoaded, setRoleLoaded] = useState(false);
    // Remembers the assessment id once published this session, so a retry after a
    // partial failure links the SAME assessment instead of publishing a new one.
    const [publishedAssessmentId, setPublishedAssessmentId] = useState<string | null>(null);

    const instituteLogo = useInstituteLogoStore((s) => s.instituteLogo);

    const { create, isCreating } = useAddToCourse();

    const studyLibraryData = useStudyLibraryStore((s) => s.studyLibraryData);
    const isInitLoading = useStudyLibraryStore((s) => s.isInitLoading);
    // Resolve the batch (package_session) from whichever source is populated:
    // institute details' batches_for_sessions first, then the course-init tree.
    const getPkgFromInstitute = useInstituteDetailsStore((s) => s.getPackageSessionId);
    const getPkgFromLibrary = useStudyLibraryStore((s) => s.getPackageSessionId);
    const getDetailsFromPackageSessionId = useInstituteDetailsStore(
        (s) => s.getDetailsFromPackageSessionId
    );
    const instituteBatches = useInstituteDetailsStore(
        (s) => s.instituteDetails?.batches_for_sessions
    );

    // All institute batches, for the "Assessment only" batch picker.
    const batchOptions = useMemo(
        () =>
            (instituteBatches ?? []).map((b) => ({
                value: b.id,
                label:
                    b.name?.trim() ||
                    `${b.package_dto?.package_name ?? ''} | ${b.level?.level_name ?? ''} | ${b.session?.session_name ?? ''}`,
            })),
        [instituteBatches]
    );
    const liveClassBatchIds = useMemo(
        () => (linkedBatches ?? []).map((b) => b.package_session_id),
        [linkedBatches]
    );

    // Pre-fill the cascade with the course/level/session of the live class (its
    // first linked batch), so the teacher starts in the right course. Keyed on
    // the package-session id (a stable string) so an unstable linkedBatches array
    // can't re-fire the open effect and reset the user's selection.
    const defaultPsId = linkedBatches?.[0]?.package_session_id;
    const defaultCascade = useMemo<Cascade>(() => {
        if (!defaultPsId) return EMPTY;
        const d = getDetailsFromPackageSessionId({ packageSessionId: defaultPsId });
        if (!d) return EMPTY;
        return {
            ...EMPTY,
            courseId: d.package_dto?.id ?? '',
            sessionId: d.session?.id ?? '',
            levelId: d.level?.id ?? '',
        };
        // instituteBatches is a dep so this recomputes once the store hydrates
        // (institute details can load AFTER the dialog opens).
    }, [defaultPsId, getDetailsFromPackageSessionId, instituteBatches]);

    // True once the teacher has manually changed the cascade, so we never clobber
    // their pick when the live-class default resolves late.
    const cascadeTouchedRef = useRef(false);

    // Ensure the institute's course tree is loaded (no-op if already cached).
    const studyLibraryQueryConfig = useStudyLibraryQuery();
    useQuery({ ...studyLibraryQueryConfig, enabled: open });

    // Fresh state each time the dialog opens for a new payload.
    useEffect(() => {
        if (!open) return;
        cascadeTouchedRef.current = false;
        setSel(defaultCascade);
        setDestinations([]);
        setTitle(deriveTitle(content, t));
        setAssessmentMode('QUIZ');
        setNotesFormat('DOC');
        setSlideStatus('DRAFT');
        setSelectedBatchIds(liveClassBatchIds);
        setWatermark(false);
        setPublishedAssessmentId(null);
        // Initialise ONLY on the open transition. content/defaultCascade/
        // liveClassBatchIds are read via closure — depending on them would reset
        // the user's selections whenever the parent re-renders (e.g. editing the
        // assessment schedule, which now lives inside this dialog, recreates the
        // inline `content` prop).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Apply the live-class default course once it resolves — institute details
    // can hydrate AFTER the dialog opened, leaving the cascade blank. Never
    // overrides a course the teacher has already picked.
    useEffect(() => {
        if (!open || cascadeTouchedRef.current) return;
        if (defaultCascade.courseId && !sel.courseId) {
            setSel(defaultCascade);
        }
    }, [open, defaultCascade, sel.courseId]);

    // Resolve the institute logo to a base64 data URL (html2canvas/jsPDF can't
    // reliably read remote <img> due to CORS) for the optional PDF watermark.
    useEffect(() => {
        if (!open || !instituteLogo) {
            setLogoDataUrl(null);
            return;
        }
        let cancelled = false;
        getBase64FromUrl(instituteLogo)
            .then((b64) => {
                if (!cancelled) setLogoDataUrl((b64 as string) ?? null);
            })
            .catch(() => {
                if (!cancelled) setLogoDataUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [open, instituteLogo]);

    // Load the role's display settings once, to gate published-course edits.
    useEffect(() => {
        if (!open) return;
        let active = true;
        setRoleLoaded(false);
        loadRoleDisplayForBulk().then((d) => {
            if (!active) return;
            setRoleDisplay(d);
            setRoleLoaded(true);
        });
        return () => {
            active = false;
        };
    }, [open]);

    // ---- Derived cascade data ------------------------------------------------
    const selectedCourse = useMemo(
        () => studyLibraryData?.find((c) => c.course.id === sel.courseId) ?? null,
        [studyLibraryData, sel.courseId]
    );
    const sessions = selectedCourse?.sessions ?? [];
    const selectedSession = sessions.find((s) => s.session_dto.id === sel.sessionId) ?? null;
    const levels = selectedSession?.level_with_details ?? [];
    const selectedLevel = levels.find((l) => l.id === sel.levelId) ?? null;
    const subjects = selectedLevel?.subjects ?? [];

    const packageSessionId = useMemo(() => {
        if (!sel.courseId || !sel.sessionId || !sel.levelId) return null;
        const params = { courseId: sel.courseId, sessionId: sel.sessionId, levelId: sel.levelId };
        return getPkgFromInstitute(params) || getPkgFromLibrary(params) || null;
    }, [sel.courseId, sel.sessionId, sel.levelId, getPkgFromInstitute, getPkgFromLibrary]);

    const modulesQuery = useModulesWithChaptersQuery(sel.subjectId, packageSessionId ?? '');
    const modules = (modulesQuery.data as ModulesWithChapters[] | undefined) ?? [];
    const selectedModule = modules.find((m) => m.module.id === sel.moduleId) ?? null;
    const chapters = selectedModule?.chapters ?? [];

    // In shallow (non-5-depth) courses the intermediate levels collapse to a
    // single DEFAULT entry. Auto-pick any structural level that has exactly one
    // option (and hide that field below), so the user only chooses what actually
    // varies — plus the destination chapter.
    useEffect(() => {
        if (!sel.courseId) return;
        if (!sel.sessionId) {
            if (sessions.length === 1)
                setSel((s) => ({
                    ...s,
                    sessionId: sessions[0]!.session_dto.id,
                    levelId: '',
                    subjectId: '',
                    moduleId: '',
                    chapterId: '',
                }));
            return;
        }
        if (!sel.levelId) {
            if (levels.length === 1)
                setSel((s) => ({
                    ...s,
                    levelId: levels[0]!.id,
                    subjectId: '',
                    moduleId: '',
                    chapterId: '',
                }));
            return;
        }
        if (!sel.subjectId) {
            if (subjects.length === 1)
                setSel((s) => ({ ...s, subjectId: subjects[0]!.id, moduleId: '', chapterId: '' }));
            return;
        }
        if (!sel.moduleId && packageSessionId && modules.length === 1) {
            setSel((s) => ({ ...s, moduleId: modules[0]!.module.id, chapterId: '' }));
        }
    }, [sel, sessions, levels, subjects, modules, packageSessionId]);

    // Only surface a structural selector when it offers a real choice.
    const showSession = sessions.length > 1;
    const showLevel = levels.length > 1;
    const showSubject = subjects.length > 1;
    const showModule = modules.length > 1;

    // ---- Cascade setters (reset descendants on change) -----------------------
    // touch() marks the cascade as user-driven so the late-default effect backs off.
    const touch = () => {
        cascadeTouchedRef.current = true;
    };
    const setCourse = (v: string) => {
        touch();
        setSel({ ...EMPTY, courseId: v });
    };
    const setSession = (v: string) => {
        touch();
        setSel((s) => ({ ...s, sessionId: v, levelId: '', subjectId: '', moduleId: '', chapterId: '' }));
    };
    const setLevel = (v: string) => {
        touch();
        setSel((s) => ({ ...s, levelId: v, subjectId: '', moduleId: '', chapterId: '' }));
    };
    const setSubject = (v: string) => {
        touch();
        setSel((s) => ({ ...s, subjectId: v, moduleId: '', chapterId: '' }));
    };
    const setModule = (v: string) => {
        touch();
        setSel((s) => ({ ...s, moduleId: v, chapterId: '' }));
    };
    const setChapter = (v: string) => {
        touch();
        setSel((s) => ({ ...s, chapterId: v }));
    };

    // ---- Permission ----------------------------------------------------------
    const permission = useMemo(
        () =>
            selectedCourse
                ? canBulkUploadToCourse(
                      selectedCourse.course,
                      roleDisplay,
                      getTerminology(ContentTerms.Course, SystemTerms.Course)
                  )
                : { allowed: true as boolean, reason: undefined as string | undefined },
        [selectedCourse, roleDisplay]
    );
    const permissionBlocked = roleLoaded && !!selectedCourse && !permission.allowed;

    // ---- Submit gating -------------------------------------------------------
    const isNotes = content.kind === 'NOTES';
    const questionCount = isNotes ? 0 : content.questions?.length ?? 0;
    const answerableCount = isNotes ? 0 : countAnswerable(content.questions ?? []);
    const assessmentId = isNotes ? null : content.assessmentId ?? null;

    const contentReady = isNotes ? !!content.markdown?.trim() : questionCount > 0;
    // The link path is blocked only when there's no published assessment AND no
    // way to publish one. With publishAssessment available we publish-then-link.
    const canLinkAssessment = !!assessmentId || !!publishAssessment;
    const linkNeedsPublish = !isNotes && assessmentMode === 'ASSESSMENT' && !canLinkAssessment;

    // The current cascade selection counts as a destination once complete and
    // permitted. Combine it with the explicitly-added list, deduped by chapter,
    // and carry a "Course › Chapter" label so the targets are clearly visible.
    // Wait for the role's permissions to load before a destination counts as
    // valid — otherwise a permission-blocked course could be added/created in the
    // brief window where permission defaults to "allowed".
    const currentDestComplete =
        roleLoaded && !!sel.chapterId && !!packageSessionId && !permissionBlocked;
    const combinedDestinations = useMemo<AddedDestination[]>(() => {
        const list: AddedDestination[] = [];
        if (currentDestComplete && packageSessionId) {
            const courseName = selectedCourse?.course.package_name ?? t('fields.course');
            const chapterName =
                chapters.find((c) => c.chapter.id === sel.chapterId)?.chapter.chapter_name ??
                t('fields.chapter');
            list.push({
                // A chapter can be shared across batches, so the destination key
                // is chapter + package_session, not chapter alone.
                key: `${sel.chapterId}::${packageSessionId}`,
                dest: {
                    chapterId: sel.chapterId,
                    moduleId: sel.moduleId,
                    subjectId: sel.subjectId,
                    packageSessionId,
                },
                label: `${courseName} › ${chapterName}`,
            });
        }
        destinations.forEach((d) => list.push(d));
        return list.filter(
            (d, i, arr) =>
                arr.findIndex(
                    (x) =>
                        x.dest.chapterId === d.dest.chapterId &&
                        x.dest.packageSessionId === d.dest.packageSessionId
                ) === i
        );
    }, [currentDestComplete, packageSessionId, sel, destinations, selectedCourse, chapters, t]);
    const allDestinations = useMemo<AddToCourseDestination[]>(
        () => combinedDestinations.map((d) => d.dest),
        [combinedDestinations]
    );

    // "Assessment only" publishes to the Assessment Center without any slide, so
    // it needs no destination — just a way to publish (or an already-published id).
    const isAssessmentOnly = !isNotes && assessmentMode === 'ASSESSMENT_ONLY';
    const canPublishOnly = !!publishAssessment || !!assessmentId;

    const canCreate = isAssessmentOnly
        ? contentReady && canPublishOnly && !isCreating
        : allDestinations.length > 0 && contentReady && !linkNeedsPublish && !isCreating;

    const addCurrentDestination = () => {
        if (!currentDestComplete || !packageSessionId) return;
        const chapterName =
            chapters.find((c) => c.chapter.id === sel.chapterId)?.chapter.chapter_name ??
            t('fields.chapter');
        const courseName = selectedCourse?.course.package_name ?? t('fields.course');
        const key = `${sel.chapterId}::${packageSessionId}`;
        setDestinations((prev) =>
            prev.some((d) => d.key === key)
                ? prev
                : [
                      ...prev,
                      {
                          key,
                          dest: {
                              chapterId: sel.chapterId,
                              moduleId: sel.moduleId,
                              subjectId: sel.subjectId,
                              packageSessionId,
                          },
                          label: `${courseName} › ${chapterName}`,
                      },
                  ]
        );
        // Restart from the live-class course so adding to another chapter is quick.
        cascadeTouchedRef.current = false;
        setSel(defaultCascade);
    };
    const removeDestination = (key: string) =>
        setDestinations((prev) => prev.filter((d) => d.key !== key));

    const handleCreate = async () => {
        // "Assessment only" — publish to the Assessment Center, create no slide.
        if (content.kind === 'ASSESSMENT' && assessmentMode === 'ASSESSMENT_ONLY') {
            try {
                let id = content.assessmentId ?? publishedAssessmentId;
                if (!id && publishAssessment) {
                    id = await publishAssessment({
                        // The picker drives the batches exactly: skip the live
                        // class default and register only the selected batches.
                        packageSessionIds: selectedBatchIds,
                        skipBatchRegistration: true,
                    });
                    setPublishedAssessmentId(id);
                }
                if (!id) throw new Error(t('toast.couldNotPublish'));
                toast.success(
                    selectedBatchIds.length > 0
                        ? t('toast.publishedToAssessmentCenter', { count: selectedBatchIds.length })
                        : t('toast.publishedUnassigned')
                );
                onOpenChange(false);
            } catch (e) {
                toast.error(
                    e instanceof Error ? e.message : t('toast.couldNotPublish')
                );
            }
            return;
        }

        if (allDestinations.length === 0) return;
        try {
            // For a PDF notes slide, capture the rendered notes node here (same
            // output as Download PDF) and hand the hook a ready file.
            let pdfFile: File | undefined;
            let pdfTotalPages: number | undefined;
            if (isNotes && notesFormat === 'PDF' && capturePdf) {
                const { blob, totalPages } = await capturePdf({
                    watermarkDataUrl: watermark ? logoDataUrl : undefined,
                });
                pdfFile = new File([blob], `${(title || 'notes').trim()}.pdf`, {
                    type: 'application/pdf',
                });
                pdfTotalPages = totalPages;
            }

            // Assessment slide: ensure a published assessment to link. Publish on
            // the fly when the user picked "Assessment slide" before publishing.
            // Reuse a previously-published id (this session) so a retry after a
            // partial failure links the same assessment instead of re-publishing.
            let effectiveContent = content;
            if (content.kind === 'ASSESSMENT' && assessmentMode === 'ASSESSMENT') {
                let linkedId = content.assessmentId ?? publishedAssessmentId;
                if (!linkedId && publishAssessment) {
                    // Register the assessment to every destination course's batch
                    // so it's takeable there (not just the live class's batches).
                    const destPackageSessionIds = allDestinations.map(
                        (d) => d.packageSessionId
                    );
                    linkedId = await publishAssessment({
                        packageSessionIds: destPackageSessionIds,
                    });
                    if (!linkedId) throw new Error(t('toast.couldNotPublish'));
                    setPublishedAssessmentId(linkedId);
                }
                if (linkedId) effectiveContent = { ...content, assessmentId: linkedId };
            }

            const { createdIds, failed } = await create({
                destinations: allDestinations,
                title,
                content: effectiveContent,
                assessmentMode,
                notesFormat,
                status: slideStatus,
                watermarkDataUrl:
                    isNotes && notesFormat === 'PDF' && watermark ? logoDataUrl : undefined,
                pdfFile,
                pdfTotalPages,
            });

            if (failed.length > 0) {
                // Some chapters succeeded, some failed. Keep the dialog open but
                // narrow the destination list to ONLY the failed chapters, so a
                // retry can't re-create (duplicate) the ones that already landed.
                const failedKeys = new Set(
                    failed.map((d) => `${d.chapterId}::${d.packageSessionId}`)
                );
                setDestinations(
                    combinedDestinations.filter((d) =>
                        failedKeys.has(`${d.dest.chapterId}::${d.dest.packageSessionId}`)
                    )
                );
                cascadeTouchedRef.current = false;
                setSel(defaultCascade);
                toast.warning(
                    t('toast.addedPartial', { added: createdIds.length, failed: failed.length })
                );
                return;
            }

            const names = combinedDestinations.map((d) => d.label);
            const summary =
                names.length <= 2
                    ? names.join(', ')
                    : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
            toast.success(
                t('toast.addedSuccess', {
                    summary: summary || t('toast.chapterCount', { count: createdIds.length }),
                })
            );
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('toast.couldNotAdd'));
        }
    };

    const destinationLabel = isNotes
        ? notesFormat === 'PDF'
            ? t('destinationLabel.notesPdf')
            : t('destinationLabel.notesDoc')
        : assessmentMode === 'QUIZ'
          ? t('destinationLabel.quiz')
          : assessmentMode === 'ASSESSMENT_ONLY'
            ? t('destinationLabel.assessmentOnly')
            : t('destinationLabel.assessment');

    return (
        <MyDialog
            heading={t('dialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!canCreate}
                        onAsyncClick={handleCreate}
                        loadingText={
                            isAssessmentOnly
                                ? t('dialog.loading.publishing')
                                : isNotes && notesFormat === 'PDF'
                                  ? t('dialog.loading.renderingPdf')
                                  : !isNotes && assessmentMode === 'ASSESSMENT' && !assessmentId
                                    ? t('dialog.loading.publishing')
                                    : t('dialog.loading.adding')
                        }
                    >
                        {isAssessmentOnly ? t('dialog.publishAssessment') : t('dialog.createSlide')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                {/* What's being added */}
                <div className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/40 px-3 py-2.5">
                    {isNotes ? (
                        <Notebook className="size-5 shrink-0 text-primary-500" weight="duotone" />
                    ) : (
                        <ListChecks className="size-5 shrink-0 text-primary-500" weight="duotone" />
                    )}
                    <div className="flex flex-col">
                        <span className="text-body font-semibold text-neutral-700">
                            {destinationLabel}
                        </span>
                        {!isNotes && (
                            <span className="text-caption text-neutral-500">
                                {t('questionCount', { count: questionCount })}
                                {questionCount > 0 && answerableCount < questionCount
                                    ? t('withoutMarkedAnswer', {
                                          count: questionCount - answerableCount,
                                      })
                                    : ''}
                            </span>
                        )}
                    </div>
                </div>

                {/* Title (slide only) */}
                {!isAssessmentOnly && (
                    <MyInput
                        inputType="text"
                        label={t('slideTitleLabel')}
                        inputPlaceholder={t('slideTitlePlaceholder')}
                        input={title}
                        onChangeFunction={(e) => setTitle(e.target.value)}
                        size="large"
                        className="w-full sm:w-full"
                        required
                    />
                )}

                {/* Notes format selector */}
                {isNotes && (
                    <div className="flex flex-col gap-2">
                        <span className="text-body font-semibold text-neutral-600">{t('addAs')}</span>
                        <div className="flex flex-wrap gap-2">
                            <ModeButton
                                active={notesFormat === 'DOC'}
                                icon={<Notebook className="size-4" />}
                                label={t('notesFormat.docLabel')}
                                hint={t('notesFormat.docHint')}
                                onClick={() => setNotesFormat('DOC')}
                            />
                            <ModeButton
                                active={notesFormat === 'PDF'}
                                icon={<FilePdf className="size-4" />}
                                label={t('notesFormat.pdfLabel')}
                                hint={t('notesFormat.pdfHint')}
                                onClick={() => setNotesFormat('PDF')}
                            />
                        </div>
                        {notesFormat === 'PDF' && (
                            <label
                                className={cn(
                                    'flex items-center gap-2 text-body text-neutral-700',
                                    !logoDataUrl && 'cursor-not-allowed opacity-60'
                                )}
                            >
                                <Checkbox
                                    checked={watermark}
                                    onCheckedChange={(v) => setWatermark(v === true)}
                                    disabled={!logoDataUrl}
                                />
                                {t('watermark.label')}
                                {!logoDataUrl && (
                                    <span className="text-caption text-neutral-400">
                                        {t('watermark.noLogo')}
                                    </span>
                                )}
                            </label>
                        )}
                    </div>
                )}

                {/* Assessment slide type selector */}
                {!isNotes && (
                    <div className="flex flex-col gap-2">
                        <span className="text-body font-semibold text-neutral-600">{t('addAs')}</span>
                        <div className="flex flex-wrap gap-2">
                            <ModeButton
                                active={assessmentMode === 'QUIZ'}
                                icon={<ListChecks className="size-4" />}
                                label={t('assessmentMode.quizLabel')}
                                hint={t('assessmentMode.quizHint')}
                                onClick={() => setAssessmentMode('QUIZ')}
                            />
                            <ModeButton
                                active={assessmentMode === 'ASSESSMENT'}
                                icon={<LinkSimple className="size-4" />}
                                label={t('assessmentMode.assessmentLabel')}
                                hint={
                                    assessmentId
                                        ? t('assessmentMode.assessmentHintLinked')
                                        : publishAssessment
                                          ? t('assessmentMode.assessmentHintPublishThenLink')
                                          : t('assessmentMode.assessmentHintPublishFirst')
                                }
                                disabled={!canLinkAssessment}
                                onClick={() => setAssessmentMode('ASSESSMENT')}
                            />
                            <ModeButton
                                active={assessmentMode === 'ASSESSMENT_ONLY'}
                                icon={<Exam className="size-4" />}
                                label={t('assessmentMode.onlyLabel')}
                                hint={t('assessmentMode.onlyHint')}
                                disabled={!canPublishOnly}
                                onClick={() => setAssessmentMode('ASSESSMENT_ONLY')}
                            />
                        </div>
                        {assessmentMode === 'ASSESSMENT' && !assessmentId && publishAssessment && (
                            <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <Info className="size-3.5" />
                                {t('publishNote')}
                            </p>
                        )}
                        {isAssessmentOnly && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-body font-medium text-neutral-600">
                                    {t('assignToBatches')}
                                </span>
                                <MultiSelect
                                    options={batchOptions}
                                    selected={selectedBatchIds}
                                    onChange={setSelectedBatchIds}
                                    placeholder={t('selectBatchesPlaceholder')}
                                />
                                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                    <Info className="size-3.5 shrink-0" />
                                    {selectedBatchIds.length > 0
                                        ? t('batchInfo', { count: selectedBatchIds.length })
                                        : t('noBatchSelected')}
                                </p>
                            </div>
                        )}
                        {linkNeedsPublish && (
                            <p className="flex items-center gap-1.5 text-caption text-warning-600">
                                <Info className="size-3.5" />
                                {t('linkNeedsPublish')}
                            </p>
                        )}
                    </div>
                )}

                {/* Assessment schedule + marking — shown for the modes that
                    publish (Assessment slide / Assessment only), so the teacher
                    sets date/time/marks rather than publishing with defaults. */}
                {!isNotes &&
                    (assessmentMode === 'ASSESSMENT' || assessmentMode === 'ASSESSMENT_ONLY') &&
                    assessmentConfig && (
                        <div className="flex flex-col gap-2">
                            <span className="text-body font-semibold text-neutral-600">
                                {t('scheduleAndMarking')}
                            </span>
                            <div className="rounded-lg border border-neutral-200 p-3">
                                {assessmentConfig}
                            </div>
                        </div>
                    )}

                {/* Slide publish state (slide only) */}
                {!isAssessmentOnly && (
                    <div className="flex flex-col gap-2">
                        <span className="text-body font-semibold text-neutral-600">{t('saveAs')}</span>
                        <div className="flex flex-wrap gap-2">
                            <ModeButton
                                active={slideStatus === 'DRAFT'}
                                icon={<NotePencil className="size-4" />}
                                label={t('status.draftLabel')}
                                hint={t('status.draftHint')}
                                onClick={() => setSlideStatus('DRAFT')}
                            />
                            <ModeButton
                                active={slideStatus === 'PUBLISHED'}
                                icon={<CheckCircle className="size-4" />}
                                label={t('status.publishedLabel')}
                                hint={t('status.publishedHint')}
                                onClick={() => setSlideStatus('PUBLISHED')}
                            />
                        </div>
                    </div>
                )}

                {/* Destination cascade (slide only) */}
                {!isAssessmentOnly && (
                <div className="flex flex-col gap-2">
                    <span className="text-body font-semibold text-neutral-600">{t('destination')}</span>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <CascadeField
                            label={t('fields.course')}
                            placeholder={t('fields.selectCourse')}
                            value={sel.courseId}
                            onChange={setCourse}
                            disabled={!studyLibraryData || isInitLoading}
                            options={toOptions(
                                studyLibraryData ?? [],
                                (c) => c.course.id,
                                (c) => c.course.package_name
                            )}
                        />
                        {showSession && (
                            <CascadeField
                                label={t('fields.session')}
                                placeholder={t('fields.selectSession')}
                                value={sel.sessionId}
                                onChange={setSession}
                                disabled={!sel.courseId}
                                options={toOptions(
                                    sessions,
                                    (s) => s.session_dto.id,
                                    (s) => s.session_dto.session_name
                                )}
                            />
                        )}
                        {showLevel && (
                            <CascadeField
                                label={t('fields.level')}
                                placeholder={t('fields.selectLevel')}
                                value={sel.levelId}
                                onChange={setLevel}
                                disabled={!sel.sessionId}
                                options={toOptions(
                                    levels,
                                    (l) => l.id,
                                    (l) => l.name
                                )}
                            />
                        )}
                        {showSubject && (
                            <CascadeField
                                label={t('fields.subject')}
                                placeholder={t('fields.selectSubject')}
                                value={sel.subjectId}
                                onChange={setSubject}
                                disabled={!sel.levelId}
                                options={toOptions(
                                    subjects,
                                    (s) => s.id,
                                    (s) => s.subject_name
                                )}
                            />
                        )}
                        {showModule && (
                            <CascadeField
                                label={t('fields.module')}
                                placeholder={t('fields.selectModule')}
                                value={sel.moduleId}
                                onChange={setModule}
                                disabled={
                                    !sel.subjectId || !packageSessionId || modulesQuery.isLoading
                                }
                                options={toOptions(
                                    modules,
                                    (m) => m.module.id,
                                    (m) => m.module.module_name
                                )}
                            />
                        )}
                        <CascadeField
                            label={t('fields.chapter')}
                            placeholder={t('fields.selectChapter')}
                            value={sel.chapterId}
                            onChange={setChapter}
                            disabled={!sel.moduleId}
                            options={toOptions(
                                chapters,
                                (c) => c.chapter.id,
                                (c) => c.chapter.chapter_name
                            )}
                        />
                    </div>

                    {permissionBlocked && permission.reason ? (
                        <p className="flex items-center gap-1.5 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-caption text-danger-600">
                            <Info className="size-3.5 shrink-0" />
                            {permission.reason}
                        </p>
                    ) : (
                        !sel.chapterId && (
                            <p className="text-caption text-neutral-500">
                                {t('pickChapter')}
                            </p>
                        )
                    )}

                    {/* Add the same slide to more courses/chapters. */}
                    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body font-semibold text-neutral-700">
                                {allDestinations.length > 0
                                    ? t('addingToCourses', { count: allDestinations.length })
                                    : t('selectChapterAbove')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disable={!currentDestComplete}
                                onClick={addCurrentDestination}
                            >
                                <Plus className="mr-1 size-3.5" />
                                {t('addAnotherCourse')}
                            </MyButton>
                        </div>
                        {combinedDestinations.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                {combinedDestinations.map((d) => {
                                    const isAdded = destinations.some((x) => x.key === d.key);
                                    return (
                                        <div
                                            key={d.key}
                                            className="flex items-center justify-between gap-2 rounded-md border border-primary-100 bg-primary-50/40 px-3 py-1.5"
                                        >
                                            <span className="min-w-0 truncate text-body text-neutral-700">
                                                {d.label}
                                            </span>
                                            {isAdded ? (
                                                <button
                                                    type="button"
                                                    onClick={() => removeDestination(d.key)}
                                                    className="shrink-0 text-neutral-400 transition-colors hover:text-danger-600"
                                                    aria-label={t('removeDestination')}
                                                >
                                                    <Trash className="size-4" />
                                                </button>
                                            ) : (
                                                <span className="shrink-0 text-caption text-neutral-400">
                                                    {t('fromSelection')}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                )}

                {/* Preview */}
                <div className="flex flex-col gap-2">
                    <span className="text-body font-semibold text-neutral-600">{t('preview')}</span>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
                        {isNotes ? (
                            <div className="flex flex-col gap-2 text-body leading-relaxed text-neutral-700 [&_h1]:text-h3 [&_h1]:font-semibold [&_h2]:text-subtitle [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-200 [&_th]:bg-neutral-50 [&_th]:px-2 [&_th]:py-1">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {content.markdown || t('noNotesContent')}
                                </ReactMarkdown>
                            </div>
                        ) : questionCount === 0 ? (
                            <p className="text-body text-neutral-500">{t('noQuestions')}</p>
                        ) : (
                            <ol className="flex flex-col gap-4">
                                {(content.questions ?? []).map((q, i) => (
                                    <li key={q.id || i} className="flex flex-col gap-1.5">
                                        <div className="flex gap-2 text-body font-medium text-neutral-800">
                                            <span className="shrink-0 text-neutral-500">
                                                {i + 1}.
                                            </span>
                                            <span>
                                                {stripHtml(q.question) || t('untitledQuestion')}
                                            </span>
                                        </div>
                                        {q.options && q.options.length > 0 && (
                                            <ul className="ml-6 flex flex-col gap-1">
                                                {q.options.map((opt, j) => {
                                                    const correct = j === q.correctAnswerIndex;
                                                    return (
                                                        <li
                                                            key={j}
                                                            className={cn(
                                                                'flex items-start gap-1.5 text-caption',
                                                                correct
                                                                    ? 'font-semibold text-success-700'
                                                                    : 'text-neutral-600'
                                                            )}
                                                        >
                                                            <span className="shrink-0">
                                                                {String.fromCharCode(65 + j)}.
                                                            </span>
                                                            <span className="min-w-0">
                                                                {stripHtml(opt) || '—'}
                                                            </span>
                                                            {correct && (
                                                                <CheckCircle
                                                                    weight="fill"
                                                                    className="ml-0.5 size-3.5 shrink-0 text-success-600"
                                                                />
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                        {q.explanation && stripHtml(q.explanation) && (
                                            <p className="ml-6 text-caption italic text-neutral-500">
                                                {stripHtml(q.explanation)}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            </div>
        </MyDialog>
    );
}

function CascadeField({
    label,
    placeholder,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    placeholder: string;
    options: SearchableSelectOption[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation('studyLibraryAddToCourseDialog');
    return (
        <div className="flex w-full flex-col gap-1.5">
            <label className="text-body font-medium text-neutral-600">
                {label}
                <span className="text-danger-600">*</span>
            </label>
            <SearchableSelect
                options={options}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                searchPlaceholder={t('searchPlaceholder', { field: label.toLowerCase() })}
                emptyText={t('noMatches')}
                disabled={disabled}
            />
        </div>
    );
}

function ModeButton({
    active,
    icon,
    label,
    hint,
    disabled,
    onClick,
}: {
    active: boolean;
    icon: React.ReactNode;
    label: string;
    hint: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'flex min-w-40 flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                active
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 bg-white hover:border-primary-300',
                disabled && 'cursor-not-allowed opacity-50 hover:border-neutral-200'
            )}
        >
            <span
                className={cn(
                    'flex items-center gap-1.5 text-body font-semibold',
                    active ? 'text-primary-600' : 'text-neutral-700'
                )}
            >
                {icon}
                {label}
            </span>
            <span className="text-caption text-neutral-500">{hint}</span>
        </button>
    );
}
