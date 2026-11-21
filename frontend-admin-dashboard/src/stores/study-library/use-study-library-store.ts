// stores/study-library/useStudyLibraryStore.ts
import { SessionType } from '@/schemas/student/student-list/institute-schema';
import { create } from 'zustand';

export interface CourseType {
    id: string;
    package_name: string;
    thumbnail_file_id: string;
    status: string;
    createdByUserId?: string;
    institute_id?: string;
    originalCourseId?: string;
    is_course_published_to_catalaouge?: boolean;
    course_preview_image_media_id?: string | null;
    course_banner_media_id?: string | null;
    course_media_id?: string | null;
    why_learn?: string | null;
    who_should_learn?: string | null;
    about_the_course?: string | null;
    tags?: string | null;
    course_depth?: number | null;
    course_html_description?: string | null;
    /** Public course-page extras: {"v":1,"mode":…,"faqs":[{q,a}]} as a string, or null. */
    course_page_json?: string | null;
}

export type StudyLibrarySessionType = SessionType;

export interface SubjectType {
    id: string;
    subject_name: string;
    subject_code: string;
    credit: number;
    thumbnail_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    subject_order?: number;
}

export interface LevelWithDetailsType {
    id: string;
    name: string;
    duration_in_days: number;
    subjects: SubjectType[];
}

export interface SessionWithLevelsType {
    session_dto: StudyLibrarySessionType;
    level_with_details: LevelWithDetailsType[];
}

// Package session mapping from course-init API
export interface PackageSessionType {
    id: string;
    /**
     * Optional display name for this package session (child batch),
     * backed by the `name` column on the package_session table.
     */
    name?: string | null;
    level: {
        id: string;
        level_name: string;
    };
    session: {
        id: string;
        session_name: string;
    };
    start_time: string;
    status: string;
    package_dto?: {
        id: string;
        package_name: string;
    };
    group?: {
        id: string;
        group_name: string;
    };
    read_time_in_minutes?: number;
    is_org_associated?: boolean;
    is_parent?: boolean;
    parent_id?: string | null;
}

export interface CourseWithSessionsType {
    course: CourseType;
    sessions: SessionWithLevelsType[];
    package_sessions?: PackageSessionType[];
}

interface StudyLibraryStore {
    studyLibraryData: CourseWithSessionsType[] | null;
    isInitLoading: boolean;
    setStudyLibraryData: (data: CourseWithSessionsType[]) => void;
    setInitLoading: (loading: boolean) => void;
    resetStudyLibraryStore: () => void;
    getSessionsByCourseLevelSubject: (params: {
        courseId: string;
        levelId: string;
        subjectId: string;
    }) => Array<{ id: string; name: string }>;
    getPackageSessionId: (params: {
        courseId: string;
        sessionId: string;
        levelId: string;
    }) => string | null;
}

export const useStudyLibraryStore = create<StudyLibraryStore>((set, get) => ({
    studyLibraryData: null,
    isInitLoading: false,
    setStudyLibraryData: (data) => set({ studyLibraryData: data }),
    setInitLoading: (loading) => set({ isInitLoading: loading }),
    resetStudyLibraryStore: () => set({ studyLibraryData: null, isInitLoading: false }),
    getSessionsByCourseLevelSubject: (params) => {
        const { studyLibraryData } = get();
        if (!studyLibraryData) return [];

        // Find the course
        const course = studyLibraryData.find((c) => c.course.id === params.courseId);
        if (!course) return [];

        // Find sessions that have the specified level and subject
        const matchingSessions = course.sessions.filter((session) => {
            // Check if any level in this session matches the levelId and contains the subjectId
            return session.level_with_details.some(
                (level) =>
                    level.id === params.levelId &&
                    level.subjects.some((subject) => subject.id === params.subjectId)
            );
        });

        // Map to the required format
        return matchingSessions.map((session) => ({
            id: session.session_dto.id,
            name: session.session_dto.session_name,
        }));
    },
    // Get packageSessionId from package_sessions in course-init response
    getPackageSessionId: (params) => {
        const { studyLibraryData } = get();
        if (!studyLibraryData) return null;

        // Find the course
        const course = studyLibraryData.find((c) => c.course.id === params.courseId);
        if (!course || !course.package_sessions) return null;

        // Find matching package session by level and session
        const matchingPackageSession = course.package_sessions.find(
            (ps) => ps.level.id === params.levelId && ps.session.id === params.sessionId
        );

        return matchingPackageSession?.id || null;
    },
}));
