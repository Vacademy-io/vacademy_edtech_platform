package vacademy.io.admin_core_service.features.institute_learner.dto.projection;

public interface StudentListV2Projection {
    String getFullName();
    String getEmail();
    String getUsername();
    String getPhone();
    String getPackageSessionId();
    Integer getAccessDays();
    String getPaymentStatus();
    String getCustomFieldsJson();
    String getUserId();
    String getId();
    String getAddressLine();
    String getRegion();
    String getCity();
    String getPinCode();
    String getDateOfBirth();
    String getGender();
    String getFathersName();
    String getMothersName();
    String getParentsMobileNumber();
    String getParentsEmail();
    String getLinkedInstituteName();
    String getCreatedAt();
    String getUpdatedAt();
    String getFaceFileId();
    String getExpiryDate();
    /** user_plan.is_trial for the enrolment's plan; null when it has no plan. */
    Boolean getIsTrial();
    /** ssigm.enrolled_date -- the learner's join date. */
    String getEnrolledDate();
    /** user_plan.end_date — separates a running trial from one that has ended. */
    String getPlanEndDate();
    String getParentsToMotherMobileNumber();
    String getParentsToMotherEmail();
    String getBillingContactName();
    String getBillingContactEmail();
    String getBillingContactRole();
    String getInstituteEnrollmentNumber();
    String getInstituteId();
    String getGroupId();
    String getStatus();
    String getPaymentPlanJson();
    String getPaymentOptionJson();
    String getDestinationPackageSessionId();
    String getEnrollInviteId();
    String getEnrollInviteName();

    // ---- ADDED FIELDS ----
    Double getPaymentAmount();
    String getSource();
    String getType();
    String getTypeId();

    String getDesiredLevelId();

    String getSubOrgId();
    String getSubOrgName();
    String getCommaSeparatedOrgRoles();

    Boolean getTncAccepted();
    String getTncFileId();
    java.util.Date getTncAcceptedDate();

    // True when the user has no ssigm row for the requested institute (audience-only respondent).
    // Computed in the slim enrichment via CASE WHEN ssigm.id IS NULL THEN TRUE ELSE FALSE END.
    Boolean getIsAudienceOnly();
}