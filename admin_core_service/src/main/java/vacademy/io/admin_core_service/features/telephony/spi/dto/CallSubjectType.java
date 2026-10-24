package vacademy.io.admin_core_service.features.telephony.spi.dto;

/**
 * What kind of person an AI call targets. The AI-calling node + placement + outcome
 * pipeline are subject-agnostic: {@link #LEAD} preserves the original CRM lead
 * behaviour, while {@link #PACKAGE_SESSION_STUDENT} / {@link #LIVE_SESSION_PARTICIPANT}
 * let the SAME machinery call enrolled students / session attendees (e.g. for class
 * feedback).
 *
 * <p>Absent / unknown on older calls ⇒ {@link #LEAD}, so existing lead workflows keep
 * their exact behaviour without any data backfill.
 */
public enum CallSubjectType {
    LEAD,
    PACKAGE_SESSION_STUDENT,
    LIVE_SESSION_PARTICIPANT,
    /**
     * A contact called through the public AI calling API. The client's CRM owns it:
     * the outcome is stored, billed and delivered to the client's webhook, but no lead
     * is assigned, re-statused or pushed into a workflow (the non-LEAD branch of
     * AiCallOutcomeProcessor). subjectId = the public call id (ai_call_api_call.id).
     */
    API_CONTACT;

    /** Lenient parse; null / blank / unknown ⇒ {@link #LEAD} (backward compatible). */
    public static CallSubjectType fromString(String s) {
        if (s == null || s.isBlank()) return LEAD;
        try {
            return valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return LEAD;
        }
    }
}
