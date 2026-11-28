import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info, PencilSimple } from '@phosphor-icons/react';

import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { MyButton } from '@/components/design-system/button';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { useModulesWithChaptersQuery } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import type { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';
import type { LiveSessionSettings } from '@/services/live-session-settings';

type Destination = NonNullable<LiveSessionSettings['lmsConnection']['autoUploadDefaultDestination']>;

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

const toOptions = <T,>(
    items: T[],
    value: (item: T) => string,
    label: (item: T) => string
): SearchableSelectOption[] => items.map((item) => ({ value: value(item), label: label(item) }));

/**
 * Institute-wide Course → Session → Level → Subject → Module → Chapter
 * cascade used to pick the fallback destination for auto-uploaded recordings
 * (see docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md, Phase 2). Mirrors the
 * cascade in AddToCourseDialog but is a small dedicated component — it only
 * emits `{ packageSessionId, subjectId, moduleId, chapterId }`, it doesn't
 * create any content.
 */
export function DefaultRecordingDestinationPicker({
    value,
    onChange,
}: {
    value: Destination | null | undefined;
    onChange: (next: Destination | null) => void;
}) {
    const { t } = useTranslation('settingsDefaultRecordingDestination');
    const [sel, setSel] = useState<Cascade>(EMPTY);
    // Once a saved destination has been hydrated into the cascade, show a
    // collapsed summary line instead of the full picker until "Change" is
    // clicked. Starts collapsed whenever a value already exists.
    const [editing, setEditing] = useState(!value?.chapterId);
    const hydratedRef = useRef(false);

    const studyLibraryData = useStudyLibraryStore((s) => s.studyLibraryData);
    const isInitLoading = useStudyLibraryStore((s) => s.isInitLoading);
    const getPkgFromInstitute = useInstituteDetailsStore((s) => s.getPackageSessionId);
    const getPkgFromLibrary = useStudyLibraryStore((s) => s.getPackageSessionId);
    const getDetailsFromPackageSessionId = useInstituteDetailsStore(
        (s) => s.getDetailsFromPackageSessionId
    );
    const instituteBatches = useInstituteDetailsStore(
        (s) => s.instituteDetails?.batches_for_sessions
    );

    // Ensure the institute's course tree is loaded (no-op if already cached).
    const studyLibraryQueryConfig = useStudyLibraryQuery();
    useQuery(studyLibraryQueryConfig);

    // Hydrate the cascade's course/session/level from the saved
    // packageSessionId once institute details are available. Only runs once
    // so it doesn't clobber the admin's in-progress edits.
    useEffect(() => {
        if (hydratedRef.current) return;
        if (!value?.packageSessionId) {
            hydratedRef.current = true;
            return;
        }
        const d = getDetailsFromPackageSessionId({ packageSessionId: value.packageSessionId });
        if (!d) return; // institute details not hydrated yet — retry on next render
        hydratedRef.current = true;
        setSel({
            courseId: d.package_dto?.id ?? '',
            sessionId: d.session?.id ?? '',
            levelId: d.level?.id ?? '',
            subjectId: value.subjectId ?? '',
            moduleId: value.moduleId ?? '',
            chapterId: value.chapterId,
        });
    }, [value, getDetailsFromPackageSessionId, instituteBatches]);

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

    // Auto-collapse structural levels that have exactly one option (shallow
    // courses), matching AddToCourseDialog's course-depth handling.
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

    const showSession = sessions.length > 1;
    const showLevel = levels.length > 1;
    const showSubject = subjects.length > 1;
    const showModule = modules.length > 1;

    const setCourse = (v: string) => setSel({ ...EMPTY, courseId: v });
    const setSession = (v: string) =>
        setSel((s) => ({ ...s, sessionId: v, levelId: '', subjectId: '', moduleId: '', chapterId: '' }));
    const setLevel = (v: string) =>
        setSel((s) => ({ ...s, levelId: v, subjectId: '', moduleId: '', chapterId: '' }));
    const setSubject = (v: string) => setSel((s) => ({ ...s, subjectId: v, moduleId: '', chapterId: '' }));
    const setModule = (v: string) => setSel((s) => ({ ...s, moduleId: v, chapterId: '' }));
    const setChapter = (v: string) => {
        setSel((s) => ({ ...s, chapterId: v }));
        if (v && packageSessionId) {
            onChange({
                packageSessionId,
                subjectId: sel.subjectId || null,
                moduleId: sel.moduleId || null,
                chapterId: v,
            });
            setEditing(false);
        }
    };

    // Summary line shown when collapsed.
    const summary = useMemo(() => {
        if (!value?.chapterId) return null;
        const courseName = selectedCourse?.course.package_name ?? '';
        const chapterName =
            chapters.find((c) => c.chapter.id === value.chapterId)?.chapter.chapter_name ?? '';
        const parts = [courseName, selectedLevel?.name, chapterName].filter(Boolean);
        return parts.length > 0 ? parts.join(' › ') : t('summary.fallback');
    }, [value, selectedCourse, selectedLevel, chapters, t]);

    if (!editing && value?.chapterId) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                <span className="min-w-0 truncate text-caption text-neutral-700">
                    {t('summary.prefix')} <span className="font-medium">{summary}</span>
                </span>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    onClick={() => setEditing(true)}
                >
                    <PencilSimple className="mr-1 size-3.5" />
                    {t('button.change')}
                </MyButton>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CascadeField
                    label={t('cascadeField.labels.course')}
                    placeholder={t('cascadeField.placeholders.course')}
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
                        label={t('cascadeField.labels.session')}
                        placeholder={t('cascadeField.placeholders.session')}
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
                        label={t('cascadeField.labels.level')}
                        placeholder={t('cascadeField.placeholders.level')}
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
                        label={t('cascadeField.labels.subject')}
                        placeholder={t('cascadeField.placeholders.subject')}
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
                        label={t('cascadeField.labels.module')}
                        placeholder={t('cascadeField.placeholders.module')}
                        value={sel.moduleId}
                        onChange={setModule}
                        disabled={!sel.subjectId || !packageSessionId || modulesQuery.isLoading}
                        options={toOptions(
                            modules,
                            (m) => m.module.id,
                            (m) => m.module.module_name
                        )}
                    />
                )}
                <CascadeField
                    label={t('cascadeField.labels.chapter')}
                    placeholder={t('cascadeField.placeholders.chapter')}
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
            {!value?.chapterId && (
                <p className="flex items-center gap-1.5 text-caption text-amber-600">
                    <Info size={14} />
                    {t('noDefaultSet')}
                </p>
            )}
        </div>
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
    const { t } = useTranslation('settingsDefaultRecordingDestination');
    return (
        <div className="flex w-full flex-col gap-1">
            <label className="text-caption font-medium text-neutral-600">{label}</label>
            <SearchableSelect
                options={options}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                searchPlaceholder={t('cascadeField.searchPlaceholder', {
                    label: label.toLowerCase(),
                })}
                emptyText={t('cascadeField.emptyText')}
                disabled={disabled}
                triggerClassName="h-9 text-caption"
            />
        </div>
    );
}
