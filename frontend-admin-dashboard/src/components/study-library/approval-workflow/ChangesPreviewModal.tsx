import React, { useEffect, useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, X, Plus, FileText, Spinner } from '@phosphor-icons/react';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_SLIDES } from '@/constants/urls';
import { fetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import { fetchCourseStudyLibraryDetails } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ChangesPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    courseId: string;
    onSubmitForApproval: () => void;
    isSubmitting: boolean;
    // false = the role publishes directly (no admin review); copy adapts.
    requireApproval?: boolean;
}

interface ChangesSummary {
    isNewCourse: boolean;
    originalCourseId: string | null;
    changesDetected: {
        newSlides: number;
        updatedSlides: number;
        totalSlides: number;
        newChapters: number;
        newModules: number;
        newSubjects: number;
    };
}

export function ChangesPreviewModal({
    isOpen,
    onClose,
    courseId,
    onSubmitForApproval,
    isSubmitting,
    requireApproval = true,
}: ChangesPreviewModalProps) {
    const { studyLibraryData } = useStudyLibraryStore();
    const { items: chapterSlides } = useContentStore();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const chapterTerm = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
    const chaptersTerm = getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters);
    const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [courseWide, setCourseWide] = useState<null | {
        totals: { newSlides: number; updatedSlides: number; chaptersWithChanges: number };
        byChapter: Array<{
            chapterId: string;
            chapterName: string;
            newCount: number;
            updatedCount: number;
        }>;
    }>(null);

    // Derive per-chapter slide changes that the teacher just worked on
    const chapterSlideChanges = useMemo(() => {
        try {
            const slides = Array.isArray(chapterSlides) ? chapterSlides : [];
            // New is determined by parent_id per requirements
            const changed = slides.filter((s: any) => s.parent_id == null);

            const newSlides = changed;
            const updatedSlides: typeof changed = [];

            return {
                hasAny: changed.length > 0,
                newCount: newSlides.length,
                updatedCount: updatedSlides.length,
                changedSlides: changed.map((s) => ({
                    id: s.id,
                    title: s.title || 'Untitled slide',
                    type:
                        s.source_type === 'DOCUMENT'
                            ? s.document_slide?.type || 'DOCUMENT'
                            : s.source_type,
                    isNew: true,
                    status: s.status,
                })),
            };
        } catch {
            return { hasAny: false, newCount: 0, updatedCount: 0, changedSlides: [] as any[] };
        }
    }, [chapterSlides]);

    // Fetch changes data when modal opens
    useEffect(() => {
        if (isOpen && courseId) {
            fetchChangesData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, courseId]);

    const fetchChangesData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Find current course data
            const currentCourse = studyLibraryData?.find((item) => item.course.id === courseId);

            if (!currentCourse) {
                throw new Error('Course not found');
            }

            const originalCourseId = currentCourse.course.originalCourseId || null;
            const isNewCourse = !originalCourseId;

            if (isNewCourse) {
                // For new courses, show all content as new
                const summary = await calculateNewCourseChanges(currentCourse);
                setChangesSummary({
                    isNewCourse: true,
                    originalCourseId: null,
                    changesDetected: summary,
                });
            } else {
                // For course updates, compare with original
                const summary = await compareWithOriginalCourse(courseId, originalCourseId);
                setChangesSummary({
                    isNewCourse: false,
                    originalCourseId,
                    changesDetected: summary,
                });
            }

            // Compute course-wide slide changes across all chapters (teacher view)
            const courseWideResult = await computeCourseWideSlideChanges(currentCourse);
            setCourseWide(courseWideResult);
        } catch (err) {
            console.error('Error fetching changes data:', err);
            setError('Failed to load changes data');
        } finally {
            setLoading(false);
        }
    };

    const computeCourseWideSlideChanges = async (courseData: any) => {
        try {
            const subjectSessionPairs = gatherSubjectSessionPairs(courseData);
            const chapters = await fetchChaptersForSubjects(subjectSessionPairs);
            const slidesData = await fetchSlidesForChapters(chapters);
            return processSlidesData(chapters, slidesData);
        } catch (e) {
            console.error('Error computing course-wide slide changes:', e);
            return null;
        }
    };

    const gatherSubjectSessionPairs = (courseData: any) => {
        const subjectSessionPairs: Array<{
            subjectId: string;
            packageSessionId: string;
            levelId: string;
            sessionId: string;
        }> = [];

        courseData.sessions?.forEach((session: any) => {
            const sessionId = session.session_dto?.id;
            session.level_with_details?.forEach((level: any) => {
                const levelId = level.id;
                level.subjects?.forEach((subject: any) => {
                    const subjectId = subject.id;
                    const packageSessionId = getPackageSessionId({
                        courseId: courseData.course.id,
                        levelId,
                        sessionId,
                    });
                    if (subjectId && packageSessionId) {
                        subjectSessionPairs.push({
                            subjectId,
                            packageSessionId,
                            levelId,
                            sessionId,
                        });
                    }
                });
            });
        });

        return subjectSessionPairs;
    };

    const fetchChaptersForSubjects = async (subjectSessionPairs: any[]) => {
        const modulesBatches = await Promise.all(
            subjectSessionPairs.map((p) =>
                fetchModulesWithChapters(p.subjectId, p.packageSessionId)
            )
        );

        const chapters: Array<{ id: string; name: string }> = [];
        modulesBatches.forEach((modules: unknown[]) => {
            (
                modules as Array<{
                    chapters?: Array<{ chapter?: { id: string; chapter_name?: string } }>;
                }>
            )?.forEach((m) => {
                m.chapters?.forEach((c) => {
                    if (c?.chapter?.id) {
                        chapters.push({
                            id: c.chapter.id,
                            name: c.chapter.chapter_name || `Untitled ${chapterTerm}`,
                        });
                    }
                });
            });
        });

        // Dedupe chapters by id
        const uniqueChaptersMap = new Map<string, string>();
        chapters.forEach((c) => uniqueChaptersMap.set(c.id, c.name));

        return uniqueChaptersMap;
    };

    const fetchSlidesForChapters = async (chaptersMap: Map<string, string>) => {
        const chapterIds = Array.from(chaptersMap.keys());
        return await Promise.all(
            chapterIds.map((cid) =>
                authenticatedAxiosInstance
                    .get(`${GET_SLIDES}?chapterId=${cid}`)
                    .then((r) => ({ id: cid, slides: r.data }))
            )
        );
    };

    const processSlidesData = (chaptersMap: Map<string, string>, slidesBatches: any[]) => {
        const byChapter: Array<{
            chapterId: string;
            chapterName: string;
            newCount: number;
            updatedCount: number;
        }> = [];
        let totalNew = 0;
        let totalUpdated = 0;

        slidesBatches.forEach(({ id, slides }) => {
            let newCount = 0;
            const updatedCount = 0;
            (slides || []).forEach((s: any) => {
                // parent_id null means newly added slide at any level
                const isNew = s?.parent_id == null;
                if (isNew) newCount += 1;
            });
            if (newCount + updatedCount > 0) {
                byChapter.push({
                    chapterId: id,
                    chapterName: chaptersMap.get(id) || `Untitled ${chapterTerm}`,
                    newCount,
                    updatedCount,
                });
                totalNew += newCount;
                totalUpdated += updatedCount;
            }
        });

        return {
            totals: {
                newSlides: totalNew,
                updatedSlides: totalUpdated,
                chaptersWithChanges: byChapter.length,
            },
            byChapter,
        };
    };

    const calculateNewCourseChanges = async (courseData: any) => {
        // Count all content as new for new courses
        const totalSlides = 0;
        const totalChapters = 0;
        const totalModules = 0;
        let totalSubjects = 0;

        courseData.sessions?.forEach((session: any) => {
            session.level_with_details?.forEach((level: any) => {
                totalSubjects += level.subjects?.length || 0;
                // Note: We'd need to access modules and chapters data from the modules store
                // For now, we'll provide a basic count
            });
        });

        return {
            newSlides: totalSlides, // This would need access to slides data
            updatedSlides: 0,
            totalSlides: totalSlides,
            newChapters: totalChapters,
            newModules: totalModules,
            newSubjects: totalSubjects,
        };
    };

    const compareWithOriginalCourse = async (currentCourseId: string, originalCourseId: string) => {
        try {
            // Fetch original course data using course-specific API
            const originalData = await fetchCourseStudyLibraryDetails(originalCourseId);
            // The course-init API returns an array with a single course
            const originalCourse = Array.isArray(originalData)
                ? originalData.find((item: any) => item.course.id === originalCourseId)
                : originalData;

            if (!originalCourse) {
                throw new Error('Original course not found');
            }

            // For now, return basic comparison
            // In a real implementation, you'd compare the course structures
            return {
                newSlides: 0, // This would require detailed comparison
                updatedSlides: 0,
                totalSlides: 0,
                newChapters: 0,
                newModules: 0,
                newSubjects: 0,
            };
        } catch (error) {
            console.error('Error comparing with original course:', error);
            throw error;
        }
    };

    const handleSubmit = () => {
        onSubmitForApproval();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText size={20} className="text-blue-600" />
                        Review Changes Before Submission
                    </DialogTitle>
                    <DialogDescription>
                        Review the changes you've made before submitting this{' '}
                        {courseTerm.toLocaleLowerCase()} for approval.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-96 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <DashboardLoader size={24} />
                            <span className="ml-3 text-sm text-gray-600">Analyzing changes...</span>
                        </div>
                    ) : error ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <div className="flex items-center gap-2 text-red-800">
                                <X size={16} />
                                <span className="font-medium">Error</span>
                            </div>
                            <p className="mt-1 text-sm text-red-700">{error}</p>
                        </div>
                    ) : changesSummary ? (
                        <div className="space-y-4">
                            {/* Course Type Badge */}
                            <div className="flex items-center gap-2">
                                <Badge
                                    variant={changesSummary.isNewCourse ? 'default' : 'secondary'}
                                    className="text-xs"
                                >
                                    {changesSummary.isNewCourse
                                        ? `New ${courseTerm}`
                                        : `${courseTerm} Update`}
                                </Badge>
                                {!changesSummary.isNewCourse && (
                                    <span className="text-xs text-gray-500">
                                        Based on original {courseTerm.toLocaleLowerCase()}:{' '}
                                        {changesSummary.originalCourseId}
                                    </span>
                                )}
                            </div>

                            {/* Changes Summary */}
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <h4 className="mb-3 font-medium text-gray-900">Changes Summary</h4>

                                {changesSummary.isNewCourse ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Plus size={14} className="text-green-600" />
                                            <span>
                                                New {courseTerm.toLocaleLowerCase()} with all
                                                content
                                            </span>
                                        </div>
                                        <div className="ml-6 space-y-1 text-xs text-gray-600">
                                            <div>
                                                • {changesSummary.changesDetected.newSubjects}{' '}
                                                subjects
                                            </div>
                                            <div>
                                                • {changesSummary.changesDetected.newModules}{' '}
                                                modules
                                            </div>
                                            <div>
                                                • {changesSummary.changesDetected.newChapters}{' '}
                                                {chaptersTerm.toLocaleLowerCase()}
                                            </div>
                                            <div>
                                                • {changesSummary.changesDetected.totalSlides}{' '}
                                                slides
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {changesSummary.changesDetected.newSlides > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Plus size={14} className="text-green-600" />
                                                <span>
                                                    {changesSummary.changesDetected.newSlides} new
                                                    slides
                                                </span>
                                            </div>
                                        )}
                                        {changesSummary.changesDetected.updatedSlides > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <FileText size={14} className="text-blue-600" />
                                                <span>
                                                    {changesSummary.changesDetected.updatedSlides}{' '}
                                                    updated slides
                                                </span>
                                            </div>
                                        )}
                                        {changesSummary.changesDetected.newSubjects > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Plus size={14} className="text-green-600" />
                                                <span>
                                                    {changesSummary.changesDetected.newSubjects} new
                                                    subjects
                                                </span>
                                            </div>
                                        )}
                                        {changesSummary.changesDetected.newModules > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Plus size={14} className="text-green-600" />
                                                <span>
                                                    {changesSummary.changesDetected.newModules} new
                                                    modules
                                                </span>
                                            </div>
                                        )}
                                        {changesSummary.changesDetected.newChapters > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Plus size={14} className="text-green-600" />
                                                <span>
                                                    {changesSummary.changesDetected.newChapters} new{' '}
                                                    {chaptersTerm.toLocaleLowerCase()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Chapter Slides You Changed (Teacher view) */}
                            {chapterSlideChanges.hasAny && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                                    <h4 className="mb-2 font-medium text-amber-900">
                                        Slides you modified in this{' '}
                                        {chapterTerm.toLocaleLowerCase()}
                                    </h4>
                                    <p className="mb-3 text-sm text-amber-800">
                                        This is what will be sent for admin review from your current{' '}
                                        {chapterTerm.toLocaleLowerCase()}.
                                    </p>
                                    <div className="mb-3 flex gap-3 text-xs text-amber-900">
                                        <span className="rounded bg-white/70 px-2 py-1">
                                            New: {chapterSlideChanges.newCount}
                                        </span>
                                        <span className="rounded bg-white/70 px-2 py-1">
                                            Updated: {chapterSlideChanges.updatedCount}
                                        </span>
                                    </div>
                                    <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
                                        {chapterSlideChanges.changedSlides.map((s) => (
                                            <li
                                                key={s.id}
                                                className="flex items-center justify-between rounded-md bg-white p-2 text-sm"
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium text-gray-800">
                                                        {s.title}
                                                    </p>
                                                    <p className="truncate text-xs text-gray-500">
                                                        {s.type}
                                                    </p>
                                                </div>
                                                <Badge
                                                    variant={s.isNew ? 'default' : 'secondary'}
                                                    className="ml-3 shrink-0"
                                                >
                                                    {s.isNew
                                                        ? 'New'
                                                        : s.status === 'UNSYNC'
                                                          ? 'Updated'
                                                          : 'Changed'}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Course-wide Changes (All Chapters) */}
                            {courseWide && (
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                                    <h4 className="mb-2 font-medium text-indigo-900">
                                        {courseTerm}-wide changes (all{' '}
                                        {chaptersTerm.toLocaleLowerCase()})
                                    </h4>
                                    <div className="mb-3 flex gap-3 text-xs text-indigo-900">
                                        <span className="rounded bg-white/70 px-2 py-1">
                                            New: {courseWide.totals.newSlides}
                                        </span>
                                        <span className="rounded bg-white/70 px-2 py-1">
                                            Updated: {courseWide.totals.updatedSlides}
                                        </span>
                                        <span className="rounded bg-white/70 px-2 py-1">
                                            {chaptersTerm} affected:{' '}
                                            {courseWide.totals.chaptersWithChanges}
                                        </span>
                                    </div>
                                    {courseWide.byChapter.length > 0 ? (
                                        <div className="max-h-48 overflow-y-auto pr-1">
                                            <table className="w-full text-left text-sm">
                                                <thead className="sticky top-0 bg-indigo-100 text-xs text-indigo-900">
                                                    <tr>
                                                        <th className="px-2 py-1">{chapterTerm}</th>
                                                        <th className="px-2 py-1">New</th>
                                                        <th className="px-2 py-1">Updated</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white/60">
                                                    {courseWide.byChapter.map((c) => (
                                                        <tr
                                                            key={c.chapterId}
                                                            className="border-b last:border-0"
                                                        >
                                                            <td className="max-w-[280px] truncate px-2 py-1">
                                                                {c.chapterName}
                                                            </td>
                                                            <td className="px-2 py-1">
                                                                {c.newCount}
                                                            </td>
                                                            <td className="px-2 py-1">
                                                                {c.updatedCount}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-indigo-800">
                                            No changes detected across other{' '}
                                            {chaptersTerm.toLocaleLowerCase()}.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Next Steps */}
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                                <h4 className="mb-2 font-medium text-blue-900">
                                    What happens next?
                                </h4>
                                {requireApproval ? (
                                    <ul className="space-y-1 text-sm text-blue-800">
                                        <li>
                                            • Your {courseTerm.toLocaleLowerCase()} will be
                                            submitted for admin review
                                        </li>
                                        <li>• You'll receive notifications about the review status</li>
                                        <li>
                                            • You can track progress in "{coursesTerm} In Review"
                                        </li>
                                        <li>• You can withdraw and make changes if needed</li>
                                    </ul>
                                ) : (
                                    <ul className="space-y-1 text-sm text-blue-800">
                                        <li>
                                            • Your {courseTerm.toLocaleLowerCase()} will be
                                            published immediately
                                        </li>
                                        <li>• Learners can be enrolled as soon as it is live</li>
                                        <li>
                                            • It will show as Published under "Authored{' '}
                                            {coursesTerm}"
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="gap-2">
                    <MyButton buttonType="secondary" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={handleSubmit}
                        disabled={isSubmitting || loading || !!error}
                        className="bg-green-600 hover:bg-green-700"
                    >
                        {isSubmitting ? (
                            <>
                                <Spinner size={16} className="mr-2 animate-spin" />
                                {requireApproval ? 'Submitting...' : 'Publishing...'}
                            </>
                        ) : (
                            <>
                                <CheckCircle size={16} className="mr-2" />
                                {requireApproval ? 'Submit for Approval' : 'Publish'}
                            </>
                        )}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
