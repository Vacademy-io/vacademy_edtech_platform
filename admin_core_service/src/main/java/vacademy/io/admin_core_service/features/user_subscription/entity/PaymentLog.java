package vacademy.io.admin_core_service.features.user_subscription.entity;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogDTO;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "payment_log")
public class PaymentLog {
    @Id
    @UuidGenerator
    private String id;

    @Column(name = "status")
    private String status;

    @Column(name = "payment_status")
    private String paymentStatus;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "vendor")
    private String vendor;

    @Column(name = "vendor_id")
    private String vendorId;

    @Column(name = "date")
    private Date date;

    @Column(name = "currency")
    private String currency;

    @ManyToOne
    @JoinColumn(name = "user_plan_id")
    private UserPlan userPlan;

    @Column(name = "payment_amount")
    private Double paymentAmount;

    /**
     * Amount from this payment that was not allocated to any student_fee_payment
     * (excess/overpayment). Used by fee allocation; default 0 for existing rows.
     */
    @Column(name = "unallocated_amount")
    private Double unallocatedAmount;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
        if (updatedAt == null) {
            updatedAt = LocalDateTime.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        if (updatedAt == null) {
            updatedAt = LocalDateTime.now();
        }
    }

    @Column(name = "payment_specific_data")
    private String paymentSpecificData;

    @Column(name = "tracking_id")
    private String trackingId;

    @Column(name = "tracking_source")
    private String trackingSource;

    @Column(name = "order_status")
    private String orderStatus;

    // ─── How an offline payment was made (V577, docs/OFFLINE_PAYMENT_RECORDING.md) ───
    // Set by OfflinePaymentDetailsService when an admin records a payment; null on gateway payments.

    /** Mode code from the institute's offline payment modes, e.g. CASH, UPI, CHEQUE. */
    @Column(name = "payment_mode")
    private String paymentMode;

    /** Sub-option code within the mode, e.g. PHONEPE under UPI, an account under BANK_TRANSFER. */
    @Column(name = "payment_sub_mode")
    private String paymentSubMode;

    /** UPI ref / UTR / cheque number / approval code the admin typed. */
    @Column(name = "payment_reference")
    private String paymentReference;

    /** Labels as shown when recorded, mode-specific extras, notes, proof file id (JSON). */
    @Column(name = "payment_details_json", columnDefinition = "TEXT")
    private String paymentDetailsJson;

    @Column(name = "recorded_by_user_id")
    private String recordedByUserId;

    public PaymentLogDTO mapToDTO() {
        PaymentLogDTO paymentLogDTO = new PaymentLogDTO();
        paymentLogDTO.setId(id);
        paymentLogDTO.setStatus(status);
        paymentLogDTO.setPaymentStatus(paymentStatus);
        paymentLogDTO.setUserId(userId);
        paymentLogDTO.setVendor(vendor);
        paymentLogDTO.setVendorId(vendorId);
        paymentLogDTO.setDate(date);
        // createdAt is stored as a UTC LocalDateTime (the JVM runs in UTC); converting it to a
        // java.util.Date makes Jackson emit an explicit +00:00 offset so clients don't have to
        // guess the zone — unlike a naked LocalDateTime, which browsers parse as local time.
        paymentLogDTO.setCreatedAt(createdAt != null ? Date.from(createdAt.toInstant(ZoneOffset.UTC)) : null);
        paymentLogDTO.setCurrency(currency);
        paymentLogDTO.setPaymentAmount(paymentAmount);
        paymentLogDTO.setTrackingId(trackingId);
        paymentLogDTO.setTrackingSource(trackingSource);
        paymentLogDTO.setOrderStatus(orderStatus);
        paymentLogDTO.setPaymentMode(paymentMode);
        paymentLogDTO.setPaymentSubMode(paymentSubMode);
        paymentLogDTO.setPaymentReference(paymentReference);
        paymentLogDTO.setPaymentDetailsJson(paymentDetailsJson);
        paymentLogDTO.setRecordedByUserId(recordedByUserId);

        // Safely parse transactionId if possible
        if (paymentSpecificData != null) {
            try {
                JsonNode root = JsonUtil.fromJson(paymentSpecificData, JsonNode.class);
                // .path() is null-safe: if a node isn't there, you get a “missing” node, not
                // NPE
                String txnId = root
                        .path("response")
                        .path("response_data")
                        .path("transactionId")
                        .asText(null);
                // If still null, try to get orderId from originalRequest which we always
                // populate
                if (txnId == null) {
                    txnId = root
                            .path("originalRequest")
                            .path("order_id")
                            .asText(null);
                }

                // Offline payments: the reference the admin typed.
                if (txnId == null) {
                    txnId = paymentReference != null ? paymentReference : root.path("transaction_id").asText(null);
                }
                paymentLogDTO.setTransactionId(txnId);
            } catch (Exception e) {
                // Parsing failed: maybe log a warning, but do not throw
                paymentLogDTO.setTransactionId(null);
            }
        } else {
            paymentLogDTO.setTransactionId(paymentReference);
        }

        return paymentLogDTO;
    }
}
