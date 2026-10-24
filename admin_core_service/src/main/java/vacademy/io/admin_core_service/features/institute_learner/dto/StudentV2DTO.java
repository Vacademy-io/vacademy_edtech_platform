package vacademy.io.admin_core_service.features.institute_learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;

import java.util.Date;
import java.util.Map;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StudentV2DTO {
    private String id;
    private String userId;
    private String username;
    private String email;
    private String fullName;
    private String addressLine;
    private String region;
    private String city;
    private String pinCode;
    private String mobileNumber;
    private Date dateOfBirth;
    private String gender;
    private String fathersName;
    private String mothersName;
    private String parentsMobileNumber;
    private String parentsEmail;
    private String linkedInstituteName;
    private Date createdAt;
    private Date updatedAt;
    private String faceFileId;
    private Date expiryDate;

    /**
     * TRIAL or PAID, from user_plan.is_trial, which follows the money: every path that
     * collects a plan's price clears the flag. Null when the learner has no plan at all,
     * which is not the same thing as paying, so the badge stays off rather than guessing.
     */
    private String membershipType;

    /** The learner's join date (ssigm.enrolled_date). */
    private String enrolledDate;
    private String parentsToMotherMobileNumber;
    private String parentsToMotherEmail;
    private String billingContactName;
    private String billingContactEmail;
    private String billingContactRole;
    private String password;
    private String paymentStatus;
    private String packageSessionId;
    private Integer accessDays;
    private String instituteEnrollmentNumber;
    private String instituteId;
    private String groupId;
    private String status;
    private PaymentPlanDTO paymentPlan;
    private PaymentOptionDTO paymentOption;
    private String destinationPackageSessionId;
    private String enrollInviteId;
    private String enrollInviteName;
    private Map<String, String> customFields;

    // ---- ADDED FIELDS ----
    private Double paymentAmount;
    private String source;
    private String type;
    private String typeId;
    private String desiredLevelId;
    
    // Sub-org fields
    private String subOrgId;
    private String subOrgName;
    private String commaSeparatedOrgRoles;

    // T&C fields
    private Boolean tncAccepted;
    private String tncFileId;
    private Date tncAcceptedDate;

    // True for audience-only respondents (no enrollment in this institute). Frontend
    // renders an "Audience" badge next to the name and tolerates the null ssigm-side fields.
    private Boolean isAudienceOnly;

    // Every package_session_id the user is enrolled in at this institute. The row's
    // primary `packageSessionId` is the latest one (deterministic via ORDER BY enrolled_date
    // DESC in the slim query). Side-view tabs that fetch batch-scoped data iterate this
    // list so a user with multiple enrollments sees data from all batches, not just the
    // latest one. Empty for audience-only respondents.
    private java.util.List<String> allPackageSessionIds;
}