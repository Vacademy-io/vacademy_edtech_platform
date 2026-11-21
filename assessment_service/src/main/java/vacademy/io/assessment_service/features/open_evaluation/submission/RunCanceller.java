package vacademy.io.assessment_service.features.open_evaluation.submission;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationCancellationService;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Cancels an attempt's live AI runs (spec 7.6 cancel, replace, delete) the way the
 * dashboard's stop does, but guarded and transaction-friendly:
 * <ol>
 *   <li>in the caller's transaction, a guarded UPDATE moves each queued or running run to
 *       CANCELLED (a run that finished in the meantime is left alone) and its unfinished
 *       question rows with it. A queued run never reaches ai_service: the dispatcher's
 *       guarded start only takes DISPATCHED rows, and the poller only PENDING ones;</li>
 *   <li>after commit, for runs that had already been claimed or sent, the in-memory flag is
 *       raised and ai_service is told to abort (by process id). Billing is skipped because the
 *       orchestrator bills only after a completed run, and the callback service ignores
 *       late callbacks of a CANCELLED run.</li>
 * </ol>
 */
@Slf4j
@Component
public class RunCanceller {

    static final String ACTIVE_LIST = AiEvaluationStatusEnum.ACTIVE.stream().map(s -> "'" + s + "'")
            .collect(Collectors.joining(", "));

    private final NamedParameterJdbcTemplate jdbc;
    private final AiEvaluationCancellationService cancellation;
    private final AiServiceCopyCheckClient copyCheck;

    @Autowired
    public RunCanceller(JdbcTemplate jdbcTemplate, AiEvaluationCancellationService cancellation,
            AiServiceCopyCheckClient copyCheck) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), cancellation, copyCheck);
    }

    RunCanceller(NamedParameterJdbcTemplate jdbc, AiEvaluationCancellationService cancellation,
            AiServiceCopyCheckClient copyCheck) {
        this.jdbc = jdbc;
        this.cancellation = cancellation;
        this.copyCheck = copyCheck;
    }

    /** One cancelled run: its id and whether it had left the queue. */
    public record Cancelled(String processId, boolean wasQueued) {
    }

    /**
     * Cancels every live run of the attempt. Must run inside a transaction when one is
     * active; the ai_service abort is deferred to after commit.
     *
     * @return the runs this call cancelled (empty when none was live)
     */
    public List<Cancelled> cancelLiveRuns(String attemptId) {
        List<Cancelled> out = new ArrayList<>();
        List<String[]> live = jdbc.query("SELECT id, status FROM ai_evaluation_process WHERE attempt_id = :a "
                        + "AND status IN (" + ACTIVE_LIST + ") FOR UPDATE",
                new MapSqlParameterSource("a", attemptId), (rs, i) -> new String[]{rs.getString(1), rs.getString(2)});
        for (String[] run : live) {
            int moved = jdbc.update("UPDATE ai_evaluation_process SET status = 'CANCELLED', current_step = 'STOPPED', "
                            + "claimed_by = NULL, claimed_at = NULL, completed_at = now(), updated_at = now() "
                            + "WHERE id = :id AND status IN (" + ACTIVE_LIST + ")",
                    new MapSqlParameterSource("id", run[0]));
            if (moved == 0) {
                continue;
            }
            jdbc.update("UPDATE ai_question_evaluation SET status = 'CANCELLED', completed_at = now(), updated_at = now() "
                    + "WHERE evaluation_process_id = :id AND status <> 'COMPLETED' AND NOT COALESCE(is_edited, FALSE)",
                    new MapSqlParameterSource("id", run[0]));
            out.add(new Cancelled(run[0], AiEvaluationStatusEnum.PENDING.name().equals(run[1])));
        }
        List<String> sent = out.stream().filter(c -> !c.wasQueued()).map(Cancelled::processId).toList();
        if (!sent.isEmpty()) {
            afterCommit(() -> sent.forEach(this::abort));
        }
        return out;
    }

    private void abort(String processId) {
        try {
            if (cancellation != null) {
                cancellation.cancelProcess(processId);
            }
            if (copyCheck != null) {
                copyCheck.cancelByProcessId(processId);
            }
        } catch (Exception e) {
            log.warn("[open-api] could not forward cancel of process {}: {}", processId, e.getMessage());
        }
    }

    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
