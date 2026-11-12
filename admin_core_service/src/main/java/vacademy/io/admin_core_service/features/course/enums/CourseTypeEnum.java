package vacademy.io.admin_core_service.features.course.enums;

/**
 * Enum representing the type of course/product.
 * Used in bulk course creation and course management.
 */
public enum CourseTypeEnum {
    COURSE,
    MEMBERSHIP,
    PRODUCT,
    SERVICE;

    public static final String DEFAULT = "COURSE";

    /** Whether a {@code package.package_type} value is a membership (ReadOnRent's rent plans). */
    public static boolean isMembership(String packageType) {
        return packageType != null && MEMBERSHIP.name().equalsIgnoreCase(packageType.trim());
    }

    /**
     * Safely parses the given string to a CourseTypeEnum.
     * Returns the default (COURSE) if input is null, blank, or invalid.
     *
     * @param courseType input string
     * @return corresponding CourseTypeEnum, or COURSE if invalid
     */
    public static CourseTypeEnum fromStringOrDefault(String courseType) {
        if (courseType == null || courseType.isBlank()) {
            return COURSE;
        }
        try {
            return CourseTypeEnum.valueOf(courseType.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return COURSE;
        }
    }

    /**
     * Parses the given string to a CourseTypeEnum.
     *
     * @param courseType input string
     * @return corresponding CourseTypeEnum
     * @throws IllegalArgumentException if input is null, blank, or invalid
     */
    public static CourseTypeEnum fromString(String courseType) {
        if (courseType == null || courseType.isBlank()) {
            throw new IllegalArgumentException("CourseType cannot be null or blank.");
        }
        try {
            return CourseTypeEnum.valueOf(courseType.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid CourseType: " + courseType, e);
        }
    }
}
