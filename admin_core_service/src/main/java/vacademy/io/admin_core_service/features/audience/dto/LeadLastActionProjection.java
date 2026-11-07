package vacademy.io.admin_core_service.features.audience.dto;

import java.sql.Timestamp;

/**
 * Batch projection: a lead (audience_response id) plus the timestamps of the FIRST and LAST
 * response events on it (from {@code timeline_event}) and its effective TAT deadline. Used by
 * the leads tables for:
 * <ul>
 *   <li>{@code firstActionAt} → "Responded in N" — time to first response (TAT actual-vs-deadline).</li>
 *   <li>{@code lastActionAt}  → follow-up deadline anchor.</li>
 *   <li>{@code tatDueAt}      → "Reach out in" deadline: the admin override, else the
 *       working-hours-aware lead_sla_due_at(); null when TAT is off.</li>
 * </ul>
 */
public interface LeadLastActionProjection {
    String getLeadId();
    Timestamp getFirstActionAt();
    Timestamp getLastActionAt();
    Timestamp getTatDueAt();
}
