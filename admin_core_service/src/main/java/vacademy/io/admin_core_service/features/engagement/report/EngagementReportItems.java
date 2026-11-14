package vacademy.io.admin_core_service.features.engagement.report;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * GET /admin-core-service/v1/engagement/reports/daily/items: the rows behind one of the daily
 * report's lead numbers, one page of them. total is what the report shows for the same engine,
 * period and filter (before search). Times are ISO instants ("…Z"); JSON is camelCase and nulls
 * are written out.
 */
public record EngagementReportItems(
        String kind,
        /** The period's last day (= to), kept for clients that read one day. */
        String date,
        /** The period, YYYY-MM-DD inclusive; from = to for a single day. */
        String from,
        String to,
        String timezone,
        String engineId,
        long total,
        int page,
        int size,
        List<Item> rows) {

    /** LEADS_ADDED | DEMOS_BOOKED | DEMOS_SCHEDULED | STATUS_CHANGES | CONVERSIONS | TEMPLATES_CREATED */
    public static final List<String> KINDS = List.of(
            "LEADS_ADDED", "DEMOS_BOOKED", "DEMOS_SCHEDULED", "STATUS_CHANGES", "CONVERSIONS", "TEMPLATES_CREATED");

    /**
     * One lead (or booking, or status move). Only the fields of the row's kind are filled; the rest
     * are null. audienceResponseId / userId open the lead's profile. listId is the list's id, or
     * BATCH / USERS for people who came in through a batch or by name, as the report's list rows.
     * actor: ENGINE | TEAM | AUTOMATION.
     */
    public record Item(
            String leadName, String email, String phone,
            String audienceResponseId, String userId,
            String engineId, String engineName,
            // LEADS_ADDED
            String listId, String listName, @JsonProperty("isNew") Boolean isNew, String leadCreatedAt,
            String joinedAt,
            // DEMOS_*
            String bookingId, String bookedAt, String scheduledStart, String bookingStatus, String outcome,
            String hostName,
            // STATUS_CHANGES / CONVERSIONS
            String fromStatus, String toStatus, String actor, String source, String changedByName,
            String changedAt,
            // TEMPLATES_CREATED (no lead: the lead fields are null)
            String templateName, String language, String proposedCategory, String metaCategory,
            String templateStatus, String rejectionReason, String createdAt, String submittedAt) {
    }
}
