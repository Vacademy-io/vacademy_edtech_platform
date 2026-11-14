import type {
    EnrollmentPolicyDialogType,
    EnrollmentPolicyResponse,
} from "../-components/enrollment-policy-dialog";

/**
 * Tells a genuine enrollment conflict apart from an unrelated enrollment failure.
 *
 * Every business failure on POST /v1/learner/enroll comes back as HTTP 510, so
 * "the request 510'd" says nothing about *why*. Treating all of them as a
 * conflict is what made a Razorpay mandate rejection, a sub-org seat limit and a
 * plan/invite mismatch all render as "Already Enrolled" while the real message
 * was swallowed.
 *
 * Two signals, in order of trust:
 *   1. `ENROLLMENT_CONFLICT:<TYPE>` in the response code. Backends that throw
 *      EnrollmentConflictException tag conflicts explicitly; nothing else has it.
 *   2. The error text, matched against the messages the backend actually throws
 *      for conflicts -- the institute's configured copy, else the hardcoded
 *      defaults. Needed because a client can face a backend that predates (1).
 *
 * Anything else is a failure, not a conflict: returns null so the caller shows
 * the real error instead of an enrollment dialog.
 */

/** Marker written into ErrorInfo.responseCode by EnrollmentConflictException. */
const CONFLICT_MARKER = "ENROLLMENT_CONFLICT:";

/** ConflictType name -> the dialog that explains it. */
const CONFLICT_TYPE_TO_DIALOG: Record<string, EnrollmentPolicyDialogType> = {
    ALREADY_ENROLLED: "already_enrolled",
    REENROLLMENT_BLOCKED: "reenrollment_blocked",
    PAID_MEMBER_BLOCKED: "paid_member_blocked",
};

/**
 * Fallback copy the backend throws when the institute configured none.
 * Keep in sync with StudentRegistrationManager and LearnerEnrollRequestService.
 * `{{allowed_date}}` / `{{days}}` stand in for values filled at throw time.
 */
const BACKEND_DEFAULT_MESSAGES: Array<{
    dialog: EnrollmentPolicyDialogType;
    template: string;
}> = [
    {
        dialog: "paid_member_blocked",
        template:
            "You already have an active membership plan. Demo access is not available for existing paid subscribers.",
    },
    {
        dialog: "reenrollment_blocked",
        template:
            "Re-enrollment is not allowed. Please try again after {{allowed_date}}. Minimum gap required: {{days}} days.",
    },
    {
        dialog: "already_enrolled",
        template:
            "You are already enrolled in this demo. Please complete your current trial first.",
    },
    {
        dialog: "already_enrolled",
        template: "You can retry operation on {{allowed_date}}",
    },
];

const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compares against a message that may carry placeholders.
 *
 * The backend substitutes `{{allowed_date}}` into the institute's configured
 * reenrollmentBlockedMessage before throwing, so the thrown text never equals
 * the stored template and a plain `===` can not match it. Any `{{...}}` becomes
 * a wildcard; everything else must match exactly.
 */
const matchesTemplate = (template: string, message: string): boolean => {
    const trimmed = template.trim();
    if (!trimmed) return false;
    if (trimmed === message.trim()) return true;
    if (!trimmed.includes("{{")) return false;

    const literals = trimmed.split(/\{\{[^}]*\}\}/);

    // A template that is nothing but placeholders would compile to `^[\s\S]*?$`
    // and match every error message — which is the catch-all bug this module
    // exists to kill. Only match when there is real copy to anchor against.
    if (!literals.some((literal) => literal.trim().length > 0)) return false;

    const pattern = literals.map(escapeRegExp).join("[\\s\\S]*?");
    return new RegExp(`^${pattern}$`).test(message.trim());
};

/**
 * Returns the dialog that explains this enrollment conflict, or null when the
 * failure is not a conflict at all and the raw error should be surfaced.
 */
export const detectEnrollmentConflict = ({
    policyResponse,
    errorMessage,
    responseCode,
}: {
    policyResponse: EnrollmentPolicyResponse | null | undefined;
    errorMessage?: string | null;
    responseCode?: string | null;
}): EnrollmentPolicyDialogType | null => {
    // 1. Explicit tag from the backend — authoritative, no string matching.
    if (responseCode && responseCode.includes(CONFLICT_MARKER)) {
        const type = responseCode
            .slice(responseCode.indexOf(CONFLICT_MARKER) + CONFLICT_MARKER.length)
            .trim()
            .split(/\s/)[0];
        // An unknown type still means "the backend called this a conflict".
        return CONFLICT_TYPE_TO_DIALOG[type ?? ""] ?? "already_enrolled";
    }

    if (!errorMessage) return null;

    // 2. The institute's own configured copy, most specific first.
    const reenrollment = policyResponse?.reenrollmentPolicy;
    const onEnrollment = policyResponse?.onEnrollment;

    if (
        onEnrollment?.blockIfActiveIn?.length &&
        onEnrollment?.blockMessage &&
        matchesTemplate(onEnrollment.blockMessage, errorMessage)
    ) {
        return "paid_member_blocked";
    }

    if (
        reenrollment?.reenrollmentBlockedMessage &&
        matchesTemplate(reenrollment.reenrollmentBlockedMessage, errorMessage)
    ) {
        return "reenrollment_blocked";
    }

    if (
        reenrollment?.alreadyEnrolledMessage &&
        matchesTemplate(reenrollment.alreadyEnrolledMessage, errorMessage)
    ) {
        return "already_enrolled";
    }

    // 3. Backend defaults, for institutes that configured no copy.
    for (const { dialog, template } of BACKEND_DEFAULT_MESSAGES) {
        if (matchesTemplate(template, errorMessage)) return dialog;
    }

    // Not a conflict — let the caller show the real error.
    return null;
};

/**
 * A package session with no enrollment policy configured does NOT come back as
 * `{}`; older backends serialize the empty DTO as five null keys, so
 * `Object.keys(...).length > 0` reads as "policy exists". Require real content.
 */
export const hasEnrollmentPolicyContent = (
    policyResponse: EnrollmentPolicyResponse | null | undefined,
): boolean =>
    !!policyResponse &&
    Object.values(policyResponse).some(
        (section) => section !== null && section !== undefined,
    );
