package vacademy.io.assessment_service.features.open_evaluation.submission;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;

/**
 * Keeps {@code api_submission.updated_at} moving whenever anything a partner can see about a
 * submission changes, so {@code GET /submissions?updated_since=} and the exam list (ordered by
 * {@code (updated_at, id)}, spec 7.0/7.6) never miss a change.
 *
 * <ul>
 *   <li>{@link #touch} — the facade's own writes and the two shared paths that change a
 *       result without touching its AI run (dashboard override, release). One indexed
 *       UPDATE by primary key; a no-op for dashboard attempts.</li>
 *   <li>{@link #syncFromEngine} — every few seconds, submissions whose AI run moved
 *       (queued → grading → graded, failed, cancelled) since they were last touched. The
 *       engine's callbacks, dispatcher and sweeper are many code paths; this one query
 *       follows {@code ai_evaluation_process.updated_at} (a real heartbeat, bumped by every
 *       status and progress write) instead of hooking each of them.</li>
 * </ul>
 * Bumping to "now" keeps a sync loop correct: a cursor a partner already holds is always
 * older than the new value, so the row is served again.
 */
@Slf4j
@Component
public class ApiSubmissionFeed {

    /** How far back each pass looks; covers a pod restart or a slow pass. */
    static final Duration LOOKBACK = Duration.ofMinutes(15);

    private final NamedParameterJdbcTemplate jdbc;
    private final OpenApiProperties properties;
    private final Clock clock;
    /** Runs a deferred touch in its own short transaction; null = run directly (tests). */
    private final TransactionTemplate ownTransaction;

    @Autowired
    public ApiSubmissionFeed(JdbcTemplate jdbcTemplate, OpenApiProperties properties,
            PlatformTransactionManager transactionManager) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), properties, Clock.systemUTC(), requiresNew(transactionManager));
    }

    ApiSubmissionFeed(NamedParameterJdbcTemplate jdbc, OpenApiProperties properties, Clock clock) {
        this(jdbc, properties, clock, null);
    }

    ApiSubmissionFeed(NamedParameterJdbcTemplate jdbc, OpenApiProperties properties, Clock clock,
            TransactionTemplate ownTransaction) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
        this.ownTransaction = ownTransaction;
    }

    private static TransactionTemplate requiresNew(PlatformTransactionManager transactionManager) {
        if (transactionManager == null) {
            return null;
        }
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return template;
    }

    /**
     * Marks these attempts' submissions as changed (no-op for attempts that are not API
     * submissions). Inside a transaction the bump waits until it commits and then runs in a
     * transaction of its own: a feed problem can then never roll back (or poison) the
     * caller's write — the dashboard's Release Result runs through here — and the bump is
     * never visible before the change it announces.
     */
    public void touch(Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) {
            return;
        }
        List<String> ids = List.copyOf(attemptIds);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    touchNow(ids);
                }
            });
        } else {
            touchNow(ids);
        }
    }

    void touchNow(List<String> ids) {
        try {
            if (ownTransaction != null) {
                ownTransaction.executeWithoutResult(status -> update(ids));
            } else {
                update(ids);
            }
        } catch (RuntimeException e) {
            // Never fail the business write over feed bookkeeping; the engine sync catches up.
            log.warn("[open-api] could not touch {} submission(s): {}", ids.size(), e.getMessage());
        }
    }

    private void update(List<String> ids) {
        jdbc.update("UPDATE api_submission SET updated_at = now() WHERE attempt_id IN (:ids)",
                new MapSqlParameterSource("ids", ids));
    }

    public void touch(String attemptId) {
        if (attemptId != null) {
            touch(List.of(attemptId));
        }
    }

    /** Follows AI-run changes into the submission feed (see the class comment). */
    @Scheduled(fixedDelayString = "${assessment.open-api.feed-sync-ms:5000}",
            initialDelayString = "${assessment.open-api.feed-sync-initial-delay-ms:30000}")
    public void syncFromEngine() {
        if (properties != null && !properties.isEnabled()) {
            return;
        }
        try {
            int touched = syncOnce();
            if (touched > 0) {
                log.debug("[open-api] feed sync touched {} submission(s)", touched);
            }
        } catch (RuntimeException e) {
            log.warn("[open-api] feed sync failed: {}", e.getMessage());
        }
    }

    int syncOnce() {
        Instant since = clock.instant().minus(LOOKBACK);
        return jdbc.update("""
                UPDATE api_submission s SET updated_at = now()
                FROM ai_evaluation_process p
                WHERE p.updated_at > :since
                  AND p.attempt_id = s.attempt_id
                  AND p.updated_at > s.updated_at
                """, new MapSqlParameterSource("since", Timestamp.from(since)));
    }
}
