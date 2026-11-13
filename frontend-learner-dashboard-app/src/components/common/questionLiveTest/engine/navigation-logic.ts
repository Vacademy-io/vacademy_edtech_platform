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
 * A paper without free switching whose sections have no clocks of their own
 * (whole-paper or per-question timing). Its sections open one after another:
 * the learner works in the open section and moves on to the next one from
 * its last question (Save & Next or Next); an earlier section does not open
 * again. Section-timed papers instead open a section once the earlier
 * sections' clocks have run out.
 */
export function isSequentialPaper(
  canSwitchSection: boolean,
  sectionTimers: SectionTimers,
): boolean {
  return !canSwitchSection && Object.keys(sectionTimers).length === 0;
}

/**
 * A section tab is open when switching is allowed, or (without switching)
 * when every earlier section is done. On a sequential paper (see
 * `isSequentialPaper`) only the open section's tab is, when `currentSection`
 * is given.
 */
export function isSectionTabAvailable(
  canSwitchSection: boolean,
  index: number,
  sectionTimers: SectionTimers,
  currentSection?: number,
): boolean {
  if (currentSection !== undefined && isSequentialPaper(canSwitchSection, sectionTimers)) {
    return index === currentSection;
  }
  return canSwitchSection || earlierSectionsDone(index, sectionTimers);
}

/**
 * Whether a tab click (or a palette jump) may move to section `index`. On a
 * sequential paper only the open section may be entered this way, when
 * `currentSection` is given; the step to the next section happens from the
 * open section's last question (see `isForwardSectionStep`).
 */
export function canEnterSection(
  canSwitchSection: boolean,
  index: number,
  sectionTimers: SectionTimers,
  currentSection?: number,
): boolean {
  if (currentSection !== undefined && isSequentialPaper(canSwitchSection, sectionTimers)) {
    return index === currentSection;
  }
  // Without switching, only the first section that still has time opens.
  if (!canSwitchSection && !earlierSectionsDone(index, sectionTimers)) {
    return false;
  }
  return sectionTimers[index]?.timeLeft !== 0;
}

/**
 * Moving from the open section to the one right after it on a sequential
 * paper: allowed (the store's section guard lets it through) even though the
 * next section's tab is closed.
 */
export function isForwardSectionStep(
  canSwitchSection: boolean,
  sectionTimers: SectionTimers,
  currentSection: number,
  target: number,
): boolean {
  return isSequentialPaper(canSwitchSection, sectionTimers) && target === currentSection + 1;
}
