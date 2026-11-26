package vacademy.io.admin_core_service.features.syllabus_progress;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusProgressService;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusScope;
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
