package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Admissions in a date range and the fee they booked, split by month, source, course, course tag,
 * counsellor and one institute-chosen custom field (e.g. Branch).
 *
 * <p>An admission is one student enrolled in a month of the range (enrolled_date, institute TZ).
 * Fees are the student's fee plans for those enrolments (cancelled / voided / waived instalments
 * excluded), paid is what has been collected on them so far, due = fees - paid. A student who
 * joined several courses at once is counted once, under their main course: the course whose tag
 * comes first in the institute's course group order, else the course they were enrolled in first.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionReportDTO {

    private String currency;

    private Row totals;

    /** Course tags in column order (the institute's group order first); "" = courses with no tag. */
    private List<String> courseTags;

    /** Name of the custom field behind byField; null when none is configured. */
    private String fieldName;

    /** Admissions of students who joined more than one course in the same month. */
    private long multiCourseAdmissions;

    private List<Row> byMonth;
    private List<Row> bySource;
    private List<Row> byCourseTag;
    private List<Row> byCourse;
    private List<Row> byCounsellor;
    private List<Row> byField;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        /** Grouping value: month yyyy-MM, source, tag, package id, counsellor id or field value. */
        private String key;
        /** Display name; null when the key itself is the name (or it is unknown). */
        private String label;
        /** Set on source rows named after the leads' campaign type. */
        private String campaignType;
        /** Course tag of a course row. */
        private String courseTag;
        private long admissions;
        private double fees;
        private double paid;
        private double due;
        /** Admissions per course tag (keys from courseTags). */
        private Map<String, Long> tagCounts;
    }

    /** Choices for the report settings: the institute's course tags and custom fields. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Options {
        private List<String> courseTags;
        private List<Field> fields;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Field {
        private String id;
        private String name;
        private String type;
    }
}
