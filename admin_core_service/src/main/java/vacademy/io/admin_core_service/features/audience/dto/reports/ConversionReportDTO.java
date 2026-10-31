package vacademy.io.admin_core_service.features.audience.dto.reports;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * GET /v1/reports/conversions — leads converted (enrolled into a course) in the window.
 *
 * Definition: an enrolment ({@code student_session_institute_group_mapping} row) counts when
 *   - it was created in the [from, to) window (institute TZ), AND
 *   - its course counts as a conversion per {@code LeadConversionPolicyService}
 *     ({@code COURSE_SETTING.data.leads.countEnrollmentAsConversion}, course → institute → true), AND
 *   - the enrolled user is a lead of this institute who had a campaign response before enrolling, AND
 *   - the enrolment actually happened (INVITED / PENDING_FOR_APPROVAL / DELETED rows are excluded).
 *
 * It reads enrolment rows, NOT {@code user_lead_profile.conversion_status}, so a pipeline status
 * picked after enrolment (e.g. a custom "Sales Won") cannot hide a conversion here.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ConversionReportDTO {

    private Totals totals;
    /** One row per counsellor; a null user_id row collects leads with no counsellor. */
    private List<CounsellorRow> byCounsellor;
    /** One row per counted enrolment, newest first, capped at the service's row limit. */
    private List<LeadRow> leads;
    /** True when more enrolments matched than {@link #leads} carries. */
    private boolean leadsTruncated;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        /** Distinct leads with at least one counted enrolment. */
        private long convertedLeads;
        /** Counted enrolment rows (a lead enrolled into two courses counts twice). */
        private long enrolments;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CounsellorRow {
        private String userId;
        private String name;
        private long convertedLeads;
        private long enrolments;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LeadRow {
        private String enrolmentId;
        private String userId;
        private String leadName;
        private String phone;
        private String email;
        private String packageId;
        private String courseName;
        /** Institute-TZ local date-time, yyyy-MM-dd'T'HH:mm. */
        private String enrolledAt;
        private String enrolmentStatus;
        private String counsellorId;
        private String counsellorName;
        private String campaignName;
        private String sourceType;
    }
}
