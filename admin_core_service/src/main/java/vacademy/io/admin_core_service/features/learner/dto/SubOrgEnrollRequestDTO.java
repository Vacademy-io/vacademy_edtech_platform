package vacademy.io.admin_core_service.features.learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.learner_management.dto.CpoEnrollmentConfigDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.common.dto.CustomFieldValueDTO;

import java.util.Date;
import java.util.List;

/**
 * Request DTO for enrolling a learner through sub-organization purchase
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubOrgEnrollRequestDTO {

    private UserDTO user;
    private String packageSessionId;
    /**
     * Multi-PS variant used by the sub-org admin-add form. When supplied, the user is
     * enrolled across every PS in the list (one SSIGM + StudentSubOrg + FSPSSM per PS,
     * but a single shared UserPlan), so a bundled sub-org gives the admin access to
     * all of its courses in one round-trip. Falls back to {@link #packageSessionId} when
     * empty / null.
     */
    private List<String> packageSessionIds;
    private String subOrgId;
    private String instituteId;
    private String groupId;
    private Date enrolledDate;
    private Date expiryDate;
    private String instituteEnrollmentNumber;
    private String status;
    private String commaSeparatedOrgRoles;
    private List<CustomFieldValueDTO> customFieldValues;

    // ─── Optional offline-payment recording (mirrors bulk/v3/assign non-CPO path) ───
    //
    // Learners ride on FREE scoped invites, so there are no installments to allocate
    // against. These fields just produce a PaymentLog (and optionally an invoice)
    // attached to the learner's UserPlan so the admin can record cash collected
    // outside the platform.

    /** "SKIP" (default) or "OFFLINE". Anything else is treated as SKIP. */
    private String paymentMode;

    /** Amount the admin collected. Must be > 0 when paymentMode = OFFLINE. */
    private Double offlinePaymentAmount;

    /** Currency for the PaymentLog. Defaults to INR when not provided. */
    private String offlinePaymentCurrency;

    /** Optional date the payment was collected. Defaults to "now". */
    private Date offlinePaymentDate;

    /** External reference (cheque #, UPI ref, receipt number) — stored on PaymentLog.paymentSpecificData. */
    private String offlinePaymentReference;

    /** How the offline payment was made (mode, sub-option, reference); see OfflinePaymentDetailsService. */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO offlinePaymentDetails;

    /** If true and an OFFLINE payment was recorded, generate an invoice via InvoiceService. */
    private boolean generateInvoice;

    /**
     * Optional per-learner payment-option override. The sub-org's admin-level CPO is an
     * institute↔admin agreement and does NOT cascade to learners; admins picks the
     * learner's plan independently here. Accepts any PaymentOption.id available to the
     * institute — FREE / ONE_TIME / SUBSCRIPTION / a CPO mirror. When null, the learner
     * stays on the scoped FREE invite's PaymentOption (current default).
     */
    private String paymentOptionId;

    /**
     * Per-learner CPO overrides — only consulted when the resolved learner PaymentOption
     * is a CPO mirror. Carries the same shape bulk/v3/assign uses: per-installment
     * date/amount/discount overrides plus an optional CPO-level discount. Apply order:
     * generateFeeBills → CpoEnrollmentConfigApplier.apply → FIFO allocate offline payment.
     */
    private CpoEnrollmentConfigDTO cpoConfig;

    /**
     * Optional per-enroll override for the FSPSSM access_permission CSV (e.g.
     * "FULL,CREATE_COURSE"). Only consulted when the user is being enrolled as an
     * ADMIN / ROOT_ADMIN. When null/blank, the sub-org's persisted ADMIN_PERMISSIONS
     * setting is used; if that is also missing, falls back to "FULL".
     */
    private String accessPermission;
}
