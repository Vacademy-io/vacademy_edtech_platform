package vacademy.io.admin_core_service.features.one_off_due.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Staff request to add a one-off charge. Source is always MANUAL from the admin screen. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OneOffDueRequestDTO {
    private String userId;
    private String packageSessionId;
    private BigDecimal amount;
    private LocalDate dueDate;
    private String title;
    private String note;
}
