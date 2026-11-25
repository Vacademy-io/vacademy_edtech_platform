/** The parts of the loaded paper needed to say where a question sits. */
interface PaperSections {
  section_dtos?:
    | {
        name?: string | null;
        question_preview_dto_list?: { question_id: string }[] | null;
      }[]
    | null;
}

export interface QuestionPosition {
  /** Null when the section has no name. */
  sectionName: string | null;
  /** 1-based number within its section, as the exam header shows it. */
  number: number;
}

/**
 * Where a question sits in the learner's paper ("Question 5" of a section), numbered the way
 * the exam header numbers it. Null when the question is not in the paper.
 */
export function findQuestionPosition(
  paper: PaperSections | null | undefined,
  questionId: string | null | undefined,
): QuestionPosition | null {
  if (!paper?.section_dtos || !questionId) return null;
  for (const section of paper.section_dtos) {
    const index = (section.question_preview_dto_list ?? []).findIndex(
      (question) => question.question_id === questionId,
    );
    if (index >= 0) {
      return { sectionName: section.name?.trim() || null, number: index + 1 };
    }
  }
  return null;
}
