package vacademy.io.admin_core_service.features.learner_study_library.util;

import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.LevelDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.SessionDTOWithDetails;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Objects;

/**
 * Reduces course instructors to what a public page may show. Open endpoints need no login and
 * their responses are publicly cacheable, so contact details and account data must not be in them.
 */
public final class PublicCourseInstructors {

    private PublicCourseInstructors() {
    }

    /** Applies {@link #publicProfile} to every level's instructors. Returns the same list. */
    public static List<CourseDTOWithDetails> strip(List<CourseDTOWithDetails> courses) {
        if (courses == null) {
            return null;
        }
        courses.stream()
                .filter(Objects::nonNull)
                .map(CourseDTOWithDetails::getSessions)
                .filter(Objects::nonNull)
                .flatMap(List::stream)
                .filter(Objects::nonNull)
                .map(SessionDTOWithDetails::getLevelWithDetails)
                .filter(Objects::nonNull)
                .flatMap(List::stream)
                .filter(Objects::nonNull)
                .forEach(PublicCourseInstructors::stripLevel);
        return courses;
    }

    private static void stripLevel(LevelDTOWithDetails level) {
        level.setInstructors(publicProfiles(level.getInstructors()));
    }

    /** Copies holding only the public fields, in the same order. Null stays null. */
    public static List<UserDTO> publicProfiles(List<UserDTO> instructors) {
        if (instructors == null) {
            return null;
        }
        return instructors.stream()
                .filter(Objects::nonNull)
                .map(PublicCourseInstructors::publicProfile)
                .toList();
    }

    /** A copy holding only the fields the public course pages read. */
    static UserDTO publicProfile(UserDTO user) {
        UserDTO profile = new UserDTO();
        profile.setId(user.getId());
        profile.setFullName(user.getFullName());
        profile.setProfilePicFileId(user.getProfilePicFileId());
        profile.setAuthorSubtitle(user.getAuthorSubtitle());
        profile.setAuthorDescription(user.getAuthorDescription());
        profile.setRoleLabel(user.getRoleLabel());
        return profile;
    }
}
