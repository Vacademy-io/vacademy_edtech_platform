package vacademy.io.admin_core_service.features.enroll_invite.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Date;
import java.sql.Timestamp;
import java.util.List;

/**
 * One row of the paginated invite list ({@code POST /enroll-invite/get-enroll-invite}).
 *
 * <p>Mirrors {@link EnrollInviteWithSessionsProjection} field for field — same
 * snake_case JSON the two admin surfaces already parse — and adds the actor
 * names. Names cannot live on the interface projection: they come from one
 * batched auth_service lookup per page, not from the row, so the service maps
 * the projection here and fills them in afterwards.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrollInviteListItemDTO {
    private String id;
    private String name;
    private Date endDate;
    private Date startDate;
    private String inviteCode;
    private String status;
    private String instituteId;
    private String vendor;
    private String vendorId;
    private String currency;
    private String tag;
    private String webPageMetaDataJson;
    private Timestamp createdAt;
    private Timestamp updatedAt;
    private String shortUrl;
    private List<String> packageSessionIds;

    private String createdByUserId;
    /** Display name for {@link #createdByUserId}; null when unknown or auth_service was unreachable. */
    private String createdByName;
    private String updatedByUserId;
    /** Display name for {@link #updatedByUserId}; null when unknown or auth_service was unreachable. */
    private String updatedByName;

    /**
     * The payment option attached to each of the invite's batches, one entry per
     * package session — enough for the list card to say "Free" / "₹499 one-time"
     * without the admin opening the invite. Filled in by one batched query per
     * page; empty when nothing is attached or that lookup failed.
     */
    private List<PaymentSummary> paymentSummaries;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PaymentSummary {
        private String packageSessionId;
        /**
         * Id of the invite↔batch↔payment-option mapping row. The course page's
         * "Configure payment plan" swaps the option through
         * PUT /enroll-invite-payment-option, which needs this as the old id.
         */
        private String mappingId;
        private String paymentOptionId;
        private String paymentOptionName;
        /** SUBSCRIPTION, ONE_TIME, FREE, DONATION or CPO. */
        private String type;
        private boolean requireApproval;
        /** Active plans on the option; usually 0 for FREE, which carries none. */
        private int planCount;
        /** Lowest / highest actual_price across the active plans; null when there are none. */
        private Double minPrice;
        private Double maxPrice;
        private String currency;
    }

    public static EnrollInviteListItemDTO from(EnrollInviteWithSessionsProjection row, String absoluteShortUrl) {
        return EnrollInviteListItemDTO.builder()
                .id(row.getId())
                .name(row.getName())
                .endDate(row.getEndDate())
                .startDate(row.getStartDate())
                .inviteCode(row.getInviteCode())
                .status(row.getStatus())
                .instituteId(row.getInstituteId())
                .vendor(row.getVendor())
                .vendorId(row.getVendorId())
                .currency(row.getCurrency())
                .tag(row.getTag())
                .webPageMetaDataJson(row.getWebPageMetaDataJson())
                .createdAt(row.getCreatedAt())
                .updatedAt(row.getUpdatedAt())
                .shortUrl(absoluteShortUrl)
                .packageSessionIds(row.getPackageSessionIds())
                .createdByUserId(row.getCreatedByUserId())
                .updatedByUserId(row.getUpdatedByUserId())
                .build();
    }
}
