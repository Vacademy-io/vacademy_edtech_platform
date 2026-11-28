package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Lightweight, snake-cased projection of an {@link AppliedCouponDiscountDTO}
 * snapshot. Surfaced on {@link UserPlanDTO} as {@code applied_coupon} so
 * frontends can read coupon info as structured fields rather than parsing
 * the raw {@code applied_coupon_discount_json} blob client-side.
 *
 * Only the fields a price-display surface actually needs are exposed. If
 * richer info is needed later, parse the raw JSON directly from
 * {@code applied_coupon_discount_json} — kept on UserPlanDTO for that.
 */
@Slf4j
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CouponSnapshotDTO {

    /** The actual code the learner typed, e.g. {@code SAVE20}. Null when the
     *  snapshot is malformed or the coupon was generated without a code. */
    private String couponCode;

    /** {@code PERCENTAGE} or {@code FLAT} (or legacy lowercase variants). */
    private String discountType;

    /** Percentage (0-100) or flat-amount value, depending on type. */
    private Double discountPoint;

    /** Cap for percentage discounts; null for flat-amount discounts. */
    private Double maxDiscountPoint;

    /** {@code coupon_code} (admin-created) or {@code referral}. */
    private String discountSource;

    /** Admin-granted discounts (discount_source = ADMIN): who granted it and why. */
    private String grantedByUserId;
    private String grantReason;

    /** Charges the discount reduces: null = every cycle (ADMIN), 1 = first payment only. */
    private Integer applyForCycles;

    // Configured to accept BOTH camelCase and snake_case keys defensively,
    // since the on-disk JSON was historically written by different code paths
    // (entity-level mapper vs explicit @JsonNaming-bearing DTOs).
    private static final ObjectMapper LENIENT_MAPPER = new ObjectMapper()
            .configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true);

    /**
     * Parses a persisted {@code applied_coupon_discount_json} blob into a
     * lightweight snapshot. Returns {@code null} on missing input or any
     * parse failure — we never want a stale snapshot to break the parent
     * response.
     */
    public static CouponSnapshotDTO fromJson(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            AppliedCouponDiscountDTO raw = LENIENT_MAPPER.readValue(json, AppliedCouponDiscountDTO.class);
            String code = raw.getCouponCode() != null ? raw.getCouponCode().getCode() : null;
            if (code == null && raw.getDiscountPoint() == null) {
                return null;
            }
            return CouponSnapshotDTO.builder()
                    .couponCode(code)
                    .discountType(raw.getDiscountType())
                    .discountPoint(raw.getDiscountPoint())
                    .maxDiscountPoint(raw.getMaxDiscountPoint())
                    .discountSource(raw.getDiscountSource())
                    .grantedByUserId(raw.getGrantedByUserId())
                    .grantReason(raw.getGrantReason())
                    .applyForCycles(raw.getApplyForCycles())
                    .build();
        } catch (Exception e) {
            log.debug("Could not parse applied_coupon_discount_json snapshot: {}", e.getMessage());
            return null;
        }
    }
}
