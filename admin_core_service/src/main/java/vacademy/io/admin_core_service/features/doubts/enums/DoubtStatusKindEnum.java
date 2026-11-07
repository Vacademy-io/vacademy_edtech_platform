package vacademy.io.admin_core_service.features.doubts.enums;

/**
 * The learner-facing meaning of a configurable workflow status. Admins can add any number of
 * internal statuses (Escalated, Waiting on learner, …); each maps to one of these three so the
 * learner always sees a simple, honest state and the coarse {@code doubts.status} column
 * (ACTIVE/RESOLVED) stays consistent with it.
 */
public enum DoubtStatusKindEnum {
    OPEN, IN_PROGRESS, RESOLVED
}
