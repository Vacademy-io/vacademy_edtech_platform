package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/** A course a break can apply to: one of the learner's current enrolments. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BreakCourseDTO {
    private String packageSessionId;
    private String courseLabel;
    private String accessStatus;
    private Date accessExpiry;
    private String userPlanId;
    private String planStatus;
    private Date planEndDate;
    private Date nextChargeAt;
    private boolean autopay;
    /** SUBSCRIPTION, ONE_TIME, CPO, FREE, ... */
    private String paymentType;
    private int unpaidInstalments;
}
