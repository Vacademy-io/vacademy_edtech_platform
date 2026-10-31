package vacademy.io.admin_core_service.features.points_ledger.entity;

/** What earned the points. Stored as a string so new sources need no migration. */
public enum PointsSourceType {
    /** Completing/answering a daily engagement item. */
    ENGAGEMENT_ITEM,
    /** Daily streak bonus awarded by the streak job. */
    ENGAGEMENT_STREAK,
    /** Assessment/quiz result. */
    ASSESSMENT,
    /** Time-on-platform learning activity. */
    ACTIVITY,
    /** Admin-granted, with a reason. */
    MANUAL,
    /** Passed a practice quiz set by the learner AI tutor (small, capped per day). */
    AI_TUTOR_QUIZ
}
