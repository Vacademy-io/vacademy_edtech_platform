package vacademy.io.admin_core_service.features.plan_change.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.util.Date;

/**
 * One in-flight or historical plan change for a {@code user_plan}.
 *
 * <p>A plan change is not atomic, which is why it needs a row of its own. An UPGRADE has to
 * survive a gateway round trip — we create the request, hand the learner a checkout, and
 * only apply it when the webhook confirms — and the gateway hands back nothing but an order
 * id, so {@link #paymentLogId} is the only way home. A DOWNGRADE is deliberately parked
 * until {@link #scheduledFor} so the learner keeps the time they already paid for.
 *
 * <p>The {@code from*}/{@code to*} pairs are the audit record. A cross-option change
 * repoints the payment option AND the enroll invite (an option is reachable only through an
 * invite), so without them an applied change cannot be reconstructed afterwards.
 */
@Entity
@Table(name = "user_plan_change_request")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class UserPlanChangeRequest {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "user_plan_id", nullable = false)
    private String userPlanId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "from_plan_id")
    private String fromPlanId;

    @Column(name = "to_plan_id", nullable = false)
    private String toPlanId;

    @Column(name = "from_plan_json", columnDefinition = "TEXT")
    private String fromPlanJson;

    @Column(name = "to_plan_json", columnDefinition = "TEXT")
    private String toPlanJson;

    @Column(name = "from_payment_option_id")
    private String fromPaymentOptionId;

    @Column(name = "to_payment_option_id")
    private String toPaymentOptionId;

    @Column(name = "from_enroll_invite_id")
    private String fromEnrollInviteId;

    @Column(name = "to_enroll_invite_id")
    private String toEnrollInviteId;

    /** {@link vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeDirection} */
    @Column(name = "direction", nullable = false)
    private String direction;

    /** {@link vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeEffectiveType} */
    @Column(name = "effective_type", nullable = false)
    private String effectiveType;

    /** {@link vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeStatus} */
    @Column(name = "status", nullable = false)
    private String status;

    /** Unused value of the plan being left behind. Informational once applied. */
    @Column(name = "proration_credit")
    private BigDecimal prorationCredit;

    /** {@code max(0, newPrice - prorationCredit)} — what the learner was actually asked for. */
    @Column(name = "charge_amount")
    private BigDecimal chargeAmount;

    @Column(name = "currency")
    private String currency;

    /**
     * {@code payment_log.id} of the upgrade charge — the same value that goes out as the
     * gateway order id, so the webhook can find this row from the callback alone.
     */
    @Column(name = "payment_log_id")
    private String paymentLogId;

    /** END_OF_CYCLE only: the {@code user_plan.end_date} this change is waiting for. */
    @Column(name = "scheduled_for")
    private Date scheduledFor;

    /** LEARNER | ADMIN | SYSTEM */
    @Column(name = "requested_by", nullable = false)
    private String requestedBy;

    @Column(name = "requested_by_user_id")
    private String requestedByUserId;

    /** Free text, admin overrides only — why the plan was moved without a payment. */
    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Column(name = "applied_at")
    private Date appliedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    /** True when this change also moves the learner to a different option + enroll invite. */
    public boolean isCrossOption() {
        return toPaymentOptionId != null && !toPaymentOptionId.equals(fromPaymentOptionId);
    }
}
