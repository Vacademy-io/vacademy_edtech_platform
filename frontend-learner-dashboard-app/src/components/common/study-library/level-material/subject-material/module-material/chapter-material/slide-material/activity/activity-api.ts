import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";

const ROOT = `${BASE_URL}/admin-core-service/slide-activity/learner/v1`;

/** Where the slide sits; completion lands on this chapter. */
export interface ActivityContextIds {
  slideId: string;
  packageSessionId?: string;
  chapterId?: string;
  moduleId?: string;
  subjectId?: string;
}

export interface PollView {
  myOptionId: string | null;
  canVote: boolean;
  resultsVisible: boolean;
  totalVotes: number;
  counts: Record<string, number>;
}

export interface GameView {
  bestScore: number | null;
  lastScore: number | null;
  maxScore: number | null;
  attempts: number;
}

export async function fetchPoll(ids: ActivityContextIds): Promise<PollView> {
  const { data } = await authenticatedAxiosInstance.get<PollView>(`${ROOT}/poll`, {
    params: { slideId: ids.slideId, packageSessionId: ids.packageSessionId, chapterId: ids.chapterId },
  });
  return data;
}

export async function votePoll(ids: ActivityContextIds, optionId: string): Promise<PollView> {
  const { data } = await authenticatedAxiosInstance.post<PollView>(`${ROOT}/poll/vote`, {
    ...ids,
    optionId,
  });
  return data;
}

export async function fetchGame(ids: ActivityContextIds): Promise<GameView> {
  const { data } = await authenticatedAxiosInstance.get<GameView>(`${ROOT}/game`, {
    params: { slideId: ids.slideId, packageSessionId: ids.packageSessionId, chapterId: ids.chapterId },
  });
  return data;
}

export async function sendGameScore(
  ids: ActivityContextIds,
  score: number | undefined,
  maxScore: number | undefined
): Promise<GameView> {
  const { data } = await authenticatedAxiosInstance.post<GameView>(`${ROOT}/game/score`, {
    ...ids,
    score: score ?? 0,
    maxScore,
  });
  return data;
}
