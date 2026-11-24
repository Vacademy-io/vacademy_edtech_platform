package vacademy.io.assessment_service.features.scheduler.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient.AnalysisState;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Result emails of practice / mock attempts that wait for the attempt's AI analysis.
 *
 * <p>The submit path queues the FIRST attempt of a practice or mock test with
 * {@code result_notice_ai_wait_since}. Such a test is emailed only when it has a result
 * email or WhatsApp template of its own (bound to the assessment, not the institute): a
 * practice test is retaken freely, and an institute-wide template must not start mailing
 * every practice test. The rest are dropped on the first look.
 *
 * <p>The AI analysis is made by admin_core's hourly scheduler, so the report would carry no
 * AI part if it were rendered at submit. A notice is sent when the analysis is made, when it
 * will not be made on its own (no credits, usage limit, failed for good), when no analysis
 * was queued at all (a timed-out attempt is not analysed), or when the wait runs out.
 * Nothing here asks for an analysis or spends credits.
 */
@Slf4j
@Component
public class AiWaitResultNoticeSelector {

    static final int LIMIT = 200;

    static final String CANDIDATES_SQL = """
            SELECT sa.id AS attempt_id, aur.user_id AS user_id, aur.assessment_id AS assessment_id,
                   sa.result_notice_ai_wait_since AS wait_since
            FROM student_attempt sa
            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
            WHERE sa.result_notice_pending = TRUE
              AND sa.result_notice_ai_wait_since IS NOT NULL
            ORDER BY sa.result_notice_ai_wait_since
            LIMIT :limit
            """;

    /** Takes the given notices off the queue; only the replica whose UPDATE wins gets an id back. */
    static final String CLAIM_SQL = """
            UPDATE student_attempt
            SET result_notice_pending = NULL, result_notice_ai_wait_since = NULL
            WHERE id IN (:ids)
              AND result_notice_pending = TRUE
              AND result_notice_ai_wait_since IS NOT NULL
            RETURNING id
            """;

    /** The analysis row is written a moment after the submit; look a little before it. */
    static final long SINCE_SLACK_MS = 5L * 60 * 1000;

    private final NamedParameterJdbcTemplate jdbc;
    private final AdminCoreServiceClient adminCore;
    private final ResultNotificationService resultNotifications;

    /** Longest wait for the analysis; after it the report goes out without the AI part. */
    @Value("${assessment.auto-result-release.ai-wait-max-minutes:180}")
    long maxWaitMinutes = 180;

    /** With no analysis queued after this long, none is coming (e.g. a timed-out attempt). */
    @Value("${assessment.auto-result-release.ai-wait-none-minutes:10}")
    long noAnalysisGraceMinutes = 10;

    @Autowired
    public AiWaitResultNoticeSelector(JdbcTemplate jdbcTemplate, AdminCoreServiceClient adminCore,
                                      ResultNotificationService resultNotifications) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), adminCore, resultNotifications);
    }

    AiWaitResultNoticeSelector(NamedParameterJdbcTemplate jdbc, AdminCoreServiceClient adminCore,
                               ResultNotificationService resultNotifications) {
        this.jdbc = jdbc;
        this.adminCore = adminCore;
        this.resultNotifications = resultNotifications;
    }

    record Waiting(String attemptId, String userId, String assessmentId, long waitSince) {
    }

    /**
     * Drops the notices of tests without a template of their own, and claims the ones that
     * may be sent now.
     *
     * @return the claimed attempt ids, to be released through the normal submit-time path
     */
    public List<String> claimReady() {
        List<Waiting> waiting = jdbc.query(CANDIDATES_SQL, new MapSqlParameterSource("limit", LIMIT), (rs, i) -> {
            Timestamp since = rs.getTimestamp("wait_since");
            return new Waiting(rs.getString("attempt_id"), rs.getString("user_id"), rs.getString("assessment_id"),
                    since == null ? 0L : since.getTime());
        });
        if (waiting.isEmpty()) {
            return List.of();
        }

        Map<String, Boolean> ownTemplate = ownTemplateByAssessment(waiting);
        long now = System.currentTimeMillis();
        List<String> drop = new ArrayList<>();
        List<String> send = new ArrayList<>();
        for (Waiting w : waiting) {
            Boolean own = ownTemplate.get(w.assessmentId());
            if (own == null) {
                continue; // templates could not be read this run; look again next run
            }
            if (!own) {
                drop.add(w.attemptId());
            } else if (readyToSend(w, now)) {
                send.add(w.attemptId());
            }
        }
        if (!drop.isEmpty()) {
            int dropped = claim(drop).size();
            log.info("[AUTO-RELEASE] {} practice/mock result notices dropped: no result template of their own", dropped);
        }
        return send.isEmpty() ? List.of() : claim(send);
    }

    boolean readyToSend(Waiting w, long now) {
        if (now - w.waitSince() >= maxWaitMinutes * 60_000L) {
            log.info("[AUTO-RELEASE] attempt {}: AI analysis not ready after {} min; sending the report without it",
                    w.attemptId(), maxWaitMinutes);
            return true;
        }
        if (w.userId() == null) {
            return true; // no learner to look the analysis up for
        }
        AnalysisState state = adminCore.assessmentAnalysisState(w.userId(), w.assessmentId(),
                w.waitSince() - SINCE_SLACK_MS);
        if (state == null) {
            return false; // admin_core could not be asked; next run
        }
        return switch (state) {
            case READY, GAVE_UP -> true;
            case NONE -> now - w.waitSince() >= noAnalysisGraceMinutes * 60_000L;
            case PENDING -> false;
        };
    }

    /**
     * Per assessment: TRUE when its result email or WhatsApp template is bound to the
     * assessment itself, FALSE when only an institute or default template applies, absent
     * when the templates could not be read.
     */
    private Map<String, Boolean> ownTemplateByAssessment(List<Waiting> waiting) {
        List<String> assessmentIds = waiting.stream().map(Waiting::assessmentId).distinct().toList();
        Map<String, String> institutes = new HashMap<>();
        jdbc.query(AutoResultReleaseJob.INSTITUTES_SQL, new MapSqlParameterSource("assessmentIds", assessmentIds),
                rs -> {
                    institutes.putIfAbsent(rs.getString("assessment_id"), rs.getString("institute_id"));
                });
        Map<String, Boolean> out = new HashMap<>();
        for (String assessmentId : assessmentIds) {
            String instituteId = institutes.get(assessmentId);
            if (instituteId == null) {
                out.put(assessmentId, Boolean.FALSE);
                continue;
            }
            try {
                ResultNotificationService.Templates t = resultNotifications.resolve(instituteId, assessmentId);
                if (t == null || t.email() == null) {
                    continue; // lookup failed (an unbound email still resolves to DEFAULT)
                }
                out.put(assessmentId, isOwn(t.email()) || isOwn(t.whatsapp()));
            } catch (Exception e) {
                log.warn("[AUTO-RELEASE] result templates of assessment {} not read: {}", assessmentId, e.getMessage());
            }
        }
        return out;
    }

    private static boolean isOwn(Map<String, Object> template) {
        return template != null && "ASSESSMENT".equals(String.valueOf(template.get("level")));
    }

    private List<String> claim(List<String> ids) {
        return jdbc.queryForList(CLAIM_SQL, new MapSqlParameterSource("ids", ids), String.class);
    }
}
