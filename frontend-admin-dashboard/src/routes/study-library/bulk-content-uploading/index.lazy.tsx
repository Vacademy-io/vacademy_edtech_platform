// Standalone Bulk Content Upload page: pick the target course/session/level,
// then run the shared bulk-upload wizard against it.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { isBulkContentUploadEnabled } from '@/components/common/study-library/bulk-content-uploading/feature-gate';
import { Helmet } from 'react-helmet';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { InitStudyLibraryProvider } from '@/providers/study-library/init-study-library-provider';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { UploadMode } from '@/components/common/study-library/bulk-content-uploading/types';
import { BulkContentUploadingWizard } from '@/components/common/study-library/bulk-content-uploading/bulk-content-uploading-wizard';
import { useBulkContentUploadingStore } from '@/components/common/study-library/bulk-content-uploading/use-bulk-content-uploading-store';
import type { BulkUploadContext } from '@/components/common/study-library/bulk-content-uploading/types';

export const Route = createLazyFileRoute('/study-library/bulk-content-uploading/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryBulkContentUploadingIndex');
    const navigate = useNavigate();
    const enabled = isBulkContentUploadEnabled();

    // Hidden by default for all institutes — direct URL hits bounce to courses.
    useEffect(() => {
        if (!enabled) {
            void navigate({ to: '/study-library/courses' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    if (!enabled) return null;

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <InitStudyLibraryProvider>
                <BulkContentUploadingPage />
            </InitStudyLibraryProvider>
        </LayoutContainer>
    );
}

function BulkContentUploadingPage() {
    const { t } = useTranslation('studyLibraryBulkContentUploadingIndex');
    const { setNavHeading } = useNavHeadingStore();
    const studyLibraryData = useStudyLibraryStore((state) => state.studyLibraryData);
    const { getPackageSessionId: getPsIdFromInstitute } = useInstituteDetailsStore();
    const wizardPhase = useBulkContentUploadingStore((state) => state.phase);
    const resetWizardStore = useBulkContentUploadingStore((state) => state.resetStore);

    const [mode, setModeLocal] = useState<UploadMode>('single');
    const [courseId, setCourseId] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [levelId, setLevelId] = useState('');

    useEffect(() => {
        setNavHeading(t('pageTitle'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t]);

    const courses = useMemo(
        () => (studyLibraryData ?? []).map((entry) => entry.course),
        [studyLibraryData]
    );
    const selectedCourseEntry = useMemo(
        () => (studyLibraryData ?? []).find((entry) => entry.course.id === courseId),
        [studyLibraryData, courseId]
    );
    const sessions = useMemo(
        () => (selectedCourseEntry?.sessions ?? []).map((session) => session.session_dto),
        [selectedCourseEntry]
    );
    const levels = useMemo(
        () =>
            (selectedCourseEntry?.sessions ?? []).find(
                (session) => session.session_dto.id === sessionId
            )?.level_with_details ?? [],
        [selectedCourseEntry, sessionId]
    );

    // Auto-select when there's only one option (most institutes have one session/level).
    useEffect(() => {
        if (sessions.length === 1 && sessions[0] && sessionId !== sessions[0].id) {
            setSessionId(sessions[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions]);
    useEffect(() => {
        if (levels.length === 1 && levels[0] && levelId !== levels[0].id) {
            setLevelId(levels[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [levels]);

    const packageSessionId = useMemo(() => {
        if (!courseId || !sessionId || !levelId) return '';
        return (
            useStudyLibraryStore.getState().getPackageSessionId({ courseId, sessionId, levelId }) ||
            getPsIdFromInstitute({ courseId, sessionId, levelId }) ||
            ''
        );
    }, [courseId, sessionId, levelId, getPsIdFromInstitute]);

    const instituteId = useMemo(() => {
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        return (tokenData && Object.keys(tokenData.authorities)[0]) || '';
    }, []);

    const context: BulkUploadContext | null = useMemo(() => {
        if (!courseId || !sessionId || !levelId || !packageSessionId || !instituteId) return null;
        return {
            courseId,
            sessionId,
            levelId,
            packageSessionId,
            courseDepth: selectedCourseEntry?.course.course_depth ?? 5,
            instituteId,
        };
    }, [courseId, sessionId, levelId, packageSessionId, instituteId, selectedCourseEntry]);

    const pickersLocked = wizardPhase === 'committing';
    const courseLabel = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const sessionLabel = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const levelLabel = getTerminology(ContentTerms.Level, SystemTerms.Level);

    const courseItems: SearchableSelectOption[] = courses.map((course) => ({
        label: course.package_name,
        value: course.id,
    }));
    const sessionItems: SearchableSelectOption[] = sessions.map((session) => ({
        label: session.session_name,
        value: session.id,
    }));
    const levelItems: SearchableSelectOption[] = levels.map((level) => ({
        label: level.name,
        value: level.id,
    }));

    const handleModeChange = (next: string) => {
        if (next !== 'single' && next !== 'multi' && next !== 'csv') return;
        if (next === mode) return;
        resetWizardStore();
        setModeLocal(next);
    };

    return (
        <div className="flex flex-col gap-6">
            <Tabs value={mode} onValueChange={handleModeChange}>
                <TabsList>
                    <TabsTrigger value="single" disabled={pickersLocked}>
                        {t('tabs.single', { term: courseLabel.toLowerCase() })}
                    </TabsTrigger>
                    <TabsTrigger value="multi" disabled={pickersLocked}>
                        {t('tabs.multiple', {
                            term: getTerminologyPlural(
                                ContentTerms.Course,
                                SystemTerms.Course
                            ).toLowerCase(),
                        })}
                    </TabsTrigger>
                    <TabsTrigger value="csv" disabled={pickersLocked}>
                        {t('tabs.csv')}
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {mode === 'csv' ? (
                <BulkContentUploadingWizard key="csv" mode="csv" instituteId={instituteId} />
            ) : mode === 'multi' ? (
                <>
                    <div className="rounded-lg border border-neutral-200 bg-white p-4">
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {t('multi.heading', {
                                term: getTerminologyPlural(
                                    ContentTerms.Course,
                                    SystemTerms.Course
                                ).toLowerCase(),
                            })}
                        </h3>
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('multi.description', { term: courseLabel.toLowerCase() })}
                        </p>
                    </div>
                    <BulkContentUploadingWizard
                        key="multi"
                        mode="multi"
                        instituteId={instituteId}
                    />
                </>
            ) : (
                <>
                    <div className="rounded-lg border border-neutral-200 bg-white p-4">
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {t('single.heading')}
                        </h3>
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('single.description', { term: courseLabel.toLowerCase() })}
                        </p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-3">
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-medium text-neutral-600">
                                    {courseLabel}
                                </span>
                                <SearchableSelect
                                    options={courseItems}
                                    value={courseId}
                                    placeholder={t('selectPlaceholder', {
                                        term: courseLabel.toLowerCase(),
                                    })}
                                    searchPlaceholder={t('searchPlaceholder', {
                                        term: courseLabel.toLowerCase(),
                                    })}
                                    emptyText={t('noneFound', { term: courseLabel.toLowerCase() })}
                                    disabled={pickersLocked}
                                    onChange={(value) => {
                                        setCourseId(value);
                                        setSessionId('');
                                        setLevelId('');
                                    }}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-medium text-neutral-600">
                                    {sessionLabel}
                                </span>
                                <SearchableSelect
                                    options={sessionItems}
                                    value={sessionId}
                                    placeholder={t('selectPlaceholder', {
                                        term: sessionLabel.toLowerCase(),
                                    })}
                                    searchPlaceholder={t('searchPlaceholder', {
                                        term: sessionLabel.toLowerCase(),
                                    })}
                                    emptyText={t('noneFound', {
                                        term: sessionLabel.toLowerCase(),
                                    })}
                                    disabled={pickersLocked || !courseId}
                                    onChange={(value) => {
                                        setSessionId(value);
                                        setLevelId('');
                                    }}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-medium text-neutral-600">
                                    {levelLabel}
                                </span>
                                <SearchableSelect
                                    options={levelItems}
                                    value={levelId}
                                    placeholder={t('selectPlaceholder', {
                                        term: levelLabel.toLowerCase(),
                                    })}
                                    searchPlaceholder={t('searchPlaceholder', {
                                        term: levelLabel.toLowerCase(),
                                    })}
                                    emptyText={t('noneFound', { term: levelLabel.toLowerCase() })}
                                    disabled={pickersLocked || !sessionId}
                                    onChange={setLevelId}
                                />
                            </div>
                        </div>
                    </div>

                    {context ? (
                        <BulkContentUploadingWizard
                            key={context.packageSessionId}
                            context={context}
                        />
                    ) : (
                        <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50">
                            <p className="text-subtitle text-neutral-500">
                                {t('pickersEmptyState', {
                                    course: courseLabel.toLowerCase(),
                                    session: sessionLabel.toLowerCase(),
                                    level: levelLabel.toLowerCase(),
                                })}
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
