package vacademy.io.admin_core_service.features.faculty.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.faculty.dto.FacultyRoleLabelRow;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Per-course author role (Author / Instructor / Acharya ...) on faculty mappings: how it is
 * stored from Add Course and how it is put on the instructor lists the pages read.
 */
@ExtendWith(MockitoExtension.class)
class CourseRoleLabelServiceTest {

    @Mock
    private FacultySubjectPackageSessionMappingRepository facultyRepository;
    @InjectMocks
    private CourseRoleLabelService service;

    private static UserDTO user(String id) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setFullName("Name " + id);
        u.setEmail(id + "@x.test");
        u.setAuthorSubtitle("sub " + id);
        u.setProfilePicFileId("pic-" + id);
        u.setRootUser(true);
        return u;
    }

    private static FacultyRoleLabelRow row(String packageId, String userId, String label) {
        return new FacultyRoleLabelRow() {
            public String getPackageId() { return packageId; }
            public String getUserId() { return userId; }
            public String getRoleLabel() { return label; }
        };
    }

    @Test
    @DisplayName("normalize trims, blanks become null, long input is cut to the column size")
    void normalize() {
        assertNull(CourseRoleLabelService.normalize(null));
        assertNull(CourseRoleLabelService.normalize("   "));
        assertEquals("Acharya", CourseRoleLabelService.normalize("  Acharya "));
        assertEquals(CourseRoleLabelService.MAX_LENGTH, CourseRoleLabelService.normalize("a".repeat(150)).length());
    }

    @Test
    @DisplayName("same person keeps a different role per course and the shared UserDTO is never mutated")
    void labelsArePerCourseAndCopied() {
        UserDTO shared = user("u1");
        UserDTO other = user("u2");
        when(facultyRepository.findRoleLabelsByPackageIds(any()))
                .thenReturn(List.of(row("c1", "u1", "Acharya"), row("c2", "u1", "Instructor")));

        Map<String, Map<String, String>> labels = service.labelsByPackage(List.of("c1", "c2"));
        List<UserDTO> c1 = service.withRoleLabels(List.of(shared, other), labels.get("c1"));
        List<UserDTO> c2 = service.withRoleLabels(List.of(shared), labels.get("c2"));

        assertEquals("Acharya", c1.get(0).getRoleLabel());
        assertEquals("Instructor", c2.get(0).getRoleLabel());
        assertNull(shared.getRoleLabel());
        assertSame(other, c1.get(1));
        // the copy keeps every other field
        assertEquals("Name u1", c1.get(0).getFullName());
        assertEquals("sub u1", c1.get(0).getAuthorSubtitle());
        assertEquals("pic-u1", c1.get(0).getProfilePicFileId());
        assertTrue(c1.get(0).isRootUser());
    }

    @Test
    @DisplayName("no labels for the course returns the list as is")
    void noLabels() {
        List<UserDTO> list = List.of(user("u1"));
        assertSame(list, service.withRoleLabels(list, null));
        assertSame(list, service.withRoleLabels(list, Map.of()));
    }

    @Test
    @DisplayName("no course ids skips the query, a failing query only drops the labels")
    void bestEffort() {
        assertTrue(service.labelsByPackage(List.of()).isEmpty());
        verifyNoInteractions(facultyRepository);

        when(facultyRepository.findRoleLabelsByPackageIds(any())).thenThrow(new RuntimeException("db down"));
        assertTrue(service.labelsByPackage(List.of("c1")).isEmpty());
    }

    @Test
    @DisplayName("Add Course stores the trimmed role on new rows; edit with no role keeps the stored one")
    @SuppressWarnings("unchecked")
    void facultyServiceWritesRole() {
        FacultyService facultyService = new FacultyService(facultyRepository, null, null, null);
        UserDTO u = new UserDTO();
        u.setId("u1");
        u.setFullName("A");

        AddFacultyToCourseDTO add = new AddFacultyToCourseDTO();
        add.setUser(u);
        add.setRoleLabel("  Acharya ");
        facultyService.addFacultyToBatch(List.of(add), "ps1", "inst");
        ArgumentCaptor<List<FacultySubjectPackageSessionMapping>> saved = ArgumentCaptor.forClass(List.class);
        verify(facultyRepository).saveAll(saved.capture());
        assertEquals("Acharya", saved.getValue().get(0).getRoleLabel());

        FacultySubjectPackageSessionMapping existing = new FacultySubjectPackageSessionMapping("u1", "ps1", null, "A", "ACTIVE");
        existing.setRoleLabel("Acharya");
        when(facultyRepository.findMappingsByUserIdAndPackageSessionIdAndStatusesWithNoSubject(eq("u1"), eq("ps1"), anyList()))
                .thenReturn(Optional.of(existing));
        AddFacultyToCourseDTO keep = new AddFacultyToCourseDTO();
        keep.setUser(u);
        facultyService.updateFacultyToSubjectPackageSession(List.of(keep), "ps1", "inst");
        assertEquals("Acharya", existing.getRoleLabel());

        // a duplicate ACTIVE course-level row of the same user gets the new role too
        existing.setId("row-1");
        FacultySubjectPackageSessionMapping duplicate = new FacultySubjectPackageSessionMapping("u1", "ps1", null, "A", "ACTIVE");
        duplicate.setId("row-2");
        duplicate.setRoleLabel("Instructor");
        when(facultyRepository.findAllByUserIdAndPackageSessionIdAndSubjectIdIsNullAndStatusIn(eq("u1"), eq("ps1"), anyList()))
                .thenReturn(List.of(existing, duplicate));
        AddFacultyToCourseDTO relabel = new AddFacultyToCourseDTO();
        relabel.setUser(u);
        relabel.setRoleLabel("Acharya");
        facultyService.updateFacultyToSubjectPackageSession(List.of(relabel), "ps1", "inst");
        assertEquals("Acharya", existing.getRoleLabel());
        assertEquals("Acharya", duplicate.getRoleLabel());

        AddFacultyToCourseDTO clear = new AddFacultyToCourseDTO();
        clear.setUser(u);
        clear.setRoleLabel("");
        facultyService.updateFacultyToSubjectPackageSession(List.of(clear), "ps1", "inst");
        assertNull(existing.getRoleLabel());
        assertNull(duplicate.getRoleLabel());
    }
}
