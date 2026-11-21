package vacademy.io.admin_core_service.features.access_pass.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Wire shapes of the Access Pass APIs — snake_case like the other catalogue APIs. */
public class AccessPassDTOs {

    private AccessPassDTOs() {
    }

    /**
     * Create and update. On update a null field means "leave as is"; package_session_ids
     * is create-only (items change through the add / remove endpoints so each change is
     * one small, auditable write that triggers its own holder sync).
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AccessPassRequest {
        private String name;
        private String slug;
        private String shortDescription;
        private String description;
        private String coverImageUrl;
        private List<String> tags;
        private String paymentOptionId;
        /** KEEP_FOR_EXISTING | REVOKE */
        private String onItemRemoved;
        private Integer displayOrder;
        private String settingsJson;
        /** B2C | B2B. Create only (a pass's buyers can't change kind under them). */
        private String audienceType;
        /** SELECTED | ALL_COURSES. */
        private String courseScope;
        /** Create only, and only for SELECTED scope. */
        private List<String> packageSessionIds;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ItemsRequest {
        private List<String> packageSessionIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ItemResponse {
        private String packageSessionId;
        private String packageId;
        private String packageName;
        private String levelName;
        private String sessionName;
        private String thumbnailFileId;
        private String coursePreviewImageMediaId;
        private Integer displayOrder;
        private String addedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PriceSummary {
        private String paymentOptionId;
        private String paymentOptionName;
        /** FREE | ONE_TIME | SUBSCRIPTION | ... */
        private String type;
        private Double minPrice;
        private Double maxPrice;
        private String currency;
        private Integer minValidityInDays;
        private Integer planCount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AccessPassResponse {
        private String id;
        private String instituteId;
        private String name;
        private String slug;
        private String shortDescription;
        private String description;
        private String coverImageUrl;
        private List<String> tags;
        private String status;
        private String audienceType;
        private String courseScope;
        private String paymentOptionId;
        private String onItemRemoved;
        private Integer displayOrder;
        private String settingsJson;
        /** The generated invite; the learner app checks out with invite_code. */
        private String enrollInviteId;
        private String inviteCode;
        private String shortUrl;
        private Integer courseCount;
        private Long currentHolderCount;
        /** B2B: sub-orgs currently holding the pass. */
        private Integer subOrgCount;
        private PriceSummary price;
        private List<ItemResponse> items;
        private Boolean needsSync;
        private String lastSyncedAt;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class HolderResponse {
        private String userPlanId;
        private String userId;
        private String fullName;
        private String email;
        private String mobileNumber;
        private String planStatus;
        private String startDate;
        private String endDate;
        private Boolean autoRenewalEnabled;
        private String purchasedAt;
        /** Ledger counts for this holder. */
        private Integer grantedCourses;
        private Integer coveredCourses;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SyncReport {
        private String accessPassId;
        private int plansProcessed;
        private int plansFailed;
        private int coursesGranted;
        private int coursesCovered;
        private int ledgerRowsRecorded;
        private int coursesRevoked;
        /** ALL_COURSES: items the institute's catalogue added / removed this run. */
        private int itemsAdded;
        private int itemsRemoved;
        /** B2B: sub-orgs processed, and courses newly linked to them. */
        private int subOrgsSynced;
        private int subOrgsFailed;
        private int subOrgCoursesLinked;
        private boolean complete;
        private boolean skippedLocked;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubOrgLinkResponse {
        private String subOrgId;
        private String subOrgName;
        private String status;
        private String assignedAt;
        private String lastSyncedAt;
    }

    /** "In N passes" badge on the admin course list. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CoursePassMembership {
        private String packageSessionId;
        private String accessPassId;
        private String accessPassName;
        private String accessPassStatus;
    }
}
