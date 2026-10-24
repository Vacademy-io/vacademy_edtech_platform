package vacademy.io.common.exceptions;

/**
 * A genuine enrollment conflict: the learner cannot enroll because of their own
 * existing enrollment state, not because something failed.
 *
 * <p>
 * Why this exists: every business failure on {@code POST /v1/learner/enroll}
 * used to surface as a bare {@link VacademyException}, i.e. HTTP 510 with
 * {@code responseCode: "510 NOT_EXTENDED"}. The learner enroll form treats any
 * 510 there as an enrollment conflict and shows its "Already Enrolled" dialog,
 * so unrelated failures -- a Razorpay mandate rejection, a sub-org seat limit, a
 * plan/invite mismatch -- were all reported to the learner as "you are already
 * enrolled", and the real message was swallowed.
 *
 * <p>
 * Throwing this instead tags the responses that really are conflicts. The status
 * stays 510 on purpose: already-deployed frontends match on {@code "510"} and
 * must keep working unchanged. Newer clients read the
 * {@code ENROLLMENT_CONFLICT:<TYPE>} marker in {@code responseCode} and can tell
 * a conflict from a failure without string-matching human-readable copy.
 *
 * @see vacademy.io.common.core.exception.GlobalExceptionHandler
 */
public class EnrollmentConflictException extends VacademyException {

    /**
     * Marker prefix carried in {@code ErrorInfo.responseCode}. Clients look for
     * this substring, then read the {@link ConflictType} name after the colon.
     */
    public static final String RESPONSE_CODE_MARKER = "ENROLLMENT_CONFLICT:";

    /**
     * The kind of conflict, mapped 1:1 to the dialog the learner frontend shows.
     */
    public enum ConflictType {
        /** Learner already holds this enrollment / is inside the re-enrollment gap. */
        ALREADY_ENROLLED,
        /** Re-enrollment is blocked until a configured date. */
        REENROLLMENT_BLOCKED,
        /** Blocked because the learner is active in a session listed in blockIfActiveIn. */
        PAID_MEMBER_BLOCKED
    }

    private final ConflictType conflictType;

    public EnrollmentConflictException(ConflictType conflictType, String message) {
        super(message);
        this.conflictType = conflictType;
    }

    public ConflictType getConflictType() {
        return conflictType;
    }

    /**
     * The value placed in {@code ErrorInfo.responseCode}. Keeps the numeric status
     * first so existing {@code responseCode.includes("510")} checks still match.
     */
    public String getResponseCode() {
        return getStatus().value() + " " + RESPONSE_CODE_MARKER + conflictType.name();
    }
}
