package vacademy.io.admin_core_service.features.classroom.notify;

import java.util.Collection;

/**
 * The dedupe ledger for classroom panel notices ({@code classroom_notice_log}).
 *
 * A notice is sent only after it has been CLAIMED, and a claim succeeds once per
 * (institute, kind, subject, incident). That is what keeps a panel that stays
 * offline for a week out of six further digests, and what stops two pods from
 * both sending the same notice should the scheduler lock ever be lost.
 */
public interface ClassroomNoticeLog {

    /** Column widths of the table; longer values are cut to fit before the claim. */
    int KIND_MAX = 24;
    int SUBJECT_MAX = 64;
    int INCIDENT_MAX = 64;

    /**
     * Claim one incident.
     *
     * @return the new row id when this call claimed it, or null when it had
     *         already been claimed (by this job earlier, or by another pod).
     */
    String claim(String instituteId, String kind, String subjectId, String incidentKey);

    /** Record whether the claimed notices reached anyone. Failed rows are never retried. */
    void markSent(Collection<String> ids, boolean ok);

    /** Whether this (institute, kind, subject, incident) has been claimed already. Reads only. */
    boolean isClaimed(String instituteId, String kind, String subjectId, String incidentKey);

    /**
     * Drop claims that could not be delivered because no channel was available at all, so a later
     * run may claim them again. Never used for a send that was attempted and failed.
     */
    void release(Collection<String> ids);

    static String fit(String value, int max, String fallback) {
        String v = value == null || value.isBlank() ? fallback : value.trim();
        return v.length() > max ? v.substring(0, max) : v;
    }
}
