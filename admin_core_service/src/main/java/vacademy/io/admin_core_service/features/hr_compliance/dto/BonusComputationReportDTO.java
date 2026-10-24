package vacademy.io.admin_core_service.features.hr_compliance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Institute-wide statutory bonus computation for one financial year. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BonusComputationReportDTO {

    private String instituteId;
    /** e.g. 2025-26 (April to March). */
    private String financialYear;
    private LocalDate fyStart;
    private LocalDate fyEnd;
    /** Applied rate, clamped to the Act's 8.33 (s.10 minimum) .. 20 (s.11 maximum). */
    private BigDecimal bonusPct;
    private Integer eligibleCount;
    private BigDecimal totalBonus;
    private String currency;
    private List<BonusComputationRowDTO> rows;
}
