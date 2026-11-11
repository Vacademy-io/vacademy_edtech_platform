package vacademy.io.admin_core_service.features.learner_study_library.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.LevelDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.SessionDTOWithDetails;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Level;

import java.util.Arrays;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicCourseInstructorsTest {

    private static UserDTO fullUser() {
        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setFullName("A. Teacher");
        user.setProfilePicFileId("pic-1");
        user.setAuthorSubtitle("Educator");
        user.setAuthorDescription("<p>Bio</p>");
        user.setRoleLabel("Author");
        user.setUsername("private-username");
        user.setEmail("private@example.com");
        user.setMobileNumber("910000000000");
        user.setAddressLine("private address");
        user.setCity("private city");
        user.setPinCode("000000");
        user.setGender("OTHER");
        user.setDateOfBirth(new Date(0));
        user.setLastLoginTime(new Date(0));
        user.setRoles(List.of("ADMIN"));
        user.setRootUser(true);
        user.setPassword("private-password");
        return user;
    }

    private static LevelDTOWithDetails level(List<UserDTO> instructors) {
        return new LevelDTOWithDetails(new Level(), List.of(), instructors);
    }

    private static List<CourseDTOWithDetails> courses(LevelDTOWithDetails... levels) {
        return List.of(new CourseDTOWithDetails(null,
                List.of(new SessionDTOWithDetails(null, List.of(levels)))));
    }

    @Test
    void keepsOnlyThePublicProfileInTheJson() {
        LevelDTOWithDetails level = level(List.of(fullUser()));

        PublicCourseInstructors.strip(courses(level));

        JsonNode json = new ObjectMapper().valueToTree(level.getInstructors().get(0));
        assertEquals("user-1", json.get("id").asText());
        assertEquals("A. Teacher", json.get("full_name").asText());
        assertEquals("pic-1", json.get("profile_pic_file_id").asText());
        assertEquals("Educator", json.get("author_subtitle").asText());
        assertEquals("<p>Bio</p>", json.get("author_description").asText());
        assertEquals("Author", json.get("role_label").asText());
        for (String field : List.of("username", "email", "mobile_number", "address_line", "city", "pin_code",
                "gender", "date_of_birth", "last_login_time", "roles", "password")) {
            assertTrue(!json.hasNonNull(field), field + " must not be public");
        }
        assertFalse(json.get("root_user").asBoolean());
    }

    @Test
    void doesNotChangeTheOriginalUserObject() {
        UserDTO user = fullUser();

        PublicCourseInstructors.strip(courses(level(List.of(user))));

        assertEquals("private@example.com", user.getEmail());
    }

    @Test
    void stripsEveryLevelAndKeepsOrder() {
        UserDTO second = fullUser();
        second.setId("user-2");
        LevelDTOWithDetails first = level(Arrays.asList(fullUser(), null, second));
        LevelDTOWithDetails other = level(List.of(fullUser()));

        PublicCourseInstructors.strip(courses(first, other));

        assertEquals(List.of("user-1", "user-2"),
                first.getInstructors().stream().map(UserDTO::getId).toList());
        assertNull(first.getInstructors().get(1).getEmail());
        assertNull(other.getInstructors().get(0).getEmail());
    }

    @Test
    void publicProfilesKeepsNullAndDropsNullRows() {
        assertNull(PublicCourseInstructors.publicProfiles(null));

        List<UserDTO> profiles = PublicCourseInstructors.publicProfiles(Arrays.asList(fullUser(), null));

        assertEquals(1, profiles.size());
        assertNull(profiles.get(0).getEmail());
        assertEquals("A. Teacher", profiles.get(0).getFullName());
    }

    @Test
    void handlesMissingData() {
        assertNull(PublicCourseInstructors.strip(null));

        LevelDTOWithDetails noInstructors = level(null);
        List<CourseDTOWithDetails> courses = courses(noInstructors);
        assertSame(courses, PublicCourseInstructors.strip(courses));
        assertNull(noInstructors.getInstructors());

        PublicCourseInstructors.strip(List.of(new CourseDTOWithDetails(null, null)));
        PublicCourseInstructors.strip(List.of(new CourseDTOWithDetails(null,
                List.of(new SessionDTOWithDetails(null, null)))));
    }
}
