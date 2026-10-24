package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.Date;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Data
public class PaymentLogDTO {
    private String id;
    private String status;
    private String paymentStatus;
    private String userId;
    private String vendor;
    private String vendorId;
    private Date date;
    /**
     * Real payment timestamp. {@code date} maps to a DATE column (no time component), so it
     * serializes as UTC midnight and cannot be shown as a time. This carries payment_log.created_at
     * — the column the listing is already ordered by — as a UTC instant.
     */
    private Date createdAt;
    private String currency;
    private String paymentSpecificData;
    private Double paymentAmount;
    private String transactionId;
    private String trackingId;
    private String trackingSource;
    private String orderStatus;

    /** Offline payments only (V577): how it was paid, as recorded by an admin. */
    private String paymentMode;
    private String paymentSubMode;
    private String paymentReference;
    private String paymentDetailsJson;
    private String recordedByUserId;
}
