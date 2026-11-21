/**
 * Resume thread (localStorage) — remembers where the learner left off so every
 * surface can offer one-click "Continue".
 *
 * Written by the slides viewer on every slide visit; read by the dashboard
 * hero, course cards and course details. Storage is per-device for now; swap
 * the storage layer for a backend "last position" API later without changing
 * this module's interface.
 *
 * Each signed-in user has their own list, and every entry records its
 * institute, so a device shared between accounts or institutes only ever reads
 * back the current learner's own position. Entries without an owner (the v1
 * key) are not read.
 */
import { useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { getInstituteId } from "@/constants/helper";
import { TokenKey } from "@/constants/auth/tokens";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";

const STORAGE_PREFIX = "vacademy.resumeThread.v2";
const LEGACY_STORAGE_KEY = "vacademy.resumeThread.v1";
const MAX_ENTRIES = 10;

export interface ResumeEntry {
  /** Institute the learner was in when they visited this slide. */
  instituteId: string;
  courseId: string;
  /** levelId is part of the slides route search; optional on older entries. */
  levelId?: string;
  subjectId: string;
  moduleId: string;
  chapterId: string;
  slideId: string;
  sessionId: string;
  /** Display strings captured at visit time so the hero can render without refetching. */
  slideTitle: string;
  chapterName?: string;
  courseName?: string;
  updatedAt: number;
}

/** The slides-viewer route every entry resumes into. */
export const RESUME_ROUTE =
  "/study-library/courses/course-details/subjects/modules/chapters/slides";

/** Whose resume points a screen reads, from the same storage the session uses. */
export interface ResumeScope {
  owner: string | null;
  instituteId: string | null;
}

async function resolveResumeOwner(): Promise<string | null> {
  try {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    return token ? jwtDecode<{ user?: string }>(token).user || null : null;
  } catch {
    return null;
  }
}

export async function resolveResumeScope(): Promise<ResumeScope> {
  const [owner, instituteId] = await Promise.all([resolveResumeOwner(), getInstituteId()]);
  return { owner, instituteId: instituteId || null };
}

/** The current scope; undefined until it has been read. */
export function useResumeScope(): ResumeScope | undefined {
  const [scope, setScope] = useState<ResumeScope>();
  useEffect(() => {
    let active = true;
    resolveResumeScope()
      .then((value) => {
        if (active) setScope(value);
      })
      .catch(() => {
        if (active) setScope({ owner: null, instituteId: null });
      });
    return () => {
      active = false;
    };
  }, []);
  return scope;
}

function readAll(owner: string): ResumeEntry[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${owner}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as ResumeEntry[]).filter((e) => e?.courseId && e?.slideId && e?.instituteId)
      : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ResumeEntry[], owner: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}.${owner}`, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage full/unavailable (private mode) — resume thread is best-effort.
  }
}

/** Record a slide visit. Keyed by course: one entry per course, most recent first. */
export function recordSlideVisit(entry: Omit<ResumeEntry, "updatedAt" | "instituteId">): void {
  if (!entry.courseId || !entry.slideId) return;
  const updatedAt = Date.now();
  void resolveResumeScope()
    .then(({ owner, instituteId }) => {
      if (!owner || !instituteId) return;
      const rest = readAll(owner).filter((e) => e.courseId !== entry.courseId);
      writeAll([{ ...entry, instituteId, updatedAt }, ...rest], owner);
    })
    .catch(() => {
      // Best-effort, like every other write here.
    });
}

/** This learner's resume points in one institute, most recent first. */
export function listResumes(scope: ResumeScope | undefined): ResumeEntry[] {
  if (!scope?.owner || !scope.instituteId) return [];
  return readAll(scope.owner).filter((e) => e.instituteId === scope.instituteId);
}

/** Most recent resume point in this scope, or null. */
export function getLatestResume(scope: ResumeScope | undefined): ResumeEntry | null {
  return listResumes(scope)[0] ?? null;
}

/** Most recent resume point for one course, or null. */
export function getResumeForCourse(scope: ResumeScope | undefined, courseId: string): ResumeEntry | null {
  return listResumes(scope).find((e) => e.courseId === courseId) ?? null;
}

/** Search params for router.navigate({ to: RESUME_ROUTE, search }). */
export function resumeSearchParams(entry: ResumeEntry): Record<string, string> {
  const search: Record<string, string> = {
    courseId: entry.courseId,
    subjectId: entry.subjectId,
    moduleId: entry.moduleId,
    chapterId: entry.chapterId,
    slideId: entry.slideId,
    sessionId: entry.sessionId,
  };
  if (entry.levelId) search.levelId = entry.levelId;
  return search;
}

/** Drop an entry (e.g. course unenrolled or content missing on resume). */
export function clearResumeForCourse(scope: ResumeScope | undefined, courseId: string): void {
  if (!scope?.owner) return;
  writeAll(readAll(scope.owner).filter((e) => e.courseId !== courseId), scope.owner);
}
