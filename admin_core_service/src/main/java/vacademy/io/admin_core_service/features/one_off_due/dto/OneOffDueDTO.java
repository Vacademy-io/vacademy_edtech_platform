package vacademy.io.admin_core_service.features.one_off_due.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OneOffDueDTO {
    private String id;
    private String userId;
    private String title;
    private BigDecimal amount;
    private String currency;
    private LocalDate dueDate;
    /** DUE | PAID | CANCELLED (read from the invoice). */
    private String status;
    private String invoiceId;
    private String invoiceNumber;
    private String packageSessionId;
    private String courseLabel;
    /** Staff only: null in the learner's own list. */
    private String note;
    private String sourceType;
    private String sourceId;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime cancelledAt;
    private String cancelReason;
}
