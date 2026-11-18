package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanLoadRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationRunner;

import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The scan station's repository queries (the conditional claims, the sweep's
 * lookups, the crash recovery's item lookup) run against a real Postgres: a JPQL
 * or derived-query mistake fails the service at boot or does the wrong update,
 * which no mock would show.
 *
 * <p>Needs a database carrying V46 (ai_copy_intake_*) and V72 (ai_scan_*); no
 * other table is touched. Skipped unless ASSESSMENT_TEST_DB_URL is set, so CI
 * without a database stays green. Each test runs in a transaction that is rolled
 * back, so CURRENT_TIMESTAMP inside a test is the test's start.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = ScanStationRepositoryQueryTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class ScanStationRepositoryQueryTest {

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.assessment.copy_intake.repository",
            "vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository"})
    static class OrmOnlyConfig {
    }

    @Autowired
    private AiScanSessionRepository sessions;

    @Autowired
    private AiScanLoadRepository loads;

    @Autowired
    private AiCopyIntakeItemRepository items;

    @Autowired
    private EntityManager entityManager;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("ASSESSMENT_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""));
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    private static String id() {
        return UUID.randomUUID().toString();
    }

    private void sql(String statement, Object... params) {
        var q = entityManager.createNativeQuery(statement);
        for (int i = 0; i < params.length; i++) {
            q.setParameter(i + 1, params[i]);
        }
        q.executeUpdate();
    }

    private AiScanSession session(String institute, String status) {
        AiScanSession s = sessions.saveAndFlush(AiScanSession.builder().assessmentId("a-" + id())
                .instituteId(institute).status(status).build());
        assertThat(s.getId()).hasSize(36);
        assertThat(s.getVersion()).isZero();
        return s;
    }

    private AiScanLoad load(AiScanSession s, int loadNo, String status) {
        return loads.saveAndFlush(AiScanLoad.builder().sessionId(s.getId()).loadNo(loadNo).status(status)
                .passesJson("{\"passes\":[]}").build());
    }

    /** Claimed this long ago (the entity's @UpdateTimestamp always writes now). */
    private void claimedAgo(String loadId, int minutes) {
        sql("UPDATE ai_scan_load SET claimed_at = now() - make_interval(mins => ?1),"
                + " updated_at = now() - make_interval(mins => ?1) WHERE id = ?2", minutes, loadId);
        entityManager.clear();
    }

    private void ageSession(String rowId, int minutes) {
        sql("UPDATE ai_scan_session SET updated_at = now() - make_interval(mins => ?1) WHERE id = ?2", minutes, rowId);
        entityManager.clear();
    }

    private static Date minutesAgo(int minutes) {
        return new Date(System.currentTimeMillis() - minutes * 60_000L);
    }

    // ------------------------------------------------------------------- loads

    @Test
    void aLoadIsClaimedOnceAndTheClaimCountsAnAttempt() {
        AiScanSession s = session("inst-1", AiScanSession.OPEN);
        AiScanLoad l = load(s, 1, AiScanLoad.PENDING);
        Date now = new Date();

        assertThat(loads.claim(l.getId(), AiScanLoad.PENDING, AiScanLoad.ANALYSING, now)).isEqualTo(1);
        assertThat(loads.claim(l.getId(), AiScanLoad.PENDING, AiScanLoad.ANALYSING, now)).isZero();   // second pod

        AiScanLoad after = loads.findById(l.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(AiScanLoad.ANALYSING);
        assertThat(after.getAttempts()).isEqualTo(1);
        assertThat(after.getVersion()).isEqualTo(1L);
        assertThat(after.getClaimedAt()).isNotNull();

        assertThat(loads.transition(l.getId(), AiScanLoad.ANALYSING, AiScanLoad.PENDING)).isEqualTo(1);
        assertThat(loads.transition(l.getId(), AiScanLoad.ANALYSING, AiScanLoad.PENDING)).isZero();
        AiScanLoad back = loads.findById(l.getId()).orElseThrow();
        assertThat(back.getStatus()).isEqualTo(AiScanLoad.PENDING);
        assertThat(back.getAttempts()).isEqualTo(1);                     // a transition counts nothing
        assertThat(back.getVersion()).isEqualTo(2L);
    }

    @Test
    void aSaveOverAClaimedRowFailsOnTheVersion() {
        AiScanSession s = session("inst-1", AiScanSession.OPEN);
        AiScanLoad l = load(s, 1, AiScanLoad.PENDING);
        entityManager.clear();
        AiScanLoad stale = loads.findById(l.getId()).orElseThrow();
        entityManager.detach(stale);
        assertThat(loads.claim(l.getId(), AiScanLoad.PENDING, AiScanLoad.ANALYSING, new Date())).isEqualTo(1);

        stale.setStatus(AiScanLoad.REMOVED);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> loads.saveAndFlush(stale))
                .isInstanceOf(org.springframework.dao.OptimisticLockingFailureException.class);
    }

    @Test
    void theSweepFindsPendingAndStuckLoadsOfTheListedInstitutesOnly() {
        AiScanSession on = session("inst-on", AiScanSession.OPEN);
        AiScanSession off = session("inst-off", AiScanSession.OPEN);
        AiScanLoad onPending = load(on, 1, AiScanLoad.PENDING);
        AiScanLoad offPending = load(off, 1, AiScanLoad.PENDING);
        AiScanLoad onStuck = load(on, 2, AiScanLoad.ANALYSING);
        AiScanLoad offStuck = load(off, 2, AiScanLoad.ANALYSING);
        AiScanLoad onFresh = load(on, 3, AiScanLoad.ANALYSING);
        claimedAgo(onStuck.getId(), 30);
        claimedAgo(offStuck.getId(), 30);
        sql("UPDATE ai_scan_load SET claimed_at = now() WHERE id = ?1", onFresh.getId());
        entityManager.clear();

        assertThat(loads.findByStatus(AiScanLoad.PENDING)).extracting(AiScanLoad::getId)
                .contains(onPending.getId(), offPending.getId());
        assertThat(loads.findByStatusForInstitutes(AiScanLoad.PENDING, Set.of("inst-on")))
                .extracting(AiScanLoad::getId).containsExactly(onPending.getId());
        assertThat(loads.findByStatusForInstitutes(AiScanLoad.PENDING, Set.of("inst-on", "inst-off")))
                .extracting(AiScanLoad::getId).containsExactlyInAnyOrder(onPending.getId(), offPending.getId());

        Date stale = minutesAgo(10);
        assertThat(loads.findByStatusAndClaimedAtBefore(AiScanLoad.ANALYSING, stale)).extracting(AiScanLoad::getId)
                .contains(onStuck.getId(), offStuck.getId()).doesNotContain(onFresh.getId());
        assertThat(loads.findByStatusAndClaimedAtBeforeForInstitutes(AiScanLoad.ANALYSING, stale, Set.of("inst-on")))
                .extracting(AiScanLoad::getId).containsExactly(onStuck.getId());
    }

    @Test
    void loadsAreReadInLoadOrderAndByNumber() {
        AiScanSession s = session("inst-1", AiScanSession.OPEN);
        load(s, 2, AiScanLoad.DONE);
        AiScanLoad first = load(s, 1, AiScanLoad.PENDING);

        assertThat(loads.findBySessionIdOrderByLoadNo(s.getId())).extracting(AiScanLoad::getLoadNo)
                .containsExactly(1, 2);
        assertThat(loads.findBySessionIdAndLoadNo(s.getId(), 1)).get().extracting(AiScanLoad::getId)
                .isEqualTo(first.getId());
        assertThat(loads.findBySessionIdAndLoadNo(s.getId(), 9)).isEmpty();
    }

    // ---------------------------------------------------------------- sessions

    @Test
    void aStaleBuildIsClaimedByOneSweepOnly() {
        AiScanSession s = session("inst-1", AiScanSession.BUILDING);
        sql("UPDATE ai_scan_session SET error_message = ?1 WHERE id = ?2", ScanStationRunner.BUSY_MESSAGE, s.getId());
        ageSession(s.getId(), 30);
        Date before = minutesAgo(10);

        assertThat(sessions.claimBuild(s.getId(), AiScanSession.BUILDING, before)).isEqualTo(1);
        assertThat(sessions.claimBuild(s.getId(), AiScanSession.BUILDING, before)).isZero();   // now stamped
        AiScanSession after = sessions.findById(s.getId()).orElseThrow();
        assertThat(after.getErrorMessage()).isNull();
        assertThat(after.getVersion()).isEqualTo(1L);
        assertThat(after.getUpdatedAt()).isAfter(before);

        // a session in another status is never claimed as a build
        AiScanSession built = session("inst-1", AiScanSession.BUILT);
        ageSession(built.getId(), 30);
        assertThat(sessions.claimBuild(built.getId(), AiScanSession.BUILDING, before)).isZero();
    }

    @Test
    void aSessionTransitionsOnlyFromTheStatusItIsIn() {
        AiScanSession s = session("inst-1", AiScanSession.BUILT);
        assertThat(sessions.transition(s.getId(), AiScanSession.BUILT, AiScanSession.STARTING)).isEqualTo(1);
        assertThat(sessions.transition(s.getId(), AiScanSession.BUILT, AiScanSession.STARTING)).isZero();  // 2nd click
        AiScanSession after = sessions.findById(s.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(AiScanSession.STARTING);
        assertThat(after.getVersion()).isEqualTo(1L);
    }

    @Test
    void theSweepFindsStaleAndParkedSessionsOfTheListedInstitutesOnly() {
        AiScanSession onStale = session("inst-on", AiScanSession.BUILDING);
        AiScanSession offStale = session("inst-off", AiScanSession.BUILDING);
        AiScanSession onLive = session("inst-on", AiScanSession.BUILDING);
        AiScanSession onParked = session("inst-on", AiScanSession.BUILDING);
        AiScanSession offParked = session("inst-off", AiScanSession.BUILDING);
        sql("UPDATE ai_scan_session SET error_message = ?1 WHERE id IN (?2, ?3)", ScanStationRunner.BUSY_MESSAGE,
                onParked.getId(), offParked.getId());
        ageSession(onStale.getId(), 30);
        ageSession(offStale.getId(), 30);
        ageSession(onParked.getId(), 3);
        ageSession(offParked.getId(), 3);

        Date stale = minutesAgo(10);
        assertThat(sessions.findByStatusAndUpdatedAtBefore(AiScanSession.BUILDING, stale))
                .extracting(AiScanSession::getId).contains(onStale.getId(), offStale.getId())
                .doesNotContain(onLive.getId(), onParked.getId());
        assertThat(sessions.findByStatusAndInstituteIdInAndUpdatedAtBefore(AiScanSession.BUILDING,
                Set.of("inst-on"), stale)).extracting(AiScanSession::getId).containsExactly(onStale.getId());

        Date parked = minutesAgo(1);
        assertThat(sessions.findByStatusAndErrorMessageAndUpdatedAtBefore(AiScanSession.BUILDING,
                ScanStationRunner.BUSY_MESSAGE, parked)).extracting(AiScanSession::getId)
                .contains(onParked.getId(), offParked.getId()).doesNotContain(onStale.getId());
        assertThat(sessions.findByStatusAndErrorMessageAndInstituteIdInAndUpdatedAtBefore(AiScanSession.BUILDING,
                ScanStationRunner.BUSY_MESSAGE, Set.of("inst-on"), parked)).extracting(AiScanSession::getId)
                .containsExactly(onParked.getId());
    }

    @Test
    void theStationListsAnAssessmentsRecentSessions() {
        AiScanSession s = session("inst-1", AiScanSession.OPEN);
        session("inst-2", AiScanSession.OPEN);
        List<AiScanSession> mine = sessions.findTop10ByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(
                s.getAssessmentId(), "inst-1");
        assertThat(mine).extracting(AiScanSession::getId).containsExactly(s.getId());
    }

    // ---------------------------------------------------------------- recovery

    @Test
    void crashRecoveryFindsTheIntakeItemOfABuiltFile() {
        String batchId = id();
        sql("INSERT INTO ai_copy_intake_batch (id, assessment_id, institute_id, status, total_items, created_at)"
                + " VALUES (?1, ?2, 'inst-1', 'RUNNING', 1, now())", batchId, id());
        sql("INSERT INTO ai_copy_intake_item (id, batch_id, file_id, file_name, status, created_at, updated_at)"
                + " VALUES (?1, ?2, 'pdf-2', 'Asha.pdf', 'PENDING', now(), now())", id(), batchId);
        entityManager.clear();

        Optional<AiCopyIntakeItem> hit = items.findFirstByFileIdIn(List.of("pdf-1", "pdf-2", "pdf-3"));
        assertThat(hit).get().extracting(AiCopyIntakeItem::getBatchId).isEqualTo(batchId);
        assertThat(items.findFirstByFileIdIn(List.of("pdf-9"))).isEmpty();
    }
}
