package vacademy.io.admin_core_service.features.packages.controller;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.PageImpl;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;

class OpenPackageControllerInstructorsTest {

    private final OpenPackageService service = Mockito.mock(OpenPackageService.class);
    private final OpenPackageController controller = controller();

    private OpenPackageController controller() {
        OpenPackageController c = new OpenPackageController();
        ReflectionTestUtils.setField(c, "openPackageService", service);
        return c;
    }

    private static List<UserDTO> instructors() {
        UserDTO user = new UserDTO();
        user.setId("user-1");
        user.setFullName("A. Teacher");
        user.setAuthorSubtitle("Educator");
        user.setRoleLabel("Author");
        user.setEmail("private@example.com");
        user.setMobileNumber("910000000000");
        user.setUsername("private-username");
        user.setDateOfBirth(new Date(0));
        user.setRoles(List.of("ADMIN"));
        return List.of(user);
    }

    private static void assertPublicOnly(List<UserDTO> result) {
        UserDTO user = result.get(0);
        assertEquals("user-1", user.getId());
        assertEquals("A. Teacher", user.getFullName());
        assertEquals("Educator", user.getAuthorSubtitle());
        assertEquals("Author", user.getRoleLabel());
        assertNull(user.getEmail());
        assertNull(user.getMobileNumber());
        assertNull(user.getUsername());
        assertNull(user.getDateOfBirth());
        assertNull(user.getRoles());
    }

    private static PackageDetailDTO v1Row(List<UserDTO> instructors) {
        PackageDetailDTO row = new PackageDetailDTO();
        row.setId("package-1");
        row.setInstructors(instructors);
        return row;
    }

    private static PackageDetailV2DTO v2Row(List<UserDTO> instructors) {
        PackageDetailV2DTO row = new PackageDetailV2DTO();
        row.setId("package-1");
        row.setInstructors(instructors);
        return row;
    }

    @Test
    void packageDetailReturnsPublicProfilesOnly() {
        Mockito.when(service.getPackageDetailById("package-1")).thenReturn(v1Row(instructors()));

        PackageDetailDTO body = controller.getPackageDetailById("package-1").getBody();

        assertEquals("package-1", body.getId());
        assertPublicOnly(body.getInstructors());
    }

    @Test
    void packageDetailKeepsANullResult() {
        Mockito.when(service.getPackageDetailById("missing")).thenReturn(null);

        assertNull(controller.getPackageDetailById("missing").getBody());
    }

    @Test
    void searchV1ReturnsPublicProfilesOnly() {
        Mockito.when(service.getLearnerPackageDetail(any(), anyString(), anyInt(), anyInt()))
                .thenReturn(new PageImpl<>(List.of(v1Row(instructors()), v1Row(null))));

        List<PackageDetailDTO> rows = controller.getLearnerPackages(null, "institute", 0, 10).getBody().getContent();

        assertEquals(2, rows.size());
        assertPublicOnly(rows.get(0).getInstructors());
        assertNull(rows.get(1).getInstructors());
    }

    @Test
    void searchV2ReturnsPublicProfilesOnly() {
        Mockito.when(service.getLearnerPackageDetailV2(any(), anyString(), anyInt(), anyInt()))
                .thenReturn(new PageImpl<>(List.of(v2Row(instructors()), v2Row(null))));

        List<PackageDetailV2DTO> rows = controller.getLearnerPackagesV2(null, "institute", 0, 10).getBody().getContent();

        assertEquals(2, rows.size());
        assertPublicOnly(rows.get(0).getInstructors());
        assertNull(rows.get(1).getInstructors());
    }
}
