/**
 * Guest state for the public demo tutor lesson (tutezy.ai → /try).
 * Lives in sessionStorage so a reload inside the lesson keeps the socket
 * token; nothing here touches the real auth cookies.
 */
import type { TutorStartResponse } from "@/services/tutor-api";

const KEY = "tutor.guest";

export interface TutorGuest {
  token: string;
  boot: TutorStartResponse;
  minutes: number;
  name: string;
  topicKey: string;
}

export function readTutorGuest(): TutorGuest | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TutorGuest) : null;
  } catch {
    return null;
  }
}

export function writeTutorGuest(g: TutorGuest | null): void {
  try {
    if (g) sessionStorage.setItem(KEY, JSON.stringify(g));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
