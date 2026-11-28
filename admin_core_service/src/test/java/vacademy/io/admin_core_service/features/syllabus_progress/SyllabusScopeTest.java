package vacademy.io.admin_core_service.features.syllabus_progress;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusProgressService;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusScope;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SyllabusScopeTest {

    private static final String INSTITUTE = "inst-1";
    private final InstituteAccessValidator validator = new InstituteAccessValidator();

    @BeforeEach
    void clientIdHeaderMatchesInstitute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** Learners and staff alike carry the root flag in prod, so every principal here sets it. */
    private static CustomUserDetails rootPrincipal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    void rootLearnerIsRefused() {
        assertThrows(ForbiddenException.class,
                () -> SyllabusScope.resolve(validator, rootPrincipal("STUDENT"), INSTITUTE, () -> Set.of("ps-1")));
    }

    @Test
    void rootTeacherIsScopedToAssignedBatches() {
        SyllabusScope scope = SyllabusScope.resolve(validator, rootPrincipal("TEACHER"), INSTITUTE, () -> Set.of("ps-1"));
        assertFalse(scope.all());
        assertTrue(scope.allows("ps-1"));
        assertFalse(scope.allows("ps-2"));
    }

    @Test
    void rootAdminSeesAll() {
        assertTrue(SyllabusScope.resolve(validator, rootPrincipal("ADMIN"), INSTITUTE, Set::of).all());
    }

    @Test
    void staffOfAnotherInstituteIsRefused() {
        assertThrows(ForbiddenException.class,
                () -> SyllabusScope.resolve(validator, rootPrincipal("ADMIN"), "inst-2", Set::of));
    }

    private static final List<Map<String, Object>> ROWS = List.of(
            Map.of("package_session_id", "ps-1"),
            Map.of("package_session_id", "ps-2"),
            Map.of("package_session_id", "ps-3"));

    @Test
    void adminSeesEveryBatchAndNeverLoadsAssignments() {
        AtomicInteger lookups = new AtomicInteger();
        SyllabusScope scope = SyllabusScope.of(true, () -> {
            lookups.incrementAndGet();
            return Set.of();
        });
        assertTrue(scope.all());
        assertEquals("ALL", scope.name());
        assertTrue(scope.allows("anything"));
        assertEquals(3, scope.filter(ROWS).size());
        assertEquals(0, lookups.get());
    }

    @Test
    void teacherSeesOnlyAssignedBatches() {
        SyllabusScope scope = SyllabusScope.of(false, () -> Set.of("ps-1", "ps-3"));
        assertFalse(scope.all());
        assertEquals("ASSIGNED", scope.name());
        assertTrue(scope.allows("ps-1"));
        assertFalse(scope.allows("ps-2"));
        assertFalse(scope.allows(null));
        assertEquals(List.of("ps-1", "ps-3"),
                scope.filter(ROWS).stream().map(r -> r.get("package_session_id")).toList());
    }

    @Test
    void teacherWithNoAssignmentsSeesNothing() {
        SyllabusScope empty = SyllabusScope.of(false, Set::of);
        SyllabusScope failed = SyllabusScope.of(false, () -> null);
        assertTrue(empty.filter(ROWS).isEmpty());
        assertTrue(failed.filter(ROWS).isEmpty());
    }

    @Test
    void batchOutsideScopeIsRefused() {
        SyllabusScope scope = SyllabusScope.of(false, () -> Set.of("ps-1"));
        assertDoesNotThrow(() -> SyllabusProgressService.requireInScope(scope, "ps-1"));
        assertThrows(ForbiddenException.class, () -> SyllabusProgressService.requireInScope(scope, "ps-2"));
        assertDoesNotThrow(() -> SyllabusProgressService.requireInScope(SyllabusScope.of(true, Set::of), "ps-2"));
    }
}
