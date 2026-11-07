package vacademy.io.assessment_service.features.open_evaluation.audit;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiActorPrincipals;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

/**
 * Partner changes in the admin activity log (spec 11.6, T1.32): create, override, approve,
 * finalize, unfinalize, delete. The actor shows as "API · {key name}" with id
 * {@code apikey:{key_id}}. Recorded only after the change committed (a rolled-back call is
 * never reported as done), fire-and-forget like every other audit row. Payloads are short
 * summaries: ids and counts, never partner text or files.
 */
@Slf4j
@Component
public class OpenApiAudit {

    public static final String ACTION_SUBMISSION_CREATE = "API_SUBMISSION_CREATE";
    public static final String ACTION_SUBMISSION_DELETE = "API_SUBMISSION_DELETE";
    public static final String ACTION_OVERRIDE = "API_MARKS_OVERRIDE";
    public static final String ACTION_APPROVE = "API_MARKS_APPROVE";
    public static final String ACTION_FINALIZE = "API_FINALIZE";
    public static final String ACTION_UNFINALIZE = "API_UNFINALIZE";
    public static final String ACTION_EXAM_CREATE = AssessmentAuditClient.ACTION_CREATE;

    private final AssessmentAuditClient client;

    public OpenApiAudit(AssessmentAuditClient client) {
        this.client = client;
    }

    public void record(ApiKeyPrincipal key, String action, String examId, String description, Object payload) {
        Runnable write = () -> {
            try {
                client.record(ApiActorPrincipals.forKey(key), key.getInstituteId(), action, examId, description, payload);
            } catch (Exception e) {
                log.warn("[open-api] audit not recorded ({} {}): {}", action, examId, e.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    write.run();
                }
            });
        } else {
            write.run();
        }
    }
}
