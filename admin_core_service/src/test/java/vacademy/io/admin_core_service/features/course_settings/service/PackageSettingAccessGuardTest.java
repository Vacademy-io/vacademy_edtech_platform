package vacademy.io.admin_core_service.features.course_settings.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.course_settings.controller.PackageSettingController;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * /package/setting/v1 took only a package id and checked nothing: any signed-in user could
 * rewrite any course's settings (drip rules, tutor mode) or read its LMS credentials. The course
 * must belong to the clientId institute, and the caller be staff there or the course's creator.
 */
class PackageSettingAccessGuardTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";
    private static final String COURSE = "pkg-1";
    private static final String FOREIGN_COURSE = "pkg-foreign";

    private final PackageRepository packageRepository = mock(PackageRepository.class);
    private final PackageInstituteRepository packageInstituteRepository = mock(PackageInstituteRepository.class);
    private final PackageSettingAccessGuard guard = new PackageSettingAccessGuard(
            new InstituteAccessValidator(), packageRepository, packageInstituteRepository);

    @BeforeEach
    void setUp() {
        clientIdHeader(INSTITUTE);
        when(packageInstituteRepository.existsLink(COURSE, INSTITUTE)).thenReturn(true);
        when(packageInstituteRepository.existsLink(FOREIGN_COURSE, OTHER_INSTITUTE)).thenReturn(true);
        PackageEntity course = new PackageEntity();
        course.setId(COURSE);
        course.setCreatedByUserId("creator");
        when(packageRepository.findById(COURSE)).thenReturn(Optional.of(course));
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /** Root flag set on every principal: learners and invited staff are root users too. */
    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    @DisplayName("staff of the course's institute pass: admin, teacher, custom role")
    void staffPass() {
        assertDoesNotThrow(() -> guard.requireCanAccess(principal("admin", "ADMIN"), COURSE));
        assertDoesNotThrow(() -> guard.requireCanAccess(principal("teacher", "TEACHER"), COURSE));
        assertDoesNotThrow(() -> guard.requireCanAccess(principal("ops", "COURSE_OPS", "PERM"), COURSE));
    }

    @Test
    @DisplayName("the course's creator passes even as a learner-creator [STUDENT, TEACHER]")
    void creatorPasses() {
        assertDoesNotThrow(() -> guard.requireCanAccess(principal("creator", "STUDENT", "TEACHER"), COURSE));
    }

    @Test
    @DisplayName("a creator with no role in the clientId institute is refused")
    void creatorWithoutMembershipRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireCanAccess(principal("creator"), COURSE));
    }

    @Test
    @DisplayName("learners who did not create the course are refused")
    void otherLearnersRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireCanAccess(principal("learner", "STUDENT"), COURSE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanAccess(principal("learner2", "STUDENT", "TEACHER"), COURSE));
    }

    @Test
    @DisplayName("a course of another institute is refused, even to an admin of the clientId institute")
    void foreignCourseRefused() {
        assertThrows(ForbiddenException.class, () -> guard.requireCanAccess(principal("admin", "ADMIN"), FOREIGN_COURSE));
        clientIdHeader(null);
        assertThrows(ForbiddenException.class, () -> guard.requireCanAccess(principal("admin", "ADMIN"), COURSE));
    }

    @Test
    @DisplayName("apply-institute-lms: staff of that institute, course linked to it")
    void applyInstituteLms() {
        assertDoesNotThrow(() -> guard.requireCanApplyInstituteLms(principal("admin", "ADMIN"), INSTITUTE, COURSE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanApplyInstituteLms(principal("admin", "ADMIN"), INSTITUTE, FOREIGN_COURSE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanApplyInstituteLms(principal("admin", "ADMIN"), OTHER_INSTITUTE, FOREIGN_COURSE));
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanApplyInstituteLms(principal("creator", "STUDENT", "TEACHER"), INSTITUTE, COURSE));
    }

    @Test
    @DisplayName("every controller route consults the guard before the service")
    void controllerChecksFirst() {
        PackageSettingService service = mock(PackageSettingService.class);
        LmsSettingService lms = mock(LmsSettingService.class);
        PackageSettingAccessGuard mockGuard = mock(PackageSettingAccessGuard.class);
        PackageSettingController controller = new PackageSettingController(service, lms, mockGuard);
        CustomUserDetails caller = principal("learner", "STUDENT");
        doThrow(new ForbiddenException("no")).when(mockGuard).requireCanAccess(caller, COURSE);
        doThrow(new ForbiddenException("no")).when(mockGuard).requireCanApplyInstituteLms(caller, INSTITUTE, COURSE);

        assertThrows(ForbiddenException.class, () -> controller.getRaw(caller, COURSE));
        assertThrows(ForbiddenException.class, () -> controller.getAll(caller, COURSE));
        assertThrows(ForbiddenException.class, () -> controller.getSpecificSetting(caller, COURSE, "LMS_SETTING"));
        assertThrows(ForbiddenException.class, () -> controller.getSettingData(caller, COURSE, "MOODLE_SETTING"));
        assertThrows(ForbiddenException.class,
                () -> controller.saveSetting(caller, COURSE, "COURSE_SETTING", new GenericSettingRequest()));
        assertThrows(ForbiddenException.class, () -> controller.saveRaw(caller, COURSE, "{}"));
        assertThrows(ForbiddenException.class, () -> controller.applyInstituteLms(caller, INSTITUTE, COURSE));
        verifyNoInteractions(service, lms);
    }
}
