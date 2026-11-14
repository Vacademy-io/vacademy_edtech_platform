// Utility helpers to compute and format total course time from slide counts or backend API

export type SlideCountEntry = {
  slide_count: number;
  total_read_time_minutes: number | null;
  source_type: string;
};

// Backend API response structure for batch data
export type BatchData = {
  id: string;
  read_time_in_minutes?: number;
  package_dto?: {
    id: string;
    package_name: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// Course data with potential backend timing
export type CourseTimeData = {
  // Backend provided time (highest priority)
  read_time_in_minutes?: number;
  // Fallback to slide count calculation
  slideCountEntries?: SlideCountEntry[];
  // Additional batch data for context
  batchData?: BatchData;
};

// Default minutes per slide when total_read_time_minutes is null
const DEFAULT_MINUTES_PER_SLIDE: Record<string, number> = {
  CODE: 15,
  JUPYTER_NOTEBOOK: 15,
  JUPYTER: 15,
  PRESENTATION: 15,
  SCRATCH_PROJECT: 15,
  SCRATCH: 15,
  // Reading the question and writing a short reflection.
  DISCUSSION: 10,
  VIDEO: 15,
  DOCUMENT: 30,
  DOC: 30,
  HTML: 30,
  PDF: 30,
  QUIZ: 30,
};

const normalizeSourceType = (raw: string): string => {
  const upper = (raw || "").toUpperCase();
  if (upper === "DOC") return "DOCUMENT";
  if (upper === "HTML") return "DOCUMENT";
  if (upper === "JUPYTER") return "JUPYTER_NOTEBOOK";
  if (upper === "SCRATCH") return "SCRATCH_PROJECT";
  return upper;
};

export const computeTotalCourseMinutes = (entries: SlideCountEntry[] | undefined | null): number => {
  if (!entries || entries.length === 0) return 0;

  return entries.reduce((total, entry) => {
    const sourceType = normalizeSourceType(entry.source_type);
    const explicitMinutes = entry.total_read_time_minutes;
    if (typeof explicitMinutes === "number" && !Number.isNaN(explicitMinutes)) {
      return total + explicitMinutes;
    }

    const minutesPerSlide = DEFAULT_MINUTES_PER_SLIDE[sourceType] ?? 15;
    const slides = typeof entry.slide_count === "number" ? entry.slide_count : 0;
    return total + minutesPerSlide * slides;
  }, 0);
};

// Helper function to round up to nearest 15-minute interval
// This improves UX by showing cleaner time estimates (e.g., 28.13m becomes 30m)
const roundUpToNearest15 = (minutes: number): number => {
  return Math.ceil(minutes / 15) * 15;
};

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 60 * 24; // 1440
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7; // 10080
const MINUTES_PER_MONTH = MINUTES_PER_DAY * 30; // 43200 (approx.)

// Break raw minutes down into months/weeks/days/hours/minutes and return
// the top two most-significant non-zero units so the label stays concise.
// e.g. 45 -> "45m" · 90 -> "1h 30m" · 2880 -> "2d" · 15000 -> "1w 3d"
const cascadeFormat = (minutes: number): string => {
  if (!minutes || minutes <= 0) return "0m";

  const months = Math.floor(minutes / MINUTES_PER_MONTH);
  let remainder = minutes % MINUTES_PER_MONTH;
  const weeks = Math.floor(remainder / MINUTES_PER_WEEK);
  remainder = remainder % MINUTES_PER_WEEK;
  const days = Math.floor(remainder / MINUTES_PER_DAY);
  remainder = remainder % MINUTES_PER_DAY;
  const hours = Math.floor(remainder / MINUTES_PER_HOUR);
  const mins = Math.round(remainder % MINUTES_PER_HOUR);

  const parts: string[] = [];
  if (months) parts.push(`${months}mo`);
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);

  if (parts.length === 0) return "0m";
  return parts.slice(0, 2).join(" ");
};

export const formatMinutesHuman = (minutes: number): string => {
  if (!minutes || minutes <= 0) return "0m";
  // Round up small durations to nearest 15-minute interval for cleaner UX;
  // long durations (>= 1h) stay precise since cascadeFormat already picks
  // the two biggest units and minute noise gets dropped naturally.
  const normalized = minutes < MINUTES_PER_HOUR ? roundUpToNearest15(minutes) : minutes;
  return cascadeFormat(normalized);
};

// Format minutes without rounding (for exact backend data)
export const formatMinutesExact = (minutes: number): string => {
  return cascadeFormat(minutes);
};

export const formatTotalCourseDuration = (entries: SlideCountEntry[] | undefined | null): string => {
  return formatMinutesHuman(computeTotalCourseMinutes(entries));
};

// NEW: Enhanced function that prioritizes backend read_time_in_minutes
export const computeCourseDuration = (courseData: CourseTimeData): number => {
  // Priority 1: Backend provided read_time_in_minutes (direct from course data)
  if (typeof courseData.read_time_in_minutes === "number" && !Number.isNaN(courseData.read_time_in_minutes)) {
    return courseData.read_time_in_minutes;
  }

  // Priority 2: Backend provided read_time_in_minutes from batch data
  if (courseData.batchData?.read_time_in_minutes && 
      typeof courseData.batchData.read_time_in_minutes === "number" && 
      !Number.isNaN(courseData.batchData.read_time_in_minutes)) {
    return courseData.batchData.read_time_in_minutes;
  }

  // Priority 3: Fallback to client-side calculation from slide counts
  if (courseData.slideCountEntries) {
    return computeTotalCourseMinutes(courseData.slideCountEntries);
  }

  return 0;
};

// NEW: Enhanced formatting function that uses the new computation logic
export const formatCourseDuration = (courseData: CourseTimeData): string => {
  return formatMinutesHuman(computeCourseDuration(courseData));
};

// NEW: Convenience function for backward compatibility with batch data
export const formatBatchCourseDuration = (batchData: BatchData, fallbackSlideEntries?: SlideCountEntry[]): string => {
  const courseData: CourseTimeData = {
    batchData,
    slideCountEntries: fallbackSlideEntries,
  };
  return formatCourseDuration(courseData);
};

// NEW: Direct function to get duration from backend read_time_in_minutes
export const getBackendCourseDuration = (readTimeInMinutes?: number): string => {
  if (typeof readTimeInMinutes === "number" && !Number.isNaN(readTimeInMinutes)) {
    return formatMinutesExact(readTimeInMinutes);
  }
  return "0m";
};


