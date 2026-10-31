import type { Icon } from '@phosphor-icons/react';
import {
  ChartLineUp,
  Exam,
  House,
  PlayCircle,
  SquaresFour,
  VideoCamera,
} from '@phosphor-icons/react';
import {
  getTerminology,
  getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';
import type { LearnerTourKey } from '@/types/student-display-settings';

export interface LearnerTourStep {
  // CSS selector to highlight. Omit for a centered explainer step — driver.js
  // also centers automatically when a selector matches nothing (e.g. the
  // sidebar link on mobile), so anchored steps degrade gracefully.
  element?: string;
  title: string;
  description: string;
}

export interface LearnerTour {
  key: LearnerTourKey;
  label: string;
  description: string;
  icon: Icon;
  // Tour navigates here before starting so steps talk about what's on screen
  route: string;
  steps: LearnerTourStep[];
}

/**
 * Predefined tutorial tours. Institutes choose which of these are available
 * via Settings > Student Display > App tutorials in the admin dashboard;
 * the keys must stay in sync with LEARNER_TOUR_KEYS.
 *
 * Built as a function so terminology (Course/Live Class/... renames) resolves
 * against the institute's naming settings at click time, not import time.
 */
export function getLearnerTours(): LearnerTour[] {
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const liveClass = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  );
  const liveClasses = getTerminologyPlural(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  );
  const slides = getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides);

  return [
    {
      key: 'dashboard-overview',
      label: 'Getting around the app',
      description: 'Your dashboard and the main navigation.',
      icon: House,
      route: '/dashboard',
      steps: [
        {
          title: 'Welcome!',
          description:
            'This quick tour shows you how to get around. You can replay it anytime from the Help menu.',
        },
        {
          element: '[data-sidebar="sidebar"]',
          title: 'Your navigation',
          description: `Everything lives here — your dashboard, ${courses.toLowerCase()}, assessments and more. On a phone, open it with the menu button in the top corner.`,
        },
        {
          title: 'Your dashboard',
          description: `This home screen shows what to do next: continue learning, upcoming ${liveClasses.toLowerCase()}, and your recent progress.`,
        },
        {
          element: '[aria-label^="Notifications"]',
          title: 'Notifications',
          description:
            'Important alerts from your institute show up here — keep an eye on the badge.',
        },
        {
          element: '[data-tour="help-button"]',
          title: 'Need help later?',
          description:
            'Tap the Help button anytime to replay these tutorials. Enjoy learning!',
        },
      ],
    },
    {
      key: 'browse-courses',
      label: `Browse & open ${courses.toLowerCase()}`,
      description: `Find your ${courses.toLowerCase()} and start learning.`,
      icon: SquaresFour,
      route: '/study-library',
      steps: [
        {
          title: `Your ${courses.toLowerCase()}`,
          description: `This is your learning library. Every ${course.toLowerCase()} you're enrolled in appears here as a card.`,
        },
        {
          title: `Open a ${course.toLowerCase()}`,
          description: `Tap any card to open it. Inside you'll find its subjects, modules and ${getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase()} organised step by step.`,
        },
        {
          title: 'Pick up where you left off',
          description: `Your progress is saved automatically — a progress bar on each ${course.toLowerCase()} shows how far you've come.`,
        },
      ],
    },
    {
      key: 'watch-content',
      label: `Watch videos & study ${slides.toLowerCase()}`,
      description: 'How learning material is organised and tracked.',
      icon: PlayCircle,
      route: '/study-library',
      steps: [
        {
          title: 'Learning material',
          description: `Open any ${course.toLowerCase()} and go to a ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase()} — its ${slides.toLowerCase()} are listed in order: videos, documents, quizzes and more.`,
        },
        {
          title: 'Watch and read',
          description: `Tap a ${getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLowerCase()} to open it. Use the arrows or the list to move to the next one — completed items get a checkmark.`,
        },
        {
          title: 'Progress is automatic',
          description:
            'Time watched and completion are recorded for you, so your reports always reflect your real progress.',
        },
      ],
    },
    {
      key: 'take-assessment',
      label: 'Take an assessment',
      description: 'Find, attempt and submit your tests.',
      icon: Exam,
      route: '/assessment/examination',
      steps: [
        {
          title: 'Your assessments',
          description:
            'Tests assigned to you are listed here — live ones you can attempt now, plus upcoming and past ones.',
        },
        {
          title: 'Attempting a test',
          description:
            'Tap an assessment to see its instructions, duration and marks. Start when ready — a timer runs while you attempt it.',
        },
        {
          title: 'Submit & review',
          description:
            'Submit before the timer ends. Once results are released, you can review your answers and marks in Reports.',
        },
      ],
    },
    {
      key: 'join-live-class',
      label: `Join a ${liveClass.toLowerCase()}`,
      description: `See the schedule and join ${liveClasses.toLowerCase()}.`,
      icon: VideoCamera,
      route: '/study-library/live-class',
      steps: [
        {
          title: `${liveClasses} schedule`,
          description: `Today's and upcoming ${liveClasses.toLowerCase()} are listed here with their timings.`,
        },
        {
          title: 'Joining',
          description: `When a ${liveClass.toLowerCase()} is live, its card shows a Join button — tap it and you're in. Recordings (when shared) appear here afterwards too.`,
        },
        {
          title: "Don't miss out",
          description:
            'Enable notifications so you get an alert before class starts.',
        },
      ],
    },
    {
      key: 'view-progress',
      label: 'Track learning progress',
      description: 'Reports on your tests and study time.',
      icon: ChartLineUp,
      route: '/assessment/reports',
      steps: [
        {
          title: 'Your reports',
          description:
            'Every attempted assessment appears here with marks, rank and detailed answer-by-answer review once results are out.',
        },
        {
          title: 'Learning analytics',
          description: `Your dashboard also charts daily study time, ${courses.toLowerCase()} completion and streaks — a quick picture of how consistently you're learning.`,
        },
        {
          title: "That's it!",
          description:
            'Check in regularly to see your growth. You can replay any tutorial from the Help menu.',
        },
      ],
    },
  ];
}
