package vacademy.io.admin_core_service.features.level.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.jpa.repository.Query;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.group.service.GroupService;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.repository.LevelRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Level delete acts only inside the institute named by the clientId header: the caller needs a
 * staff role there, every id must be used by that institute, and only its batches are touched.
 */
class LevelDeleteInstituteScopeTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OWN = "level-own";
    private static final String SHARED = "level-shared";
    private static final String FOREIGN = "level-foreign";

    private final LevelRepository levelRepository = mock(LevelRepository.class);
    private final PackageSessionRepository packageSessionRepository = mock(PackageSessionRepository.class);
    private final LearnerInvitationService learnerInvitationService = mock(LearnerInvitationService.class);
    private final LevelService service = new LevelService(levelRepository, mock(PackageRepository.class),
            mock(PackageSessionService.class), mock(SessionRepository.class), packageSessionRepository,
            learnerInvitationService, mock(GroupService.class));

    /** Root flag set on every principal: it must never decide anything here. */
    private static CustomUserDetails principal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("user-1");
        dto.setUsername("user-1");
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static PackageSession batch(String id, String levelId) {
        Level level = new Level();
        level.setId(levelId);
        Session session = new Session();
        session.setId("session-x");
        PackageSession ps = new PackageSession();
        ps.setId(id);
        ps.setLevel(level);
        ps.setSession(session);
        ps.setStatus("ACTIVE");
        return ps;
    }

    private Level levelRow(String id) {
        Level row = new Level();
        row.setId(id);
        row.setStatus("ACTIVE");
        when(levelRepository.findAllById(List.of(id))).thenReturn(List.of(row));
        return row;
    }

    private void instituteBatches(List<String> ids, PackageSession... rows) {
        when(packageSessionRepository.findByLevelIdsAndInstituteId(ids, INSTITUTE)).thenReturn(List.of(rows));
    }

    private void assertNothingWritten() {
        verify(packageSessionRepository, never()).saveAll(any());
        verify(packageSessionRepository, never()).save(any());
        verify(levelRepository, never()).saveAll(any());
        verify(levelRepository, never()).save(any());
        verify(learnerInvitationService, never()).deleteLearnerInvitationBySourceAndSourceId(anyString(), anyList());
        verify(packageSessionRepository, never()).updateStatusByLevelIds(anyString(), anyList());
    }

    private void assertBadRequest(List<String> ids) {
        VacademyException ex = assertThrows(VacademyException.class,
                () -> service.deleteLevels(ids, INSTITUTE, principal("ADMIN")));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
    }

    @Test
    @DisplayName("DEFAULT and INVITED are refused with 400, trimmed and in any case, even next to an own id")
    void sharedRowsRefused() {
        for (String id : List.of("DEFAULT", "INVITED", "default", " Invited ", "\tdEfAuLt\n")) {
            assertBadRequest(List.of(id));
            assertBadRequest(List.of(OWN, id));
        }
        assertNothingWritten();
        verify(packageSessionRepository, never()).findByLevelIdsAndInstituteId(anyList(), anyString());
    }

    @Test
    @DisplayName("an empty list, a null list, a blank id and more than 500 ids are refused with 400")
    void badListsRefused() {
        assertBadRequest(List.of());
        assertBadRequest(null);
        assertBadRequest(Arrays.asList(OWN, " "));
        assertBadRequest(Arrays.asList(OWN, null));
        assertBadRequest(new ArrayList<>(Collections.nCopies(501, OWN)));
        assertNothingWritten();
    }

    @Test
    @DisplayName("exactly 500 ids are accepted")
    void fiveHundredIdsAccepted() {
        List<String> ids = new ArrayList<>(Collections.nCopies(500, OWN));
        instituteBatches(List.of(OWN), batch("ps-1", OWN));
        levelRow(OWN);
        assertEquals("Levels deleted successfully", service.deleteLevels(ids, INSTITUTE, principal("ADMIN")));
    }

    @Test
    @DisplayName("a missing, blank or literal null clientId header is refused with 403")
    void missingHeaderRefused() {
        instituteBatches(List.of(OWN), batch("ps-1", OWN));
        for (String header : Arrays.asList(null, "", "   ", "null")) {
            assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), header, principal("ADMIN")));
        }
        assertNothingWritten();
        verify(packageSessionRepository, never()).findByLevelIdsAndInstituteId(any(), any());
    }

    @Test
    @DisplayName("a caller holding only learner roles, or no role, in the institute is refused with 403")
    void learnerRefused() {
        instituteBatches(List.of(OWN), batch("ps-1", OWN));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("STUDENT")));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("student")));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("PARENT")));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("GUARDIAN", "STUDENT")));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("LEARNER")));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal("learner", "STUDENT")));
        // Root user of another institute: authorities are loaded for the clientId institute, so none here.
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, principal()));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(OWN), INSTITUTE, null));
        assertNothingWritten();
        verify(packageSessionRepository, never()).findByLevelIdsAndInstituteId(anyList(), anyString());
    }

    @Test
    @DisplayName("staff who also hold a learner role pass: [STUDENT, TEACHER], [STUDENT, EVALUATOR], a custom role")
    void staffWithLearnerRolePasses() {
        for (String[] roles : List.of(new String[]{"STUDENT", "TEACHER"}, new String[]{"STUDENT", "EVALUATOR"},
                new String[]{"STUDENT", "MENTOR"}, new String[]{"STUDENT", "COUNSELLOR"}, new String[]{"STUDENT", "ADMIN"},
                new String[]{"LEARNER", "TEACHER"},
                new String[]{"PARENT", "ACCOUNTS HEAD"}, new String[]{"TEACHER"}, new String[]{"ADMIN"})) {
            instituteBatches(List.of(OWN), batch("ps-1", OWN));
            levelRow(OWN);
            assertEquals("Levels deleted successfully", service.deleteLevels(List.of(OWN), INSTITUTE, principal(roles)));
        }
    }

    @Test
    @DisplayName("an id the institute has no batch on is refused with 403")
    void foreignIdRefused() {
        instituteBatches(List.of(FOREIGN));
        assertThrows(ForbiddenException.class, () -> service.deleteLevels(List.of(FOREIGN), INSTITUTE, principal("ADMIN")));
        assertNothingWritten();
    }

    @Test
    @DisplayName("a list mixing an own and a foreign id writes nothing at all")
    void mixedListWritesNothing() {
        PackageSession own = batch("ps-1", OWN);
        instituteBatches(List.of(OWN, FOREIGN), own);
        assertThrows(ForbiddenException.class,
                () -> service.deleteLevels(List.of(OWN, FOREIGN), INSTITUTE, principal("ADMIN")));
        assertNothingWritten();
        assertEquals("ACTIVE", own.getStatus());
    }

    @Test
    @DisplayName("own level: the institute batches and the level row are marked DELETED, forms removed last")
    void ownLevelDeleted() {
        PackageSession a = batch("ps-1", OWN);
        PackageSession b = batch("ps-2", OWN);
        instituteBatches(List.of(OWN), a, b);
        when(packageSessionRepository.findLevelIdsUsedOutsideInstitute(List.of(OWN), INSTITUTE)).thenReturn(List.of());
        Level row = levelRow(OWN);

        service.deleteLevels(List.of(" " + OWN + " ", OWN), INSTITUTE, principal("ADMIN"));

        assertEquals("DELETED", a.getStatus());
        assertEquals("DELETED", b.getStatus());
        assertEquals("DELETED", row.getStatus());
        InOrder order = inOrder(packageSessionRepository, levelRepository, learnerInvitationService);
        order.verify(packageSessionRepository).saveAll(List.of(a, b));
        order.verify(levelRepository).saveAll(List.of(row));
        order.verify(learnerInvitationService).deleteLearnerInvitationBySourceAndSourceId("PACKAGE_SESSION", List.of("ps-1", "ps-2"));
        verify(packageSessionRepository, never()).updateStatusByLevelIds(anyString(), anyList());
        verify(packageSessionRepository, never()).findByLevelIds(anyList());
    }

    @Test
    @DisplayName("a level another institute still uses keeps its row and the other institute's batches")
    void sharedLevelKeepsRowAndOtherBatches() {
        PackageSession mine = batch("ps-mine", SHARED);
        PackageSession theirs = batch("ps-theirs", SHARED);
        PackageSession ownBatch = batch("ps-own", OWN);
        List<String> ids = List.of(SHARED, OWN);
        instituteBatches(ids, mine, ownBatch);
        // The unscoped lookups would return the other institute's batch as well.
        when(packageSessionRepository.findByLevelIds(anyList())).thenReturn(List.of(mine, theirs, ownBatch));
        when(packageSessionRepository.findLevelIdsUsedOutsideInstitute(ids, INSTITUTE)).thenReturn(List.of(SHARED));
        Level sharedRow = new Level();
        sharedRow.setId(SHARED);
        sharedRow.setStatus("ACTIVE");
        Level ownRow = levelRow(OWN);
        // An unscoped retire would load and delete both rows.
        when(levelRepository.findAllById(ids)).thenReturn(List.of(sharedRow, ownRow));

        service.deleteLevels(ids, INSTITUTE, principal("STUDENT", "TEACHER"));

        assertEquals("DELETED", mine.getStatus());
        assertEquals("DELETED", ownBatch.getStatus());
        assertEquals("ACTIVE", theirs.getStatus());
        assertEquals("ACTIVE", sharedRow.getStatus());
        assertEquals("DELETED", ownRow.getStatus());
        verify(packageSessionRepository).saveAll(List.of(mine, ownBatch));
        verify(levelRepository).saveAll(List.of(ownRow));
        verify(learnerInvitationService).deleteLearnerInvitationBySourceAndSourceId("PACKAGE_SESSION", List.of("ps-mine", "ps-own"));
        verify(packageSessionRepository, never()).updateStatusByLevelIds(anyString(), anyList());
    }

    @Test
    @DisplayName("when every requested level is still used elsewhere no level row is loaded or saved")
    void noLevelRowTouchedWhenAllShared() {
        PackageSession mine = batch("ps-mine", SHARED);
        instituteBatches(List.of(SHARED), mine);
        when(packageSessionRepository.findLevelIdsUsedOutsideInstitute(List.of(SHARED), INSTITUTE)).thenReturn(List.of(SHARED));

        service.deleteLevels(List.of(SHARED), INSTITUTE, principal("ADMIN"));

        assertEquals("DELETED", mine.getStatus());
        verify(levelRepository, never()).findAllById(any());
        verify(levelRepository, never()).saveAll(any());
    }

    /** The institute holds a link to the course and no other institute holds an older one. */
    private static final String FIRST_LINK = "EXISTS (SELECT 1 FROM package_institute pi"
            + " WHERE pi.package_id = ps.package_id AND pi.institute_id = :instituteId"
            + " AND NOT EXISTS (SELECT 1 FROM package_institute older"
            + " WHERE older.package_id = pi.package_id AND older.institute_id IS DISTINCT FROM :instituteId"
            + " AND (older.created_at IS NULL OR pi.created_at IS NULL OR older.created_at < pi.created_at)))";

    @Test
    @DisplayName("ownership needs the FIRST link to the course, not any link; the in-use queries count every batch not owned that way")
    void queriesAreInstituteScoped() throws Exception {
        for (String name : List.of("findByLevelIdsAndInstituteId", "findBySessionIdsAndInstituteId")) {
            String sql = sql(name);
            assertTrue(sql.endsWith(") AND " + FIRST_LINK), sql);
        }
        for (String name : List.of("findLevelIdsUsedOutsideInstitute", "findSessionIdsUsedOutsideInstitute")) {
            String sql = sql(name);
            assertTrue(sql.endsWith("AND ps.status IS DISTINCT FROM 'DELETED' AND NOT " + FIRST_LINK), sql);
        }
    }

    private static String sql(String methodName) throws Exception {
        Method method = PackageSessionRepository.class.getMethod(methodName, List.class, String.class);
        Query query = method.getAnnotation(Query.class);
        assertTrue(query.nativeQuery());
        return query.value().replaceAll("\\s+", " ");
    }
}
