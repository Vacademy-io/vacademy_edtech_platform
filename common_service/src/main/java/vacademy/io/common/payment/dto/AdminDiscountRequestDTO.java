package vacademy.io.common.payment.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A discount an ADMIN applies on a learner's charge — manual enroll, bulk assign,
 * admin invoice, or a pending grant the learner's own checkout redeems.
 *
 * <ul>
 *   <li>{@code mode = PERCENTAGE | FLAT}: ad-hoc; {@code discount_value} (and the
 *       optional {@code max_discount_value} cap for percentages) plus a required
 *       {@code reason}.</li>
 *   <li>{@code mode = COUPON}: apply an existing institute coupon by
 *       {@code coupon_code}; it is validated and uses one redemption like a learner
 *       checkout would.</li>
 * </ul>
 *
 * {@code apply_for_cycles} only matters for SUBSCRIPTION plans: null = every billing
 * cycle, 1 = first payment only, N = the first N charges. The granting admin is never
 * read from here — it comes from the authenticated caller.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminDiscountRequestDTO {
    private String mode;
    private Double discountValue;
    private Double maxDiscountValue;
    private String couponCode;
    private String reason;
    private Integer applyForCycles;
}
