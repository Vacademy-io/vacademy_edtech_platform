package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The students behind the Admissions report: one row per admission (a student x the month they
 * enrolled), built from the same rows as the report's totals, so the list always adds up to them.
 * A student who joined several courses (a course package) is one row listing every course.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionStudentsDTO {

    private String currency;

    /** Name of the report's custom field (e.g. Branch); null when none is configured. */
    private String fieldName;

    private List<Row> rows;

    /** True when the range has more admissions than the list returns. */
    private boolean truncated;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private String userId;
        private String name;
        private String phone;
        private String email;
        /** Admission month, yyyy-MM. */
        private String month;
        /** First enrolment day of the admission, yyyy-MM-dd. */
        private String admissionDate;
        /** Every course of the admission, comma separated. */
        private String courses;
        private int courseCount;
        /** The course the admission is counted under in the report. */
        private String mainCourse;
        private String courseTag;
        private String source;
        private String counsellorId;
        private String counsellorName;
        /** Value of the report's custom field. */
        private String fieldValue;
        private double fees;
        private double paid;
        private double due;
    }
}
