package vacademy.io.admin_core_service.features.ai_usage.job;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AiUsageRoleBackfillJobTest {

    private static final String INST = "11111111-1111-4111-8111-111111111111";
    private static final String TEACHER = "22222222-2222-4222-8222-222222222222";
    private static final String NOBODY = "33333333-3333-4333-8333-333333333333";
    private static final String LEARNER = "44444444-4444-4444-8444-444444444444";

    /** Fake DB: the setting, the role map, one page of events, and every UPDATE it saw. */
    static class FakeDb extends JdbcTemplate {
        String setting;
        boolean roleMapMissing;
        final List<Map<String, Object>> roleMap = new ArrayList<>();
        final List<List<Map<String, Object>>> pages = new ArrayList<>();
        final List<Object[]> batchArgs = new ArrayList<>();
        final List<Object[]> updates = new ArrayList<>();
        final List<String> sql = new ArrayList<>();

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> queryForList(String s, Class<T> type, Object... args) {
            sql.add(s);
            return setting == null ? List.of() : (List<T>) List.of(setting);
        }

        @Override
        public List<Map<String, Object>> queryForList(String s) {
            sql.add(s);
            if (roleMapMissing) {
                throw new BadSqlGrammarException("q", s, new SQLException("relation does not exist"));
            }
            return roleMap;
        }

        @Override
        public List<Map<String, Object>> queryForList(String s, Object... args) {
            sql.add(s);
            batchArgs.add(args);
            return pages.isEmpty() ? List.of() : pages.remove(0);
        }

        @Override
        public int update(String s, Object... args) {
            sql.add(s);
            updates.add(args);
            return 3;
        }
    }

    private final FakeDb db = new FakeDb();
    private final AuthService auth = mock(AuthService.class);
    private final AiUsageRoleBackfillJob job = new AiUsageRoleBackfillJob(db, auth);

    private static Map<String, Object> row(String id, String inst, String user) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id);
        m.put("institute_id", inst);
        m.put("actor_user_id", user);
        return m;
    }

    private static Map<String, Object> mapRow(String role, String cls, int precedence) {
        return Map.of("role_name", role, "role_class", cls, "precedence", precedence);
    }

    @Test
    void switchedOffDoesNothing() {
        db.setting = "\"false\"";
        assertEquals(AiUsageRoleBackfillJob.Result.EMPTY, job.runOnce());
        assertTrue(db.batchArgs.isEmpty());
        verifyNoInteractions(auth);
    }

    @Test
    void missingTablesMeanIdleNotFailing() {
        db.roleMapMissing = true;
        assertEquals(AiUsageRoleBackfillJob.Result.EMPTY, job.runOnce());
        assertTrue(db.batchArgs.isEmpty());
        verifyNoInteractions(auth);
    }

    @Test
    void resolvesRolesAndNamesAndWritesOnlyTheActorColumns() {
        db.roleMap.add(mapRow("ADMIN", "ADMIN", 10));
        db.roleMap.add(mapRow("TEACHER", "TEACHER", 20));
        db.roleMap.add(mapRow("STUDENT", "LEARNER", 50));
        db.pages.add(List.of(
                row("a0000000-0000-4000-8000-000000000001", INST, TEACHER),
                row("a0000000-0000-4000-8000-000000000002", INST, TEACHER),
                row("a0000000-0000-4000-8000-000000000003", INST, NOBODY),
                row("a0000000-0000-4000-8000-000000000004", INST, LEARNER),
                row("a0000000-0000-4000-8000-000000000005", INST, "demo-visitor")));

        when(auth.getInstituteRoles(eq(INST), anyList())).thenReturn(Map.of(
                TEACHER, List.of("STUDENT", "TEACHER"),
                LEARNER, List.of("STUDENT")));
        UserDTO t = new UserDTO();
        t.setId(TEACHER);
        t.setFullName("Asha Teacher");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(t));

        AiUsageRoleBackfillJob.Result r = job.runOnce();

        assertEquals(5, r.rowsSeen());
        assertEquals(2, r.usersResolved());
        assertEquals(1, r.usersUnresolved(), "no roles = stays UNRESOLVED");
        assertEquals(6, r.rowsUpdated());
        assertEquals(2, db.updates.size(), "one UPDATE per (institute, user), never per row");
        assertArrayEquals(new Object[]{"STUDENT\u001fTEACHER", "TEACHER", "Asha Teacher", INST, TEACHER},
                db.updates.get(0), "lowest precedence wins");
        assertArrayEquals(new Object[]{"STUDENT", "LEARNER", null, INST, LEARNER}, db.updates.get(1));
        // the non-uuid actor never reaches auth_service
        verify(auth).getInstituteRoles(INST, List.of(TEACHER, NOBODY, LEARNER));
        // a short page ends the run: one batch query only
        assertEquals(1, db.batchArgs.size());
        assertArrayEquals(new Object[]{AiUsageRoleBackfillJob.FIRST_CURSOR, AiUsageRoleBackfillJob.BATCH_SIZE},
                db.batchArgs.get(0));
    }

    @Test
    void anAuthOutageWritesNothing() {
        db.pages.add(List.of(row("a0000000-0000-4000-8000-000000000001", INST, TEACHER)));
        when(auth.getInstituteRoles(any(), anyList())).thenReturn(Map.of());
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenThrow(new RuntimeException("down"));

        AiUsageRoleBackfillJob.Result r = job.runOnce();

        assertEquals(0, r.rowsUpdated());
        assertTrue(db.updates.isEmpty());
    }

    @Test
    void fullPagesAdvanceTheKeysetCursor() {
        List<Map<String, Object>> full = new ArrayList<>();
        for (int i = 0; i < AiUsageRoleBackfillJob.BATCH_SIZE; i++) {
            full.add(row(String.format("b0000000-0000-4000-8000-%012d", i), INST, "apikey:" + i));
        }
        db.pages.add(full);
        db.pages.add(List.of());

        job.runOnce();

        assertEquals(2, db.batchArgs.size());
        assertEquals(String.format("b0000000-0000-4000-8000-%012d", AiUsageRoleBackfillJob.BATCH_SIZE - 1),
                db.batchArgs.get(1)[0]);
        verify(auth, never()).getInstituteRoles(any(), anyList());
    }

    @Test
    void roleClassRules() {
        Map<String, AiUsageRoleBackfillJob.RoleClass> map = Map.of(
                "ADMIN", new AiUsageRoleBackfillJob.RoleClass("ADMIN", 10),
                "TEACHER", new AiUsageRoleBackfillJob.RoleClass("TEACHER", 20));
        assertEquals("LEARNER", AiUsageRoleBackfillJob.resolveRoleClass(List.of("STUDENT"), map).roleClass(),
                "STUDENT is LEARNER even without a map row");
        assertEquals("STAFF", AiUsageRoleBackfillJob.resolveRoleClass(List.of("Fee Collector"), map).roleClass(),
                "unmapped custom role = STAFF");
        assertEquals(35, AiUsageRoleBackfillJob.resolveRoleClass(List.of("Fee Collector"), map).precedence());
        assertEquals("ADMIN",
                AiUsageRoleBackfillJob.resolveRoleClass(List.of("teacher", "admin", "STUDENT"), map).roleClass());
        assertEquals("STAFF", AiUsageRoleBackfillJob.resolveRoleClass(List.of("Fee Collector", "STUDENT"), map)
                .roleClass(), "35 beats 50");
        assertEquals("SCHOOL_ADMIN", AiUsageRoleBackfillJob.normalizeRole(" school-admin "));
        assertEquals("CONTENT_CREATOR", AiUsageRoleBackfillJob.normalizeRole("Content Creator"));
    }

    @Test
    void settingParsing() {
        assertTrue(AiUsageRoleBackfillJob.isFalse("false"));
        assertTrue(AiUsageRoleBackfillJob.isFalse("\"false\""));
        assertFalse(AiUsageRoleBackfillJob.isFalse("true"));
        assertFalse(AiUsageRoleBackfillJob.isFalse(null));
        assertTrue(job.isEnabled(), "absent = on");
    }

    @Test
    void sqlFollowsTheNativeQueryRules() {
        for (String s : List.of(AiUsageRoleBackfillJob.SELECT_BATCH, AiUsageRoleBackfillJob.UPDATE_ACTOR,
                AiUsageRoleBackfillJob.SELECT_SETTING, AiUsageRoleBackfillJob.SELECT_ROLE_MAP,
                AiUsageRoleBackfillJob.SELECT_SUBJECT_BATCH, AiUsageRoleBackfillJob.UPDATE_SUBJECT_NAME)) {
            assertFalse(s.contains(":"), "no ':' casts or named params: " + s);
            for (String line : s.split("\n")) {
                assertFalse(line.endsWith(" "), "no trailing space: [" + line + "]");
            }
        }
        // only the four actor columns are written
        String set = AiUsageRoleBackfillJob.UPDATE_ACTOR.substring(
                AiUsageRoleBackfillJob.UPDATE_ACTOR.indexOf("SET"), AiUsageRoleBackfillJob.UPDATE_ACTOR.indexOf("WHERE"));
        java.util.Set<String> written = new java.util.TreeSet<>();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("([a-z_]+) = ").matcher(set);
        while (m.find()) written.add(m.group(1));
        assertEquals(java.util.Set.of("actor_roles_raw", "actor_role_class", "role_source", "actor_display_name"),
                written);
    }

    @Test
    void fillsSubjectNamesOnlyAndOncePerSubject() {
        Map<String, Object> a = new HashMap<>();
        a.put("id", "b0000000-0000-4000-8000-000000000001");
        a.put("subject_user_id", LEARNER);
        Map<String, Object> b = new HashMap<>(a);
        b.put("id", "b0000000-0000-4000-8000-000000000002");
        Map<String, Object> c = new HashMap<>();
        c.put("id", "b0000000-0000-4000-8000-000000000003");
        c.put("subject_user_id", "not-a-uuid");
        db.pages.add(List.of(a, b, c));
        UserDTO l = new UserDTO();
        l.setId(LEARNER);
        l.setFullName("Ravi Learner");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(l));

        assertEquals(3, job.fillSubjectNames());
        assertEquals(1, db.updates.size(), "one UPDATE per subject");
        assertArrayEquals(new Object[]{"Ravi Learner", LEARNER}, db.updates.get(0));
        verify(auth).getUsersFromAuthServiceByUserIds(List.of(LEARNER));
        String set = AiUsageRoleBackfillJob.UPDATE_SUBJECT_NAME.substring(
                AiUsageRoleBackfillJob.UPDATE_SUBJECT_NAME.indexOf("SET"),
                AiUsageRoleBackfillJob.UPDATE_SUBJECT_NAME.indexOf("WHERE"));
        assertEquals("SET subject_display_name = ?", set.trim());
    }

    @Test
    void subjectNamesSwitchedOffDoesNothing() {
        db.setting = "false";
        assertEquals(0, job.fillSubjectNames());
        assertTrue(db.batchArgs.isEmpty());
        verifyNoInteractions(auth);
    }
}
