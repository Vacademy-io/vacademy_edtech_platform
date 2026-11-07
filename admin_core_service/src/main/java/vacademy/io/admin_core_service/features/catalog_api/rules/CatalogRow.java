package vacademy.io.admin_core_service.features.catalog_api.rules;

import vacademy.io.admin_core_service.features.packages.dto.ComingSoonDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One row of the open catalogue search (v2): one level (package session) of one course. The
 * fields the hosted site's discovery logic reads, copied out of {@link PackageDetailV2DTO} so
 * the rules never touch the internal DTO (and tests can build rows directly).
 *
 * <p>The image is the site's card image: preview image, else banner, else thumbnail
 * (CourseCatalogComponent's {@code thumbnailField}); the three ids are also kept apart
 * ({@code previewImageId}, {@code bannerImageId}, {@code thumbnailId}). Price is
 * {@code min_plan_actual_price || 0}.
 */
public record CatalogRow(
        String packageId,
        String packageSessionId,
        String title,
        String levelName,
        String levelId,
        String sessionId,
        String tags,
        double price,
        Double elevatedPrice,
        String currency,
        String enrollInviteId,
        String enrollInviteAvailability,
        ComingSoon comingSoon,
        String descriptionHtml,
        String aboutHtml,
        String whyLearnHtml,
        String whoShouldLearnHtml,
        String imageMediaId,
        String courseMediaId,
        List<Person> instructors,
        Double rating,
        Instant createdAt,
        String sessionName,
        String packageType,
        String previewImageId,
        String bannerImageId,
        String thumbnailId,
        Long readTimeMinutes,
        Integer availableSlots,
        Integer maxSeats) {

    /** The fields added for the catalogue's discovery data default to absent (tests build rows directly). */
    public CatalogRow(String packageId, String packageSessionId, String title, String levelName, String levelId,
                      String sessionId, String tags, double price, Double elevatedPrice, String currency,
                      String enrollInviteId, String enrollInviteAvailability, ComingSoon comingSoon,
                      String descriptionHtml, String aboutHtml, String whyLearnHtml, String whoShouldLearnHtml,
                      String imageMediaId, String courseMediaId, List<Person> instructors, Double rating,
                      Instant createdAt) {
        this(packageId, packageSessionId, title, levelName, levelId, sessionId, tags, price, elevatedPrice, currency,
                enrollInviteId, enrollInviteAvailability, comingSoon, descriptionHtml, aboutHtml, whyLearnHtml,
                whoShouldLearnHtml, imageMediaId, courseMediaId, instructors, rating, createdAt, null, null,
                imageMediaId, null, null, null, null, null);
    }

    /**
     * A course switched to Coming Soon (only built when the setting is on): {@code readComingSoon}
     * in {@code -utils/coming-soon.ts} (texts trimmed, blank = absent).
     */
    public record ComingSoon(String launchDate, String audienceId, String ribbonText, String buttonText) {
        public ComingSoon(String launchDate, String audienceId) {
            this(launchDate, audienceId, null, null);
        }
    }

    /** The name the hosted site files the version under for its Instructor filter: the first instructor's. */
    public String firstInstructorName() {
        return instructors == null || instructors.isEmpty() ? null : instructors.get(0).name();
    }

    /**
     * A course instructor / author as the public pages may show them (never an email).
     * {@code role} is their display role in this course (Author / Instructor / Acharya ...),
     * null when the admin set none.
     */
    public record Person(String id, String name, String imageFileId, String subtitle, String bioHtml, String role) {
        public Person(String id, String name, String imageFileId, String subtitle, String bioHtml) {
            this(id, name, imageFileId, subtitle, bioHtml, null);
        }
    }

    public static CatalogRow from(PackageDetailV2DTO d) {
        ComingSoonDTO cs = d.getComingSoon();
        ComingSoon comingSoon = cs != null && Boolean.TRUE.equals(cs.getEnabled())
                ? new ComingSoon(trimToNull(cs.getLaunchDate()), trimToNull(cs.getAudienceId()),
                trimToNull(cs.getRibbonText()), trimToNull(cs.getButtonText()))
                : null;
        List<Person> people = new ArrayList<>();
        if (d.getInstructors() != null) {
            for (UserDTO u : d.getInstructors()) {
                if (u == null) continue;
                people.add(new Person(u.getId(), trimToNull(u.getFullName()), trimToNull(u.getProfilePicFileId()),
                        trimToNull(u.getAuthorSubtitle()), u.getAuthorDescription(), trimToNull(u.getRoleLabel())));
            }
        }
        String image = firstText(d.getCoursePreviewImageMediaId(), d.getCourseBannerMediaId(), d.getThumbnailFileId());
        return new CatalogRow(
                d.getId(),
                d.getPackageSessionId(),
                d.getPackageName() == null ? "" : d.getPackageName(),
                d.getLevelName(),
                d.getLevelId(),
                d.getSessionId(),
                d.getCommaSeparetedTags(),
                d.getMinPlanActualPrice() == null ? 0 : d.getMinPlanActualPrice(),
                d.getMinPlanElevatedPrice(),
                d.getCurrency(),
                trimToNull(d.getEnrollInviteId()),
                d.getEnrollInviteAvailability(),
                comingSoon,
                d.getCourseHtmlDescriptionHtml(),
                d.getAboutTheCourseHtml(),
                d.getWhyLearnHtml(),
                d.getWhoShouldLearnHtml(),
                image,
                d.getCourseMediaId(),
                people,
                d.getRating(),
                d.getCreatedAt() == null ? null : d.getCreatedAt().toInstant(),
                trimToNull(d.getSessionName()),
                trimToNull(d.getPackageType()),
                firstText(d.getCoursePreviewImageMediaId()),
                firstText(d.getCourseBannerMediaId()),
                firstText(d.getThumbnailFileId()),
                d.getReadTimeInMinutes(),
                d.getAvailableSlots(),
                d.getMaxSeats());
    }

    private static String firstText(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank() && !"null".equals(v.trim()) && !"undefined".equals(v.trim())) {
                return v.trim();
            }
        }
        return null;
    }

    private static String trimToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
