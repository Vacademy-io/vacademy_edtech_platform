package vacademy.io.admin_core_service.features.invoice.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * The product an admin invoice pays for, and what happens once it is paid (or at once, with
 * {@link #applyNow}). Once paid, the invoice's payment is also recorded on the membership.
 *
 * <ul>
 *   <li>{@value #TYPE_RENEWAL}: renews a membership the learner already holds
 *       ({@link #userPlanId}). The invoice amount is the custom price of this renewal.</li>
 *   <li>{@value #TYPE_NEW_ENROLLMENT}: enrols the learner in a course
 *       ({@link #packageSessionId}, optionally a specific invite / payment option / plan).</li>
 * </ul>
 *
 * <p>Nothing happens while the invoice is unpaid. When it is paid (gateway or offline), the
 * renewal or enrolment runs once; the money is the invoice's own payment, so no second
 * payment, ledger entry or invoice is recorded for it.
 *
 * <p>One shape for three uses: the create request (the admin's choice), the copy stored under
 * {@code invoice_data_json.product_link} (plus the fulfilment state), and the admin API
 * response. Dates are ISO strings because the stored copy goes through a plain ObjectMapper.
 */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InvoiceProductLinkDTO {

    public static final String TYPE_RENEWAL = "RENEWAL";
    public static final String TYPE_NEW_ENROLLMENT = "NEW_ENROLLMENT";

    /** Waiting for the invoice to be paid. */
    public static final String STATUS_PENDING = "PENDING";
    /** Paid; the renewal / enrolment is running now. */
    public static final String STATUS_IN_PROGRESS = "IN_PROGRESS";
    public static final String STATUS_FULFILLED = "FULFILLED";
    /** Paid, but the renewal / enrolment did not go through; see {@link #error}. Can be retried. */
    public static final String STATUS_FAILED = "FAILED";

    // ── The admin's choice ──

    /** {@value #TYPE_RENEWAL} or {@value #TYPE_NEW_ENROLLMENT}. */
    private String type;

    /** RENEWAL: the membership to renew. */
    private String userPlanId;

    /** NEW_ENROLLMENT: the course (package session) to enrol in. */
    private String packageSessionId;
    /** NEW_ENROLLMENT: null = the course's default invite. */
    private String enrollInviteId;
    /** NEW_ENROLLMENT: null = the invite's payment option for the course. */
    private String paymentOptionId;
    /** NEW_ENROLLMENT: null = the payment option's default plan. */
    private String planId;

    /**
     * RENEWAL: access runs until this day (yyyy-MM-dd). Null = the plan's normal renewal,
     * worked out when the invoice is paid (from the current end date while it is still ahead,
     * otherwise from the payment day).
     */
    private String newEndDate;

    /**
     * Charge this invoice's total on the membership's future renewals too (the member's own
     * price, the same lock "Change price" sets). Off = the plan's normal price.
     */
    private Boolean applyAsMemberPrice;

    /** NEW_ENROLLMENT: send the learner the institute's enrolment email. Off by default. */
    private Boolean notifyLearner;

    /**
     * "Apply now, collect later": renew / enrol as soon as the invoice is raised instead of when
     * it is paid. The payment is still recorded on the membership once it arrives. Off by default.
     * Cancelling the invoice afterwards does not undo it.
     */
    private Boolean applyNow;

    /** The paid invoice's payment has been recorded on the membership ({@link #resultUserPlanId}). */
    private Boolean paymentRecorded;

    // ── Stored state (ignored on the create request) ──

    private String status;
    /** What the product is, for the payments tab: "Renewal · Gold Plan", "Enrol · Class 10 · Yearly". */
    private String label;
    /** The admin who raised the invoice; recorded as the one who renewed / enrolled. */
    private String createdBy;
    private String attemptedAt;
    private String fulfilledAt;
    private String error;
    /** The membership renewed, or the one the enrolment created. */
    private String resultUserPlanId;
    /** The membership's end date after the renewal / enrolment (yyyy-MM-dd). */
    private String resultEndDate;
    /** The member price locked by {@link #applyAsMemberPrice}, when it was applied. */
    private BigDecimal lockedPrice;

    @JsonIgnore
    public boolean isRenewal() {
        return TYPE_RENEWAL.equalsIgnoreCase(type);
    }

    @JsonIgnore
    public boolean isNewEnrollment() {
        return TYPE_NEW_ENROLLMENT.equalsIgnoreCase(type);
    }
}
