import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { LEARNER_NOTES } from "@/constants/urls";
import type { LearnerNote, NotebookPage, NoteKind } from "./types";

export async function fetchSlideNotes(slideId: string): Promise<LearnerNote[]> {
  const { data } = await authenticatedAxiosInstance.get<LearnerNote[]>(LEARNER_NOTES, {
    params: { slide_id: slideId },
  });
  return data;
}

export async function saveNote(note: LearnerNote): Promise<LearnerNote> {
  const { data } = await authenticatedAxiosInstance.put<LearnerNote>(
    `${LEARNER_NOTES}/${note.id}`,
    note,
  );
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await authenticatedAxiosInstance.delete(`${LEARNER_NOTES}/${id}`);
}

export async function fetchNotebook(params: {
  instituteId: string;
  kind?: NoteKind | undefined;
  q?: string | undefined;
  page: number;
  size: number;
}): Promise<NotebookPage> {
  const { data } = await authenticatedAxiosInstance.get<NotebookPage>(`${LEARNER_NOTES}/notebook`, {
    params: {
      institute_id: params.instituteId,
      kind: params.kind,
      q: params.q,
      page: params.page,
      size: params.size,
    },
  });
  return data;
}

/** Every note matching the filter, for an export. */
export async function fetchWholeNotebook(
  instituteId: string,
  kind?: NoteKind,
  q?: string,
): Promise<LearnerNote[]> {
  const all: LearnerNote[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await fetchNotebook({ instituteId, kind, q, page, size: 200 });
    all.push(...result.content);
    if (result.last) break;
  }
  return all;
}

export async function fetchDueNotes(instituteId: string, limit = 20): Promise<LearnerNote[]> {
  const { data } = await authenticatedAxiosInstance.get<LearnerNote[]>(
    `${LEARNER_NOTES}/review/due`,
    { params: { institute_id: instituteId, limit } },
  );
  return data;
}

export async function fetchDueCount(instituteId: string): Promise<number> {
  const { data } = await authenticatedAxiosInstance.get<{ due: number }>(
    `${LEARNER_NOTES}/review/count`,
    { params: { institute_id: instituteId } },
  );
  return data.due;
}

export async function recordReview(id: string, remembered: boolean): Promise<LearnerNote> {
  const { data } = await authenticatedAxiosInstance.post<LearnerNote>(
    `${LEARNER_NOTES}/${id}/review`,
    { remembered },
  );
  return data;
}
