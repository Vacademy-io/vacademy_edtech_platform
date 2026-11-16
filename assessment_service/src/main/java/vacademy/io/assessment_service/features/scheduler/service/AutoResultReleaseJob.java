package vacademy.io.assessment_service.features.scheduler.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Automatic result release, with the same report PDF and email as the admin's Release Result.
 *
 * <p>Two kinds of attempt, both claimed with one {@code UPDATE ... RETURNING} so two replicas
 * never take the same row (and never send the same email twice):
 * <ol>
 *   <li><b>After the assessment ends</b> ({@code AUTO_AFTER_ASSESSMENT_END}): submitted attempts
 *       of an assessment whose end time has passed and that are not released yet. The claim
 *       itself releases them. Before this job, the hourly attempt sweep released them with no
 *       email, up to an hour after the end.</li>
 *   <li><b>Released on submit</b> ({@code AUTO_AFTER_SUBMISSION}, or an after-end test submitted
 *       after the end): the submit path releases at once and only marks
 *       {@code result_notice_pending}; the PDF is made here so the submit request stays fast.</li>
 * </ol>
 *
 * <p>The scheduler thread only starts a run: rendering PDFs takes seconds per learner, and
 * assessment_service has a single scheduler thread shared by every {@code @Scheduled} job.
 * The run happens on this class's own worker thread, one run at a time per replica.
 *
 * <p>A claimed attempt is released even if its PDF or email then fails (logged, not retried):
 * a missing email is better than the same email every two minutes.
 */
@Slf4j
@Component
public class AutoResultReleaseJob {

    /** Attempts claimed per query; a run keeps claiming until nothing is left or the cap. */
    static final int BATCH = 25;
    static final int MAX_PER_RUN = 1000;

    /** A submit-time release older than this is not emailed late (e.g. the job was switched off). */
    static final long STALE_NOTICE_MS = 24L * 60 * 60 * 1000;

    static final String CLAIM_AFTER_END_SQL = """
            WITH picked AS (
                SELECT sa.id
                FROM student_attempt sa
                JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                JOIN assessment a ON a.id = aur.assessment_id
                WHERE a.result_type = 'AUTO_AFTER_ASSESSMENT_END'
                  AND a.status <> 'DELETED'
                  AND COALESCE(a.omr_mode, false) = false
                  AND a.bound_end_time < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                  AND sa.status = 'ENDED'
                  AND sa.result_status = 'COMPLETED'
                  AND (sa.report_release_status IS NULL OR sa.report_release_status = 'PENDING')
                ORDER BY sa.id
                LIMIT :limit
                FOR UPDATE OF sa SKIP LOCKED
            )
            UPDATE student_attempt s
            SET report_release_status = 'RELEASED',
                report_last_release_date = CURRENT_TIMESTAMP,
                result_notice_pending = NULL
            FROM picked
            WHERE s.id = picked.id
            RETURNING s.id
            """;

    static final String CLAIM_SUBMIT_RELEASED_SQL = """
            WITH picked AS (
                SELECT sa.id
                FROM student_attempt sa
                WHERE sa.result_notice_pending = TRUE
                ORDER BY sa.id
                LIMIT :limit
                FOR UPDATE OF sa SKIP LOCKED
            )
            UPDATE student_attempt s
            SET result_notice_pending = NULL
            FROM picked
            WHERE s.id = picked.id
            RETURNING s.id
            """;

    static final String INSTITUTES_SQL = """
            SELECT assessment_id, institute_id
            FROM assessment_institute_mapping
            WHERE assessment_id IN (:assessmentIds)
            ORDER BY created_at
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final StudentAttemptRepository studentAttemptRepository;
    private final AssessmentParticipantsManager participantsManager;

    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "auto-result-release");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean running = new AtomicBoolean(false);

    @Value("${assessment.auto-result-release.enabled:true}")
    private boolean enabled = true;

    @Autowired
    public AutoResultReleaseJob(JdbcTemplate jdbcTemplate,
                                StudentAttemptRepository studentAttemptRepository,
                                AssessmentParticipantsManager participantsManager) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), studentAttemptRepository, participantsManager);
    }

    AutoResultReleaseJob(NamedParameterJdbcTemplate jdbc,
                         StudentAttemptRepository studentAttemptRepository,
                         AssessmentParticipantsManager participantsManager) {
        this.jdbc = jdbc;
        this.studentAttemptRepository = studentAttemptRepository;
        this.participantsManager = participantsManager;
    }

    @Scheduled(fixedDelayString = "${assessment.auto-result-release.delay-ms:120000}",
            initialDelayString = "${assessment.auto-result-release.initial-delay-ms:60000}")
    public void tick() {
        if (!enabled || !running.compareAndSet(false, true)) {
            return;
        }
        try {
            worker.execute(() -> {
                try {
                    runOnce();
                } catch (Exception e) {
                    log.error("[AUTO-RELEASE] run failed", e);
                } finally {
                    running.set(false);
                }
            });
        } catch (Exception e) {
            running.set(false);
            log.error("[AUTO-RELEASE] could not start a run: {}", e.getMessage());
        }
    }

    /** One run: drain both kinds, each up to {@link #MAX_PER_RUN}. */
    void runOnce() {
        int afterEnd = drain(CLAIM_AFTER_END_SQL, true);
        int onSubmit = drain(CLAIM_SUBMIT_RELEASED_SQL, false);
        if (afterEnd + onSubmit > 0) {
            log.info("[AUTO-RELEASE] released after end: {}, emailed submit-time releases: {}", afterEnd, onSubmit);
        }
    }

    private int drain(String claimSql, boolean afterEnd) {
        int done = 0;
        while (done < MAX_PER_RUN) {
            List<String> ids = claim(claimSql);
            if (ids.isEmpty()) {
                break;
            }
            done += ids.size();
            process(ids, afterEnd);
            if (ids.size() < BATCH) {
                break;
            }
        }
        return done;
    }

    List<String> claim(String sql) {
        return jdbc.queryForList(sql, new MapSqlParameterSource("limit", BATCH), String.class);
    }

    /**
     * Report + email per assessment for claimed attempts.
     *
     * @param afterEnd true: released by this claim, so ASSESSMENT_RESULT_RELEASED fires here.
     *                 false: the submit path released them and fired it already.
     */
    void process(List<String> attemptIds, boolean afterEnd) {
        List<StudentAttempt> attempts = new ArrayList<>();
        studentAttemptRepository.findAllById(attemptIds).forEach(attempts::add);

        Map<String, Assessment> assessments = new LinkedHashMap<>();
        Map<String, List<StudentAttempt>> byAssessment = new LinkedHashMap<>();
        long staleBefore = System.currentTimeMillis() - STALE_NOTICE_MS;
        for (StudentAttempt attempt : attempts) {
            Assessment assessment = attempt.getRegistration() == null ? null : attempt.getRegistration().getAssessment();
            if (assessment == null) {
                log.warn("[AUTO-RELEASE] attempt {} has no assessment; skipped", attempt.getId());
                continue;
            }
            if ("DELETED".equals(assessment.getStatus())) {
                log.info("[AUTO-RELEASE] attempt {} not emailed: assessment {} is deleted", attempt.getId(), assessment.getId());
                continue;
            }
            if (!afterEnd && !isFreshRelease(attempt, staleBefore)) {
                log.info("[AUTO-RELEASE] attempt {} not emailed: not released or released over a day ago (status {}, {})",
                        attempt.getId(), attempt.getReportReleaseStatus(), attempt.getReportLastReleaseDate());
                continue;
            }
            assessments.putIfAbsent(assessment.getId(), assessment);
            byAssessment.computeIfAbsent(assessment.getId(), k -> new ArrayList<>()).add(attempt);
        }
        if (byAssessment.isEmpty()) {
            return;
        }

        Map<String, String> instituteByAssessment = institutesOf(new ArrayList<>(byAssessment.keySet()));
        byAssessment.forEach((assessmentId, list) -> {
            String instituteId = instituteByAssessment.get(assessmentId);
            if (instituteId == null) {
                log.warn("[AUTO-RELEASE] assessment {} has no institute; {} attempts released without email",
                        assessmentId, list.size());
                return;
            }
            try {
                participantsManager.releaseAutomatically(list, assessments.get(assessmentId), instituteId, afterEnd);
            } catch (Exception e) {
                log.error("[AUTO-RELEASE] report/email failed for assessment {} ({} attempts)", assessmentId, list.size(), e);
            }
        });
    }

    private static boolean isFreshRelease(StudentAttempt attempt, long staleBefore) {
        Date released = attempt.getReportLastReleaseDate();
        return "RELEASED".equals(attempt.getReportReleaseStatus()) && released != null && released.getTime() >= staleBefore;
    }

    private Map<String, String> institutesOf(List<String> assessmentIds) {
        Map<String, String> out = new HashMap<>();
        jdbc.query(INSTITUTES_SQL, new MapSqlParameterSource("assessmentIds", assessmentIds), rs -> {
            out.putIfAbsent(rs.getString("assessment_id"), rs.getString("institute_id"));
        });
        return out;
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
