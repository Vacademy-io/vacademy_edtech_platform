package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public interface PackageDetailV2Projection {
    // Old fields
    String getId();

    String getPackageName();

    String getThumbnailFileId();

    Boolean getIsCoursePublishedToCatalaouge();

    String getCoursePreviewImageMediaId();

    String getCourseBannerMediaId();

    String getCourseMediaId();

    String getWhyLearnHtml();

    String getWhoShouldLearnHtml();

    String getAboutTheCourseHtml();

    String getCommaSeparetedTags();

    Integer getCourseDepth();

    String getCourseHtmlDescriptionHtml();

    String getDripConditionJson();

    Double getRating();

    Long getReadTimeInMinutes();

    String getPackageType();

    // New v2 fields
    String getPackageSessionId();

    String getLevelId();

    String getLevelName();

    String getSessionId();

    String getSessionName();

    // Faculty IDs (from faculty_subject_package_session_mapping)
    List<String> getFacultyUserIds();

    /** Package creator user id (for instructor fallback when no faculty mapped). */
    String getCreatedByUserId();

    // Enroll Invite + Payment details (default invite -> psli -> last updated payment_option -> its plan)
    String getEnrollInviteId();

    String getPsliId();

    String getPaymentOptionId();

    String getPaymentOptionType();

    String getPaymentOptionStatus();

    String getPaymentPlanId();

    // Default enroll-invite availability window (drives the catalogue "Enrollment closed" badge)
    String getEnrollInviteStatus();

    java.sql.Date getEnrollInviteStartDate();

    java.sql.Date getEnrollInviteEndDate();

    Double getMinPlanActualPrice();

    Double getMinPlanElevatedPrice();

    String getCurrency();

    Integer getAvailableSlots();
    
    Integer getMaxSeats();

    /**
     * The package's raw course_setting, selected only when it mentions COMING_SOON (null
     * otherwise). Parsed server-side; never sent to the client as-is because the same blob
     * carries LMS/Moodle connection settings.
     */
    String getComingSoonSettingJson();

    /**
     * {@code p.created_at AS createdAt} -- the course (package) creation time. Selected by both v2
     * queries; keep the alias spelled exactly {@code createdAt}, because body sort_columns
     * {createdAt: ...} is appended to the native SQL as {@code ORDER BY createdAt} and only
     * resolves where the alias exists.
     */
    java.sql.Timestamp getCreatedAt();
}
