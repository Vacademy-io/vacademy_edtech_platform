package vacademy.io.auth_service.feature.user.audit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.auth_service.feature.user.audit.RoleStatusAuditClient.RoleRowState;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoleStatusAuditClientTest {

    private static final String INSTITUTE = "inst-1";

    private RoleStatusAuditSender sender;
    private RoleStatusAuditClient client;
    private CustomUserDetails admin;

    @BeforeEach
    void setUp() {
        sender = mock(RoleStatusAuditSender.class);
        client = new RoleStatusAuditClient(sender);
        admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        when(admin.getFullName()).thenReturn("Ravi Mehta");
        when(admin.getUsername()).thenReturn("ravi123");
    }

    private static Map<String, RoleRowState> rows(RoleRowState... states) {
        Map<String, RoleRowState> map = new LinkedHashMap<>();
        for (RoleRowState s : states) {
            map.put(s.rowId(), s);
        }
        return map;
    }

    private static RoleRowState row(String rowId, String userId, String role, String status) {
        return new RoleRowState(rowId, userId, "Asha Verma", "asha@example.com", role, status);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sentBodies() {
        ArgumentCaptor<List<Map<String, Object>>> captor = ArgumentCaptor.forClass(List.class);
        verify(sender).send(captor.capture());
        return captor.getValue();
    }

    @Test
    void deleteRecordsOneRowPerMemberWithActorAndOldStatus() {
        client.record(admin, INSTITUTE, "DELETED",
                rows(row("r1", "u1", "TEACHER", "ACTIVE"), row("r2", "u1", "STUDENT", "ACTIVE")),
                rows(row("r1", "u1", "TEACHER", "DELETED"), row("r2", "u1", "STUDENT", "DELETED")));

        List<Map<String, Object>> bodies = sentBodies();
        assertEquals(1, bodies.size());
        Map<String, Object> body = bodies.get(0);
        assertEquals("MEMBER_ACCESS", body.get("entity_type"));
        assertEquals("u1", body.get("entity_id"));
        assertEquals("DELETE", body.get("action"));
        assertEquals("admin-1", body.get("actor_id"));
        assertEquals("Ravi Mehta", body.get("actor_name"));
        assertEquals("deleted Asha Verma <asha@example.com> (TEACHER, STUDENT)", body.get("description"));
        assertEquals(INSTITUTE, body.get("institute_id"));
        Map<String, Object> before = (Map<String, Object>) body.get("before_payload");
        assertEquals(List.of(Map.of("role", "TEACHER", "status", "ACTIVE"), Map.of("role", "STUDENT", "status", "ACTIVE")),
                before.get("roles"));
        assertEquals("DELETED", ((Map<String, Object>) body.get("request_payload")).get("status"));
    }

    @Test
    void onlyRowsWhoseStatusMovedAreReported() {
        // Disable leaves an already deleted row alone; only the TEACHER row moved.
        client.record(admin, INSTITUTE, "DISABLED",
                rows(row("r1", "u1", "TEACHER", "ACTIVE"), row("r2", "u1", "COUNSELLOR", "DELETED")),
                rows(row("r1", "u1", "TEACHER", "DISABLED"), row("r2", "u1", "COUNSELLOR", "DELETED")));

        Map<String, Object> body = sentBodies().get(0);
        assertEquals("DISABLE_ACCESS", body.get("action"));
        assertEquals("disabled access for Asha Verma <asha@example.com> (TEACHER)", body.get("description"));
    }

    @Test
    void nothingChangedMeansNothingSent() {
        // e.g. enabling someone who was never disabled
        client.record(admin, INSTITUTE, "ACTIVE",
                rows(row("r1", "u1", "TEACHER", "ACTIVE")),
                rows(row("r1", "u1", "TEACHER", "ACTIVE")));
        verify(sender, never()).send(any());
    }

    @Test
    void selfDeleteSaysOwnAccount() {
        when(admin.getUserId()).thenReturn("u1");
        client.record(admin, INSTITUTE, "DELETED",
                rows(row("r1", "u1", "STUDENT", "ACTIVE")),
                rows(row("r1", "u1", "STUDENT", "DELETED")));
        assertEquals("deleted their own account (STUDENT)", sentBodies().get(0).get("description"));
    }

    @Test
    void senderFailureNeverReachesTheCaller() {
        doThrow(new RuntimeException("boom")).when(sender).send(any());
        assertDoesNotThrow(() -> client.record(admin, INSTITUTE, "DELETED",
                rows(row("r1", "u1", "TEACHER", "ACTIVE")),
                rows(row("r1", "u1", "TEACHER", "DELETED"))));
    }

    @Test
    void snapshotWithoutEntityManagerIsEmpty() {
        assertTrue(client.snapshot(INSTITUTE, List.of("u1")).isEmpty());
    }

    @Test
    void actionMapping() {
        assertEquals("DELETE", RoleStatusAuditClient.action("DELETED"));
        assertEquals("DELETE", RoleStatusAuditClient.action("DELETE"));
        assertEquals("ENABLE_ACCESS", RoleStatusAuditClient.action("ACTIVE"));
        assertEquals("CANCEL", RoleStatusAuditClient.action("CANCEL"));
        assertEquals("STATUS_CHANGE", RoleStatusAuditClient.action("INACTIVE"));
    }
}
