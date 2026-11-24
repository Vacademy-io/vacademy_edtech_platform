package vacademy.io.assessment_service.features.scheduler.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient.AnalysisState;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiWaitResultNoticeSelectorTest {

    private static final long MIN = 60_000L;

    private NamedParameterJdbcTemplate jdbc;
    private AdminCoreServiceClient adminCore;
    private ResultNotificationService notifications;
    private AiWaitResultNoticeSelector selector;

    /** Rows served by CANDIDATES_SQL: attempt id, user id, assessment id, wait since (ms). */
    private final List<Object[]> waiting = new ArrayList<>();
    /** Every id list handed to CLAIM_SQL, in call order. */
    private final List<List<String>> claims = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() throws Exception {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        adminCore = mock(AdminCoreServiceClient.class);
        notifications = mock(ResultNotificationService.class);
        selector = new AiWaitResultNoticeSelector(jdbc, adminCore, notifications);

        when(jdbc.query(eq(AiWaitResultNoticeSelector.CANDIDATES_SQL), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenAnswer(inv -> {
                    RowMapper<AiWaitResultNoticeSelector.Waiting> mapper = inv.getArgument(2);
                    List<AiWaitResultNoticeSelector.Waiting> out = new ArrayList<>();
                    for (Object[] row : waiting) {
                        ResultSet rs = mock(ResultSet.class);
                        when(rs.getString("attempt_id")).thenReturn((String) row[0]);
                        when(rs.getString("user_id")).thenReturn((String) row[1]);
                        when(rs.getString("assessment_id")).thenReturn((String) row[2]);
                        when(rs.getTimestamp("wait_since")).thenReturn(new Timestamp((Long) row[3]));
                        out.add(mapper.mapRow(rs, out.size()));
                    }
                    return out;
                });
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(2);
            SqlParameterSource params = inv.getArgument(1);
            for (String id : (List<String>) params.getValue("assessmentIds")) {
                if ("ORPHAN".equals(id)) continue;
                ResultSet rs = mock(ResultSet.class);
                when(rs.getString("assessment_id")).thenReturn(id);
                when(rs.getString("institute_id")).thenReturn("inst-1");
                handler.processRow(rs);
            }
            return null;
        }).when(jdbc).query(eq(AutoResultReleaseJob.INSTITUTES_SQL), any(SqlParameterSource.class), any(RowCallbackHandler.class));
        when(jdbc.queryForList(eq(AiWaitResultNoticeSelector.CLAIM_SQL), any(SqlParameterSource.class), eq(String.class)))
                .thenAnswer(inv -> {
                    SqlParameterSource params = inv.getArgument(1);
                    List<String> ids = new ArrayList<>((List<String>) params.getValue("ids"));
                    claims.add(ids);
                    return ids;
                });
    }

    private void waitingSince(String attemptId, String assessmentId, long minutesAgo) {
        waiting.add(new Object[]{attemptId, "user-" + attemptId, assessmentId,
                System.currentTimeMillis() - minutesAgo * MIN});
    }

    private void templates(String assessmentId, String emailLevel, String whatsappLevel) {
        Map<String, Object> email = emailLevel == null ? null : Map.of("level", emailLevel, "content", "x");
        Map<String, Object> wa = whatsappLevel == null ? null : Map.of("level", whatsappLevel, "name", "t");
        when(notifications.resolve("inst-1", assessmentId)).thenReturn(new ResultNotificationService.Templates(email, wa));
    }

    private void analysis(String attemptId, AnalysisState state) {
        when(adminCore.assessmentAnalysisState(eq("user-" + attemptId), anyString(), anyLong())).thenReturn(state);
    }

    @Test
    void sends_once_the_analysis_is_made_and_keeps_waiting_while_it_is_queued() {
        templates("A1", "ASSESSMENT", "ASSESSMENT");
        waitingSince("made", "A1", 20);
        waitingSince("queued", "A1", 20);
        analysis("made", AnalysisState.READY);
        analysis("queued", AnalysisState.PENDING);

        assertThat(selector.claimReady()).containsExactly("made");
        assertThat(claims).containsExactly(List.of("made"));
    }

    @Test
    void an_analysis_that_will_not_be_made_does_not_hold_the_report() {
        templates("A1", "ASSESSMENT", null);
        waitingSince("noCredits", "A1", 5);
        analysis("noCredits", AnalysisState.GAVE_UP);

        assertThat(selector.claimReady()).containsExactly("noCredits");
    }

    @Test
    void with_no_analysis_queued_it_waits_a_little_then_sends() {
        templates("A1", "ASSESSMENT", null);
        waitingSince("justNow", "A1", 2);
        waitingSince("timedOut", "A1", 15);
        analysis("justNow", AnalysisState.NONE);
        analysis("timedOut", AnalysisState.NONE);

        assertThat(selector.claimReady()).containsExactly("timedOut");
    }

    @Test
    void the_wait_runs_out_and_the_report_goes_without_the_ai_part() {
        templates("A1", "ASSESSMENT", null);
        waitingSince("slow", "A1", 181);
        analysis("slow", AnalysisState.PENDING);

        assertThat(selector.claimReady()).containsExactly("slow");
        verify(adminCore, never()).assessmentAnalysisState(anyString(), anyString(), anyLong());
    }

    @Test
    void a_test_without_a_template_of_its_own_is_dropped_never_sent() {
        templates("A1", "INSTITUTE", "INSTITUTE");
        templates("A2", "DEFAULT", null);
        waitingSince("x", "A1", 20);
        waitingSince("y", "A2", 20);
        waitingSince("z", "ORPHAN", 20);

        assertThat(selector.claimReady()).isEmpty();
        assertThat(claims).hasSize(1);
        assertThat(claims.get(0)).containsExactlyInAnyOrder("x", "y", "z");
        verify(adminCore, never()).assessmentAnalysisState(anyString(), anyString(), anyLong());
    }

    @Test
    void a_whatsapp_template_of_its_own_is_enough() {
        templates("A1", "DEFAULT", "ASSESSMENT");
        waitingSince("x", "A1", 20);
        analysis("x", AnalysisState.READY);

        assertThat(selector.claimReady()).containsExactly("x");
    }

    @Test
    void unreadable_templates_or_status_keep_the_notice_for_the_next_run() {
        when(notifications.resolve("inst-1", "A1")).thenReturn(new ResultNotificationService.Templates(null, null));
        templates("A2", "ASSESSMENT", null);
        waitingSince("x", "A1", 20);
        waitingSince("y", "A2", 20);
        analysis("y", null);

        assertThat(selector.claimReady()).isEmpty();
        assertThat(claims).isEmpty();
    }

    @Test
    void looks_for_the_analysis_from_a_little_before_the_submit() {
        templates("A1", "ASSESSMENT", null);
        waitingSince("x", "A1", 20);
        long since = (Long) waiting.get(0)[3];
        analysis("x", AnalysisState.PENDING);

        selector.claimReady();

        verify(adminCore).assessmentAnalysisState("user-x", "A1", since - AiWaitResultNoticeSelector.SINCE_SLACK_MS);
    }

    @Test
    void nothing_waiting_means_no_lookups() {
        assertThat(selector.claimReady()).isEmpty();
        verify(notifications, never()).resolve(anyString(), anyString());
    }
}
