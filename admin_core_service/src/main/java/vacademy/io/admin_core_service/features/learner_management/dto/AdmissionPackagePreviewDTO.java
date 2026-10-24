package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** How an admission package splits across its courses (dry run and real run alike). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionPackagePreviewDTO {

    private BigDecimal feeTotal;
    private BigDecimal discountTotal;
    private BigDecimal netTotal;
    private BigDecimal paidAtAdmission;
    private List<Course> courses;
    /** Per learner, once saved: the package id (real runs only). */
    private List<String> admissionPackageIds;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Course {
        private String packageSessionId;
        private BigDecimal fee;
        private BigDecimal discount;
        private BigDecimal net;
        private BigDecimal paidAtAdmission;
        private List<Row> rows;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private LocalDate dueDate;
        private BigDecimal amount;
        private BigDecimal discount;
    }
}
