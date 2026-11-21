package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class LearnerPackageFilterDTO {

    private List<String> status;
    private List<String> levelIds;
    private List<String> facultyIds;
    private List<String> packageTypes;
    private String searchByName;
    private List<String> tag;
    /** When set, only packages created by this user are returned. Optional. */
    private String createdByUserId;
    private double minPercentageCompleted;
    private double maxPercentageCompleted;
    private Map<String, String> sortColumns;
    private String type;
    /** Comma-separated package IDs to filter by. Optional. */
    private List<String> packageIds;
    /** Comma-separated package session IDs to filter by. Optional. */
    private List<String> packageSessionIds;
    /**
     * Optional filter on package sessions for this course search.
     * Allowed values:
     * - PARENTS_ONLY   -> only sessions with is_parent = true
     * - CHILDREN_ONLY  -> only sessions with parent_id IS NOT NULL
     * If null/empty, no parent/child filter is applied.
     */
    private String packageSessionFilter;
    /** Optional academic session IDs to filter by. When null or empty, no session filter is applied. */
    private List<String> sessionIds;
    /** When true, pagination is based on distinct packages instead of package sessions. */
    private Boolean packageView;
    /** Set by the learner's own search: leaves out charge packages. Never read from the request. */
    @JsonIgnore
    private boolean excludeChargePackages;
}
