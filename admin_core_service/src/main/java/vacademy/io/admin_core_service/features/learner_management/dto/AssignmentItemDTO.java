package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import vacademy.io.common.payment.dto.AdminDiscountRequestDTO;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignmentItemDTO {

    private String packageSessionId;

    /** null → auto-resolve DEFAULT invite for this package session */
    private String enrollInviteId;

    /** null → auto-resolve from the resolved invite */
    private String paymentOptionId;

    /** null → auto-resolve from the resolved payment option */
    private String planId;

    /** null → use invite/plan config; explicit value overrides */
    private Integer accessDays;

    private List<CustomFieldValueDTO> customFieldValues;

    /**
     * For CPO payment options only. Amount admin chooses to record as paid right now.
     * Allowed range: [1, total CPO contract value]. Null or 0 means no payment is recorded —
     * the learner will still get all installment rows (PENDING) and can pay each online later.
     */
    private Double cpoPaymentAmount;

    /**
     * For CPO payment options only. One of:
     *   "SKIP"    → enroll only, no payment recorded (default when null)
     *   "OFFLINE" → admin records a cash/offline collection of cpoPaymentAmount; that amount
     *               is allocated FIFO against the freshly-generated installment rows and an
     *               Invoice is generated.
     */
    private String cpoPaymentMode;

    /**
     * Structured per-learner CPO configuration: per-installment date/amount/discount
     * overrides, whole-CPO discount, and the offline-payment fields above in a
     * single nested object.
     *
     * <p>When non-null, this supersedes {@link #cpoPaymentAmount} / {@link #cpoPaymentMode}
     * for this assignment. When null, the legacy fields apply unchanged.
     */
    private CpoEnrollmentConfigDTO cpoConfig;

    /**
     * Explicit sub-organization to enroll into, for package sessions flagged
     * {@code is_org_associated}. When set, it wins over the legacy custom-field resolution
     * (which mints a brand-new sub-org from the learner's answers) — the admin picked an
     * organization that already exists, so we attach to it instead of creating a duplicate.
     * Ignored for package sessions that aren't org-associated.
     */
    private String subOrgId;

    /**
     * Roles the enrolled member holds inside {@link #subOrgId}, as the CSV stored on
     * {@code ssigm.comma_separated_org_roles} — "ADMIN,LEARNER" for a regular member,
     * "ADMIN" for admin-only access. Defaults to "ADMIN,LEARNER" when a sub-org is chosen
     * without an explicit value, matching {@code InstituteCustomFieldMapper}'s default.
     */
    private String subOrgRoles;

    /**
     * Creates a brand-new sub-organization instead of picking an existing one. Only consulted
     * when {@link #subOrgId} is blank and the package session is org-associated.
     */
    private NewSubOrgDTO newSubOrg;

    /**
     * The admin deliberately chose NOT to link this enrollment to any sub-organization, even
     * though the package session is org-associated. Enrolls the member with no sub_org stamp
     * and fires LEARNER_BATCH_ENROLLMENT rather than SUB_ORG_MEMBER_ENROLLMENT.
     *
     * <p>Distinct from simply omitting {@link #subOrgId}: without this flag an org-associated
     * package session falls back to resolving a sub-org from custom-field answers and throws
     * when it can't, which is the correct guard against a half-configured request.
     */
    private boolean skipSubOrg;

    /**
     * Optional discount the admin gives every learner of this assignment (ONE_TIME /
     * SUBSCRIPTION plans only). Each learner's user_plan gets its own ADMIN discount
     * row; a picked coupon uses one redemption per learner.
     */
    private AdminDiscountRequestDTO adminDiscount;

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class NewSubOrgDTO {
        private String name;
        private String email;
        private String mobileNumber;
    }
}
