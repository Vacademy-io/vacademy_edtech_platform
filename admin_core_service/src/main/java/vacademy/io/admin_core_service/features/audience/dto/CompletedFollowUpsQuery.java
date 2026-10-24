package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO;

import java.util.List;

/**
 * Body of POST /lead-followup/completed — the Completed tab with the page's lead
 * filters. A body rather than query params because a Source can resolve to more
 * than a hundred audience ids, which would push a GET past the ingress URL limit.
 * Same fields as the GET, which stays for requests without these filters.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CompletedFollowUpsQuery {
    private String instituteId;
    private String counsellorUserId;
    private String search;
    /** ISO-8601 instants; null = open-ended. */
    private String closedFrom;
    private String closedTo;
    private String leadStatusId;
    private String leadStatusExcludeId;
    private List<String> audienceIds;
    private UtmListFilterDTO utmFilters;
    private List<String> interestLevels;
    private Integer page;
    private Integer size;
    private Boolean includeLeadDetail;
}
