package vacademy.io.assessment_service.features.proctoring;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorReviewDTO;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorSummaryDTO;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchRequest;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchResponse;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventDTO;
import vacademy.io.assessment_service.features.proctoring.entity.AttemptProctorEvent;
import vacademy.io.assessment_service.features.proctoring.repository.AttemptProctorEventRepository;
import vacademy.io.assessment_service.features.proctoring.service.ProctorEventService;
import vacademy.io.assessment_service.features.proctoring.service.ProctoringConfigService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The server side of the proctoring "work train", end to end through the real
 * service code: the learner's device reports a batch, the admin reads the
 * timeline back with the right counts, and every way a batch can be refused.
 *
 * Repositories are in-memory fakes over Mockito so this runs without a
 * database; the JPA mapping itself is exercised by the migration on deploy.
 */
class ProctorEventServiceFlowTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";
    private static final String LEARNER = "user-learner";
    private static final String INTRUDER = "user-other";
    private static final String ATTEMPT = "attempt-1";

    private final List<AttemptProctorEvent> store = new ArrayList<>();
    private AttemptProctorEventRepository events;
    private StudentAttemptRepository attempts;
    private AssessmentRepository assessments;
    private ProctorEventService service;
    private Assessment assessment;
    private StudentAttempt attempt;

    @BeforeEach
    void setUp() {
        events = mock(AttemptProctorEventRepository.class);
        attempts = mock(StudentAttemptRepository.class);
        assessments = mock(AssessmentRepository.class);

        // In-memory event table.
        when(events.saveAll(any())).thenAnswer(inv -> {
            Iterable<AttemptProctorEvent> rows = inv.getArgument(0);
            for (AttemptProctorEvent row : rows) {
                if (row.getId() == null) row.setId(UUID.randomUUID().toString());
                if (row.getReceivedAt() == null) row.setReceivedAt(new Date());
                store.add(row);
            }
            return rows;
        });
        when(events.countByAttemptId(anyString()))
                .thenAnswer(inv -> store.stream().filter(e -> e.getAttemptId().equals(inv.getArgument(0))).count());
        when(events.countByAttemptIdAndSeverity(anyString(), anyString()))
                .thenAnswer(inv -> store.stream()
                        .filter(e -> e.getAttemptId().equals(inv.getArgument(0)) && e.getSeverity().equals(inv.getArgument(1)))
                        .count());
        when(events.findByAttemptIdOrderByOccurredAtAsc(anyString()))
                .thenAnswer(inv -> store.stream()
                        .filter(e -> e.getAttemptId().equals(inv.getArgument(0)))
                        .sorted(Comparator.comparing(AttemptProctorEvent::getOccurredAt))
                        .toList());
        when(events.countBySeverityForAttempts(any())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            List<Object[]> out = new ArrayList<>();
            for (String id : ids) {
                for (String sev : List.of("FLAG", "WARN")) {
                    long n = store.stream().filter(e -> e.getAttemptId().equals(id) && e.getSeverity().equals(sev)).count();
                    if (n > 0) out.add(new Object[]{id, sev, n});
                }
            }
            return out;
        });

        // One proctored assessment, one open attempt owned by LEARNER.
        assessment = new Assessment();
        assessment.setId("assessment-1");
        assessment.setProctoringConfig("{\"tier\":\"BASIC\",\"max_violations\":3}");
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setId("reg-1");
        registration.setUserId(LEARNER);
        registration.setAssessment(assessment);
        attempt = new StudentAttempt();
        attempt.setId(ATTEMPT);
        attempt.setStatus(AssessmentAttemptEnum.LIVE.name());
        attempt.setRegistration(registration);

        when(attempts.findByIdWithRegistration(ATTEMPT)).thenReturn(Optional.of(attempt));
        when(assessments.findById("assessment-1")).thenReturn(Optional.of(assessment));
        when(assessments.findByAssessmentIdAndInstituteId("assessment-1", INSTITUTE)).thenReturn(Optional.of(assessment));
        when(assessments.findByAssessmentIdAndInstituteId("assessment-1", OTHER_INSTITUTE)).thenReturn(Optional.empty());

        service = new ProctorEventService(events, attempts, assessments, new ProctoringConfigService());
    }

    private static CustomUserDetails user(String id) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        return u;
    }

    private static ProctorEventDTO event(String type, String severity, String evidence, long tOffsetMs) {
        return ProctorEventDTO.builder()
                .eventType(type)
                .severity(severity)
                .occurredAt(new Date(System.currentTimeMillis() - 60_000 + tOffsetMs))
                .evidenceFileId(evidence)
                .meta(evidence == null ? null : Map.of("faces", 0, "detector", "native"))
                .build();
    }

    private static ProctorEventBatchRequest batch(ProctorEventDTO... e) {
        return new ProctorEventBatchRequest(new ArrayList<>(List.of(e)));
    }

    // ------------------------------------------------------------- the train

    @Test
    void learnerReportsAcrossTwoFlushes_adminSeesOrderedTimelineAndCounts() {
        // Learner: what a real exam produces — check-in, routine snapshots, then a flag.
        ProctorEventBatchResponse first = service.record(user(LEARNER), ATTEMPT, batch(
                event("CHECK_IN", "INFO", "file-selfie", 0),
                event("SNAPSHOT", "INFO", "file-snap-1", 30_000),
                event("TAB_SWITCH", "WARN", null, 35_000)
        ));
        assertEquals(3, first.getAccepted());
        assertEquals(0, first.getFlagCount());

        ProctorEventBatchResponse second = service.record(user(LEARNER), ATTEMPT, batch(
                event("NO_FACE", "FLAG", "file-snap-flag", 41_000),
                event("SNAPSHOT", "INFO", "file-snap-2", 60_000)
        ));
        assertEquals(2, second.getAccepted());
        // The client enforces the ceiling with THIS number, not its own count.
        assertEquals(1, second.getFlagCount());

        // Admin, same institute: the timeline the reviewer opens.
        AttemptProctorReviewDTO review = service.review(ATTEMPT, INSTITUTE);
        assertEquals(ATTEMPT, review.getAttemptId());
        assertEquals("BASIC", review.getConfig().getTier());
        assertEquals(3, review.getConfig().getMaxViolations());
        assertEquals(30, review.getConfig().getSnapshotIntervalSec(), "defaults filled for knobs the admin never set");
        assertEquals(1, review.getFlagCount());
        assertEquals(1, review.getWarnCount());
        assertEquals(2, review.getSnapshotCount());
        assertEquals(Map.of("CHECK_IN", 1L, "SNAPSHOT", 2L, "TAB_SWITCH", 1L, "NO_FACE", 1L), review.getCountsByType());

        List<String> order = review.getEvents().stream().map(ProctorEventDTO::getEventType).toList();
        assertEquals(List.of("CHECK_IN", "SNAPSHOT", "TAB_SWITCH", "NO_FACE", "SNAPSHOT"), order, "time order, across batches");

        ProctorEventDTO flag = review.getEvents().get(3);
        assertEquals("file-snap-flag", flag.getEvidenceFileId(), "reviewer can open the frame behind the flag");
        assertNotNull(flag.getMeta());
        assertEquals(0, flag.getMeta().get("faces"));
        assertNotNull(flag.getId());
        assertNotNull(flag.getReceivedAt());

        // Submissions table column.
        List<AttemptProctorSummaryDTO> summaries = service.summaries("assessment-1", INSTITUTE, List.of(ATTEMPT, "attempt-quiet"));
        assertEquals(1, summaries.size(), "attempts with no events are omitted");
        assertEquals(1, summaries.get(0).getFlagCount());
        assertEquals(1, summaries.get(0).getWarnCount());
    }

    // ---------------------------------------------------------- the guards

    @Test
    void anotherLearnerCannotWriteToTheAttempt() {
        assertThrows(ForbiddenException.class,
                () -> service.record(user(INTRUDER), ATTEMPT, batch(event("NO_FACE", "FLAG", null, 0))));
        verify(events, never()).saveAll(any());
    }

    @Test
    void adminFromAnotherInstituteCannotReadIt() {
        service.record(user(LEARNER), ATTEMPT, batch(event("NO_FACE", "FLAG", null, 0)));
        assertThrows(ForbiddenException.class, () -> service.review(ATTEMPT, OTHER_INSTITUTE));
        assertThrows(ForbiddenException.class, () -> service.summaries("assessment-1", OTHER_INSTITUTE, List.of(ATTEMPT)));
    }

    @Test
    void lateFlushAfterSubmitIsAcceptedQuietly_butStoresNothing() {
        service.record(user(LEARNER), ATTEMPT, batch(event("NO_FACE", "FLAG", null, 0)));
        attempt.setStatus(AssessmentAttemptEnum.ENDED.name());
        ProctorEventBatchResponse late = service.record(user(LEARNER), ATTEMPT, batch(event("SNAPSHOT", "INFO", "f", 1)));
        assertEquals(0, late.getAccepted());
        assertEquals(1, late.getFlagCount(), "still answers with the real count");
        assertEquals(1, store.size());
    }

    @Test
    void unproctoredAssessmentNeverGrowsALog() {
        assessment.setProctoringConfig(null); // every pre-V48 assessment
        ProctorEventBatchResponse r = service.record(user(LEARNER), ATTEMPT, batch(event("NO_FACE", "FLAG", null, 0)));
        assertEquals(0, r.getAccepted());
        assertTrue(store.isEmpty());
        assertEquals("NONE", service.configForLearner("assessment-1").getTier());
    }

    @Test
    void hostileInputIsBounded_notFatal() {
        List<ProctorEventDTO> many = new ArrayList<>();
        for (int i = 0; i < 80; i++) many.add(event("SNAPSHOT", "INFO", "f" + i, i));
        many.add(0, event("X".repeat(60), "FLAG", null, 0));                     // over the column width
        many.add(1, event("NO_FACE", "flag", "F".repeat(300), 0));               // lowercase severity, oversize evidence
        many.add(2, ProctorEventDTO.builder().eventType("NO_FACE").severity("nonsense")
                .occurredAt(new Date(System.currentTimeMillis() + 86_400_000L)).build()); // future clock, bad severity

        ProctorEventBatchResponse r = service.record(user(LEARNER), ATTEMPT, new ProctorEventBatchRequest(many));
        assertEquals(49, r.getAccepted(), "50-cap minus the one unstorable row");

        ArgumentCaptor<Iterable<AttemptProctorEvent>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(events).saveAll(captor.capture());
        List<AttemptProctorEvent> saved = new ArrayList<>();
        captor.getValue().forEach(saved::add);
        AttemptProctorEvent oversizeEvidence = saved.get(0);
        assertEquals("NO_FACE", oversizeEvidence.getEventType());
        assertEquals("FLAG", oversizeEvidence.getSeverity(), "severity normalised");
        assertNull(oversizeEvidence.getEvidenceFileId(), "oversize evidence dropped, row kept");
        AttemptProctorEvent future = saved.get(1);
        assertEquals("INFO", future.getSeverity(), "unknown severity is INFO, never FLAG");
        assertTrue(future.getOccurredAt().getTime() <= System.currentTimeMillis() + 1000, "future timestamps clamped to now");
    }
}
