// === Basic Types ===
export interface Slide {
    id: string;
    title: string;
}

export interface Chapter {
    id: string;
    title: string;
}

export interface Module {
    id: string;
    title: string;
}

export interface Subject {
    id: string;
    title: string;
}

// === Instructor ===
export interface Instructor {
    id: string;
    email: string;
    name: string;
    profilePicId?: string;
    roles?: string[];
    authorSubtitle?: string;
    authorDescription?: string;
    /** Display role in this course (Author / Instructor / Acharya ...). '' = institute default. */
    roleLabel?: string;
}

// === Subject Details with optional modules ===
export interface SubjectDetails {
    id: string;
    subject_name: string;
    subject_code: string;
    credit: number;
    thumbnail_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    modules?: Module[]; // Replace with actual module structure if different
}

// === Session Level Details ===
export interface LevelDetails {
    id: string;
    name: string;
    duration_in_days: number;
    instructors: Instructor[];
    subjects?: SubjectDetails[];
}

// === Session Info ===
export interface SessionDetails {
    id: string;
    session_name: string;
    status: string;
    start_date: string; // Format: YYYY-MM-DD
}

export interface Session {
    levelDetails: LevelDetails[];
    sessionDetails: SessionDetails;
}

// === Course Structure Variants ===
export type CourseStructure =
    | {
          level: 1;
          structure: {
              courseName: string;
              items?: unknown[]; // Could be Slide[] | Chapter[] | etc. based on use case
          };
      }
    | {
          level: 2;
          structure: {
              courseName: string;
              items: Slide[];
          };
      }
    | {
          level: 3;
          structure: {
              courseName: string;
              items: Chapter[];
          };
      }
    | {
          level: 4;
          structure: {
              courseName: string;
              items: Module[];
          };
      }
    | {
          level: 5;
          structure: {
              courseName: string;
              items: Subject[];
          };
      };

// === Course Data ===
export interface CourseData {
    id: string;
    title: string;
    description: string;
    tags: string[];
    imageUrl: string;
    courseStructure: number;
    whatYoullLearn: string;
    whyLearn: string;
    whoShouldLearn: string;
    aboutTheCourse: string;
    packageName: string;
    status: string;
    isCoursePublishedToCatalaouge: boolean;
    coursePreviewImageMediaId: string;
    courseBannerMediaId: string;
    courseMediaId: string;
    courseHtmlDescription: string;
    instructors: Instructor[];
    sessions: Session[];
}

// === Mock Course Type (merged with CourseStructure) ===
export type MockCourse = {
    id: string;
    title: string;
} & CourseStructure;

// === Root Form Values ===
export interface CourseDetailsFormValues {
    courseData: CourseData;
    mockCourses: MockCourse[];
}
