package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Date;
import java.util.List;

@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
@AllArgsConstructor
@NoArgsConstructor
@Data
public class PackageDetailV2DTO {
    private String id;
    private String packageName;
    private String thumbnailFileId;
    private Boolean isCoursePublishedToCatalaouge;
    private String coursePreviewImageMediaId;
    private String courseBannerMediaId;
    private String courseMediaId;
    private String whyLearnHtml;
    private String whoShouldLearnHtml;
    private String aboutTheCourseHtml;
    private String commaSeparetedTags;
    private Integer courseDepth;
    private String courseHtmlDescriptionHtml;
    private Double percentageCompleted;
    private Double rating;
    private String packageSessionId;
    private String levelId;
    private String levelName;
    private String sessionId;
    private String sessionName;
    private String dripConditionJson;
    private List<UserDTO> instructors;
    private Long readTimeInMinutes;
    private String packageType;

    // Enroll Invite + Payment details (default invite -> psli -> last updated payment_option -> its plan)
    private String enrollInviteId;
    private String psliId;
    private String paymentOptionId;
    private String paymentOptionType;
    private String paymentOptionStatus;
    private String paymentPlanId;
    private Double minPlanActualPrice;
    private Double minPlanElevatedPrice;
    private String currency;
    private Integer availableSlots;
    private Integer maxSeats;

    /**
     * Server-computed availability of the course's default enroll invite:
     * AVAILABLE / EXPIRED / NOT_STARTED / INACTIVE (null when the course has no default invite).
     * Drives the catalogue card's "Enrollment closed" / "Opens soon" badge.
     */
    private String enrollInviteAvailability;

    /** Null unless the course is switched to "Coming Soon" (see {@link ComingSoonDTO}). */
    private ComingSoonDTO comingSoon;

    /**
     * When the course (package) was created -- drives the catalogue's "Newest" sort and "New"
     * badge. Serialised as {@code created_at}, ISO-8601 in UTC (e.g. 2026-09-01T10:15:30.000Z),
     * pinned here so it does not depend on the global ObjectMapper's date settings.
     *
     * <p>MUST stay the LAST field: {@code @AllArgsConstructor} is positional and its one caller
     * (OpenPackageService) passes the value last. A field inserted above it silently shifts the
     * neighbouring arguments.
     */
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "UTC")
    private Date createdAt;
}
