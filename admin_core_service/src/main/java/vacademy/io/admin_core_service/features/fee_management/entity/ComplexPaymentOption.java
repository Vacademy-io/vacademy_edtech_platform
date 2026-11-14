package vacademy.io.admin_core_service.features.fee_management.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "complex_payment_option")
public class ComplexPaymentOption {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "default_payment_option_id")
    private String defaultPaymentOptionId;

    @Column(name = "status")
    private String status;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "approved_by")
    private String approvedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    @Column(name = "metadata_json", columnDefinition = "TEXT")
    private String metadataJson;

    /**
     * FIXED (default): bills are generated from the aft_installments template.
     * FLEXIBLE: no fixed dates; the schedule (count, gap, first due date) is chosen per
     * learner at enrollment. See {@code CpoScheduleMode} and docs/CPO_FLEXIBLE_INSTALLMENTS.md.
     */
    @Column(name = "schedule_mode", nullable = false)
    private String scheduleMode = "FIXED";

    /**
     * Set only on system-built FLEXIBLE plans that back a one-time course price
     * (V575). Such plans are hidden from fee-plan and payment-option listings.
     */
    @Column(name = "source_payment_plan_id")
    private String sourcePaymentPlanId;
}
