package vacademy.io.assessment_service.features.scheduler.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;

import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AutoResultReleaseJobTest {

    private NamedParameterJdbcTemplate jdbc;
    private StudentAttemptRepository attempts;
    private AssessmentParticipantsManager manager;
    private AutoResultReleaseJob job;

    /** assessment id -> institute id, served by the INSTITUTES_SQL stub. */
    private Map<String, String> institutes;

    @BeforeEach
    void setUp() throws Exception {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        attempts = mock(StudentAttemptRepository.class);
        manager = mock(AssessmentParticipantsManager.class);
        job = new AutoResultReleaseJob(jdbc, attempts, manager);
        institutes = Map.of("A1", "inst-1", "A2", "inst-2");
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(2);
            SqlParameterSource params = inv.getArgument(1);
            @SuppressWarnings("unchecked")
            List<String> ids = (List<String>) params.getValue("assessmentIds");
            for (String id : ids) {
                if (!institutes.containsKey(id)) continue;
                ResultSet rs = mock(ResultSet.class);
                when(rs.getString("assessment_id")).thenReturn(id);
                when(rs.getString("institute_id")).thenReturn(institutes.get(id));
                handler.processRow(rs);
            }
            return null;
        }).when(jdbc).query(eq(AutoResultReleaseJob.INSTITUTES_SQL), any(SqlParameterSource.class), any(RowCallbackHandler.class));
    }

    private static Assessment assessment(String id) {
        Assessment a = new Assessment();
        a.setId(id);
        return a;
    }

    private static StudentAttempt attempt(String id, Assessment assessment, String status, Date released) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(assessment);
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setRegistration(r);
        a.setReportReleaseStatus(status);
        a.setReportLastReleaseDate(released);
        return a;
    }

    private void stubFind(StudentAttempt... found) {
        when(attempts.findAllById(anyList())).thenReturn(List.of(found));
    }

    @Test
    void after_end_release_goes_through_the_report_and_email_path_per_assessment() {
        Assessment a1 = assessment("A1");
        Assessment a2 = assessment("A2");
        StudentAttempt x = attempt("x", a1, "RELEASED", new Date());
        StudentAttempt y = attempt("y", a1, "RELEASED", new Date());
        StudentAttempt z = attempt("z", a2, "RELEASED", new Date());
        stubFind(x, y, z);

        job.process(List.of("x", "y", "z"), true);

        verify(manager).releaseAutomatically(List.of(x, y), a1, "inst-1", true);
        verify(manager).releaseAutomatically(List.of(z), a2, "inst-2", true);
    }

    @Test
    void submit_time_release_is_emailed_without_firing_the_workflow_again() {
        Assessment a1 = assessment("A1");
        StudentAttempt x = attempt("x", a1, "RELEASED", new Date());
        stubFind(x);

        job.process(List.of("x"), false);

        verify(manager).releaseAutomatically(List.of(x), a1, "inst-1", false);
    }

    @Test
    void submit_time_notice_is_dropped_when_no_longer_released_or_stale() {
        Assessment a1 = assessment("A1");
        Date old = new Date(System.currentTimeMillis() - AutoResultReleaseJob.STALE_NOTICE_MS - 60_000);
        StudentAttempt withdrawn = attempt("w", a1, "PENDING", new Date());
        StudentAttempt stale = attempt("s", a1, "RELEASED", old);
        StudentAttempt noDate = attempt("n", a1, "RELEASED", null);
        stubFind(withdrawn, stale, noDate);

        job.process(List.of("w", "s", "n"), false);

        verifyNoInteractions(manager);
    }

    @Test
    void a_deleted_assessment_is_never_emailed() {
        Assessment deleted = assessment("A1");
        deleted.setStatus("DELETED");
        stubFind(attempt("x", deleted, "RELEASED", new Date()));

        job.process(List.of("x"), false);
        job.process(List.of("x"), true);

        verifyNoInteractions(manager);
    }

    @Test
    void assessment_without_institute_is_skipped_and_others_still_go() {
        Assessment orphan = assessment("A9");
        Assessment a1 = assessment("A1");
        StudentAttempt o = attempt("o", orphan, "RELEASED", new Date());
        StudentAttempt x = attempt("x", a1, "RELEASED", new Date());
        stubFind(o, x);

        job.process(List.of("o", "x"), true);

        verify(manager, times(1)).releaseAutomatically(anyList(), any(), anyString(), anyBoolean());
        verify(manager).releaseAutomatically(List.of(x), a1, "inst-1", true);
    }

    @Test
    void one_assessment_failing_does_not_stop_the_next() {
        Assessment a1 = assessment("A1");
        Assessment a2 = assessment("A2");
        StudentAttempt x = attempt("x", a1, "RELEASED", new Date());
        StudentAttempt z = attempt("z", a2, "RELEASED", new Date());
        stubFind(x, z);
        doThrow(new IllegalStateException("pdf")).when(manager)
                .releaseAutomatically(eq(List.of(x)), eq(a1), anyString(), anyBoolean());

        job.process(List.of("x", "z"), true);

        verify(manager).releaseAutomatically(List.of(z), a2, "inst-2", true);
    }

    @Test
    void a_run_claims_until_a_short_batch_then_moves_to_the_next_kind() {
        List<String> full = new ArrayList<>();
        for (int i = 0; i < AutoResultReleaseJob.BATCH; i++) full.add("f" + i);
        when(jdbc.queryForList(eq(AutoResultReleaseJob.CLAIM_AFTER_END_SQL), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn(full, List.of("last"));
        when(jdbc.queryForList(eq(AutoResultReleaseJob.CLAIM_SUBMIT_RELEASED_SQL), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn(Collections.emptyList());
        when(attempts.findAllById(anyList())).thenReturn(List.of());

        job.runOnce();

        verify(jdbc, times(2)).queryForList(eq(AutoResultReleaseJob.CLAIM_AFTER_END_SQL), any(SqlParameterSource.class), eq(String.class));
        verify(jdbc, times(1)).queryForList(eq(AutoResultReleaseJob.CLAIM_SUBMIT_RELEASED_SQL), any(SqlParameterSource.class), eq(String.class));
        ArgumentCaptor<List<String>> claimed = ArgumentCaptor.forClass(List.class);
        verify(attempts, times(2)).findAllById(claimed.capture());
        assertThat(claimed.getAllValues().get(1)).containsExactly("last");
    }

    @Test
    void the_claim_queries_only_take_rows_nobody_else_holds() {
        assertThat(AutoResultReleaseJob.CLAIM_AFTER_END_SQL).contains("SKIP LOCKED").contains("'AUTO_AFTER_ASSESSMENT_END'")
                .contains("report_release_status IS NULL OR sa.report_release_status = 'PENDING'")
                .contains("a.status <> 'DELETED'");
        assertThat(AutoResultReleaseJob.CLAIM_SUBMIT_RELEASED_SQL).contains("SKIP LOCKED")
                .contains("result_notice_pending = TRUE").contains("SET result_notice_pending = NULL");
    }

    @Test
    void switched_off_does_not_claim_anything() {
        ReflectionTestUtils.setField(job, "enabled", false);

        job.tick();

        verifyNoInteractions(jdbc, attempts, manager);
        verify(manager, never()).releaseAutomatically(anyList(), any(), anyString(), anyBoolean());
    }
}
