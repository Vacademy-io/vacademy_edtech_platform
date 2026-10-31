import { create } from 'zustand';

interface Instructor {
  id: string;
  full_name?: string;
  username?: string;
  profile_pic_file_id?: string | null;
  image_url?: string;
  author_subtitle?: string;
  author_description?: string;
  role_label?: string | null;
}

interface Level {
  id: string;
  level_name: string;
}

interface InstituteData {
  levels?: Level[];
  tags?: string[];
  [key: string]: any;
}

interface CourseData {
  id: string;
  package_name: string;
  thumbnail_file_id: string;
  level_name: string;
  instructors?: Instructor[];
  rating?: number;
  course_html_description_html?: string;
  comma_separeted_tags?: string;
  [key: string]: any;
}

interface CatalogState {
  courseData: CourseData[];
  setCourseData: (data: CourseData[]) => void;

  instituteData: InstituteData | null;
  setInstituteData: (data: InstituteData) => void;

  instructor: Instructor[];
  setInstructors: (data: Instructor[]) => void;
}

export const useCatalogStore = create<CatalogState>((set) => ({
  courseData: [],
  setCourseData: (data) => set({ courseData: data }),

  instituteData: null,
  setInstituteData: (data) => set({ instituteData: data }),

  instructor: [],
  setInstructors: (data) => set({ instructor: data })
}));
