package vacademy.io.admin_core_service.features.audience.dto;

/**
 * Native-query projection interfaces for the Lead Reports endpoints. Bundled together because
 * each is only used by a single repository method on AudienceResponseRepository. Spring Data
 * maps query column aliases to the property getters (case-insensitive).
 */
public final class LeadReportProjections {

    private LeadReportProjections() {
    }

    /** Aggregate counts for the summary card row. */
    public interface TotalsProjection {
        Long getTotalLeads();
        Long getConvertedLeads();
        Long getLostLeads();
        Long getActiveLeads();
        Long getOverdueLeads();
    }

    /** Aggregate over the counsellor first-action subquery (response counts + TAT met). */
    public interface ResponseStatsProjection {
        Long getRespondedLeads();
        Double getAvgResponseMinutes();
        Double getMedianResponseMinutes();
        Long getTatMetCount();      // null when tat_hours param is null (TAT disabled)
    }

    /** GROUP BY conversion_status. */
    public interface StatusCountProjection {
        String getStatusKey();
        Long getLeadCount();
    }

    /** GROUP BY source_type, with converted sub-count. */
    public interface SourceCountProjection {
        String getSourceType();
        Boolean getFromCampaignType();
        Long getTotalCount();
        Long getConvertedCount();
    }

    /** GROUP BY tier (lead_tier override → score-derived fallback → 'UNCLASSIFIED'). */
    public interface TierCountProjection {
        String getTier();
        Long getLeadCount();
    }

    /** GROUP BY DATE(submitted_at). */
    public interface DailyTrendProjection {
        java.sql.Date getDay();
        Long getSubmittedCount();
        Long getConvertedCount();
    }

    /** Per-counsellor aggregate row. */
    public interface CounselorRowProjection {
        String getCounselorId();
        Long getLeadsAssigned();
        Long getLeadsResponded();
        Long getConversions();
        Double getAvgResponseMinutes();
        Long getTatMetCount();      // null when tat_hours is null
        Long getOpenLeads();
        Long getOverdueLeads();
    }
}
