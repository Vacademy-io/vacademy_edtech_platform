/**
 * Payloads for the course-details Quiz Results tab
 * (`/admin-core-service/quiz-results/*`).
 *
 * Field names are camelCase here — unlike most of this app's API types — because the
 * quiz-results controller returns Jackson-serialised DTOs rather than the snake_case
 * projections the older study-library endpoints use.
 */

/** A learner's standing on one quiz. Only PASSED/FAILED exist when the quiz sets a pass mark. */
export type QuizLearnerStatus = 'PASSED' | 'FAILED' | 'COMPLETED' | 'PARTIAL' | 'NOT_ATTEMPTED';

/** How hard the batch found a question, derived from its accuracy. */
export type QuizQuestionDifficulty = 'EASY' | 'MODERATE' | 'HARD' | 'CRITICAL';

export interface QuizOverviewSummary {
    totalQuizzes: number;
    enrolledLearners: number;
    /** distinct learners with at least one quiz attempt in this course. */
    learnersAttempted: number;
    /** attempted (learner, quiz) pairs — the numerator behind participationPercent. */
    attemptedPairs: number;
    avgScorePercent: number | null;
    participationPercent: number | null;
    quizzesWithNoAttempts: number;
}

export interface QuizOverviewRow {
    slideId: string;
    quizSlideId: string;
    title: string | null;
    slideStatus: string | null;
    subjectName: string | null;
    moduleName: string | null;
    chapterId: string | null;
    chapterName: string | null;

    questionCount: number;
    totalMarks: number;
    passPercentage: number | null;
    timeLimitInMinutes: number | null;

    attemptedLearners: number;
    enrolledLearners: number;
    totalAttempts: number;

    avgScorePercent: number | null;
    accuracyPercent: number | null;
    correctResponses: number;
    wrongResponses: number;
    skippedResponses: number;
    /** answered but not auto-gradable — never counted as wrong. */
    ungradedResponses: number;

    passedLearners: number | null;
    avgTimeSeconds: number | null;
    lastAttemptAtEpochMillis: number | null;
}

export interface QuizOverviewResponse {
    summary: QuizOverviewSummary;
    quizzes: QuizOverviewRow[];
}

export interface QuizMeta {
    slideId: string;
    quizSlideId: string;
    title: string | null;
    slideStatus: string | null;
    subjectName: string | null;
    moduleName: string | null;
    chapterName: string | null;
    questionCount: number;
    totalMarks: number;
    passPercentage: number | null;
    timeLimitInMinutes: number | null;
    reAttemptCount: number | null;

    enrolledLearners: number;
    attemptedLearners: number;
    totalAttempts: number;
    ungradedResponses: number;
    avgScorePercent: number | null;
    highestScorePercent: number | null;
    lowestScorePercent: number | null;
    medianScorePercent: number | null;
    passedLearners: number | null;
    avgTimeSeconds: number | null;
}

export interface QuizScoreBucket {
    from: number;
    to: number;
    learners: number;
}

export interface QuizLearnerRow {
    userId: string;
    fullName: string | null;
    email: string | null;
    mobileNumber: string | null;
    enrollmentStatus: string | null;

    status: QuizLearnerStatus;
    attemptCount: number;
    lastAttemptAtEpochMillis: number | null;
    latestActivityId: string | null;

    marksObtained: number | null;
    totalMarks: number;
    scorePercent: number | null;

    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    ungradedCount: number;
    unansweredCount: number;
    timeSpentSeconds: number | null;
}

export interface QuizLearnerResultsResponse {
    quiz: QuizMeta;
    distribution: { buckets: QuizScoreBucket[] };
    learners: QuizLearnerRow[];
    returned: number;
    /** the server hit its roster ceiling — the class shown is incomplete. */
    truncated: boolean;
}

export interface QuizOptionStat {
    optionId: string;
    text: string;
    correct: boolean;
    selectedCount: number;
    selectedPercent: number | null;
}

export interface QuizQuestionStat {
    questionId: string;
    order: number;
    questionText: string;
    explanation: string;
    questionType: string | null;
    marks: number;

    responded: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    ungradedCount: number;
    unansweredCount: number;

    accuracyPercent: number | null;
    difficulty: QuizQuestionDifficulty | null;
    options: QuizOptionStat[];
}

export interface QuizQuestionAnalysisResponse {
    attemptedLearners: number;
    questions: QuizQuestionStat[];
}

/* -------------------------------------------------------------------------- */
/* Learner-wise views                                                          */
/* -------------------------------------------------------------------------- */

/** How one learner is doing across every quiz in the course. */
export interface LearnerQuizRow {
    userId: string;
    fullName: string | null;
    email: string | null;
    mobileNumber: string | null;
    enrollmentStatus: string | null;

    quizzesInCourse: number;
    quizzesAttempted: number;
    totalAttempts: number;

    /** marks earned on the quizzes they attempted (latest attempt of each). */
    marksObtained: number | null;
    /** marks available in just those attempted quizzes — the average's denominator. */
    attemptedMaxMarks: number | null;
    /** marks available across every quiz in the course. */
    courseMaxMarks: number | null;

    avgScorePercent: number | null;
    bestScorePercent: number | null;
    lowestScorePercent: number | null;

    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    ungradedCount: number;

    passedQuizzes: number;
    quizzesWithPassMark: number;
    lastAttemptAtEpochMillis: number | null;
}

export interface LearnerQuizOverviewResponse {
    summary: {
        enrolledLearners: number;
        quizzesInCourse: number;
        learnersAttempted: number;
        learnersNotStarted: number;
        avgScorePercent: number | null;
    };
    learners: LearnerQuizRow[];
    returned: number;
    truncated: boolean;
}

/** One quiz as it appears inside a learner's side view. */
export interface LearnerQuizDetailRow {
    slideId: string;
    title: string | null;
    subjectName: string | null;
    moduleName: string | null;
    chapterName: string | null;

    questionCount: number;
    totalMarks: number | null;
    passPercentage: number | null;

    status: QuizLearnerStatus;
    attemptCount: number;

    marksObtained: number | null;
    scorePercent: number | null;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    ungradedCount: number;
    unansweredCount: number;

    timeSpentSeconds: number | null;
    lastAttemptAtEpochMillis: number | null;
}

export interface LearnerQuizDetailResponse {
    learner: LearnerQuizRow;
    quizzes: LearnerQuizDetailRow[];
}

/**
 * Per-question verdict on one attempt. NOT_ANSWERED = no response row at all.
 * PARTIAL = not fully correct but earned a share of the marks (partial-marking quiz).
 */
export type AnswerVerdict = 'CORRECT' | 'PARTIAL' | 'WRONG' | 'SKIPPED' | 'UNGRADED' | 'NOT_ANSWERED';

export interface LearnerAnswerOption {
    optionId: string;
    text: string;
    correct: boolean;
    selected: boolean;
}

export interface LearnerAnswer {
    questionId: string;
    order: number;
    questionText: string;
    questionType: string | null;
    explanation: string;
    verdict: AnswerVerdict;
    /** what the learner picked, as text; empty when skipped. */
    learnerAnswer: string;
    /** the answer key as text; empty when not auto-gradable. */
    correctAnswer: string;
    marks: number;
    marksAwarded: number;
    options: LearnerAnswerOption[];
}

export interface LearnerQuizAttempt {
    /** 1-based, oldest first. */
    attemptNumber: number;
    activityId: string;
    attemptedAtEpochMillis: number | null;
    timeSpentSeconds: number | null;
    /** the attempt every other screen reports on. */
    latest: boolean;

    marksObtained: number | null;
    scorePercent: number | null;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    ungradedCount: number;
    unansweredCount: number;

    answers: LearnerAnswer[];
}

export interface LearnerQuizAnswersResponse {
    slideId: string;
    quizTitle: string | null;
    userId: string;
    fullName: string | null;
    questionCount: number;
    totalMarks: number | null;
    passPercentage: number | null;
    attempts: LearnerQuizAttempt[];
}
