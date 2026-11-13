/**
 * Pure navigation rules for the live test: Previous, Next (crossing into the
 * next section) and the section tabs. The hook in use-question-navigation.ts
 * applies them to the store.
 */

type SectionTimers = Record<number, { timeLeft: number } | undefined>;

interface SectionLike<Q> {
  question_preview_dto_list: Q[];
}

/** Previous question in the same section; null on its first question. */
export function previousTarget<Q>(sectionQuestions: Q[], currentIndex: number) {
  return currentIndex > 0 ? sectionQuestions[currentIndex - 1] : null;
}

/**
 * Next question in the section, or the first question of the next section
 * when the current one is done and the next section's clock is not at 0
 * (a section without a clock counts as open). Null when there is nowhere to go.
 */
export function nextTarget<Q>(input: {
  sections: SectionLike<Q>[];
  currentSection: number;
  currentIndex: number;
  sectionTimers: SectionTimers;
}): { section: number; question: Q } | null {
  const { sections, currentSection, currentIndex, sectionTimers } = input;
  const sectionQuestions = sections[currentSection]?.question_preview_dto_list ?? [];
  if (currentIndex < sectionQuestions.length - 1) {
    return { section: currentSection, question: sectionQuestions[currentIndex + 1] };
  }
  const nextSection = currentSection + 1;
  if (
    nextSection < sections.length &&
    (sectionTimers[nextSection]?.timeLeft ?? -1) !== 0
  ) {
    return {
      section: nextSection,
      question: sections[nextSection].question_preview_dto_list[0],
    };
  }
  return null;
}

/** Every section before `index` has run out of time. */
function earlierSectionsDone(index: number, sectionTimers: SectionTimers) {
  for (let i = 0; i < index; i++) {
    if (sectionTimers[i]?.timeLeft !== 0) return false;
  }
  return true;
}

/**
 * A section tab is open when switching is allowed, or (without switching)
 * when every earlier section is done.
 */
export function isSectionTabAvailable(
  canSwitchSection: boolean,
  index: number,
  sectionTimers: SectionTimers,
): boolean {
  return canSwitchSection || earlierSectionsDone(index, sectionTimers);
}

/** Whether a tab click may move to section `index`. */
export function canEnterSection(
  canSwitchSection: boolean,
  index: number,
  sectionTimers: SectionTimers,
): boolean {
  // Without switching, only the first section that still has time opens.
  if (!canSwitchSection && !earlierSectionsDone(index, sectionTimers)) {
    return false;
  }
  return sectionTimers[index]?.timeLeft !== 0;
}
