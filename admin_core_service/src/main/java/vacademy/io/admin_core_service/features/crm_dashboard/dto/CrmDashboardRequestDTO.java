package vacademy.io.admin_core_service.features.crm_dashboard.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * One CRM Dashboard request. The page asks only for the blocks it will draw (a card
 * switched off in Display Settings is never computed), and below-the-fold cards are
 * requested in a second call when they scroll into view.
 *
 * <p>Instants are ISO-8601 in UTC, computed in the browser exactly like the
 * Follow-ups page does, so "today" is the user's today and the dashboard counts
 * match the page a number links to.
 */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CrmDashboardRequestDTO {
    private String instituteId;
    /** Range start / end (ISO instants). Default: the last 30 days. */
    private String from;
    private String to;
    /** IANA zone for day buckets (charts). Default: Asia/Kolkata. */
    private String timezone;
    /** Follow-up windows: now and the end of the user's today (ISO instants). */
    private String now;
    private String todayEnd;
    /** Optional: one lead list only (still inside the caller's scope and granted lists). */
    private String audienceId;
    /** Optional team narrowing; always intersected with the caller's own scope. */
    private String teamId;
    /**
     * Optional lead-status narrowing, same keys and meaning as the leads list filter
     * (CSV of status keys; {@code __NO_STATUS__} = no status). A page that hides some
     * statuses (Follow-ups hides LOST) passes them so its header agrees with its list.
     */
    private String leadStatusId;
    private String leadStatusExcludeId;
    /**
     * Optional duplicate-lead narrowing, as the leads list's {@code duplicates=}: EXCLUDE or
     * ONLY. AUTO = what the list does when the route sets none, i.e. EXCLUDE across all lists
     * when Lead Settings has "Show duplicates only in Duplicate Leads" on. Empty = no filter.
     */
    private String duplicateFilter;
    /** summary, followups, pipeline, sources, counsellors, calls, lists, quality, views. Empty = all. */
    private List<String> blocks;
}
