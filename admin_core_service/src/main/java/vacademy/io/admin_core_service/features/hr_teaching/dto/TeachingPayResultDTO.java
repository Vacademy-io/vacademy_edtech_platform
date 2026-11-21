package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingPayResultDTO {

    private String instituteId;
    private Integer month;
    private Integer year;
    /** True for /pay/preview, false for /pay/materialize. */
    private boolean preview;

    private int eligibleCount;
    private int createdCount;
    private int skippedExistingCount;
    private int unratedCount;
    private BigDecimal totalAmount;

    private List<TeachingPayLineDTO> lines;
}
