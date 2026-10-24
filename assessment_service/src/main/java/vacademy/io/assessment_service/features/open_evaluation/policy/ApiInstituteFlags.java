package vacademy.io.assessment_service.features.open_evaluation.policy;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Duration;
import java.util.Optional;

/**
 * Per-institute API settings this pod has learned from verified keys, for code that runs
 * outside a key request (dashboard release, schedulers, AI callbacks) and still has to
 * honour {@code institute_api_access.fire_workflow_events}.
 *
 * <p>Source of truth is admin_core; this is only what the key verifier last saw. Lookup
 * order: the API key of the current request (exact and fresh), then the last principal
 * this pod verified for that institute (kept 24 h), else {@code false}. Unknown means
 * "suppress": a missed opt-in automation is recoverable, a WhatsApp blast to candidates
 * with blank channels is not.
 */
@Component
public class ApiInstituteFlags {

    private final Cache<String, Boolean> fireWorkflowEvents = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofHours(24))
            .build();

    /** Called by the key verifier for every principal it loads from admin_core. */
    public void record(ApiKeyPrincipal principal) {
        if (principal != null && principal.getInstituteId() != null) {
            fireWorkflowEvents.put(principal.getInstituteId(), principal.isFireWorkflowEvents());
        }
    }

    public boolean fireWorkflowEvents(String instituteId) {
        if (instituteId == null) {
            return false;
        }
        Optional<ApiKeyPrincipal> current = currentPrincipal();
        if (current.isPresent() && instituteId.equals(current.get().getInstituteId())) {
            return current.get().isFireWorkflowEvents();
        }
        Boolean remembered = fireWorkflowEvents.getIfPresent(instituteId);
        return Boolean.TRUE.equals(remembered);
    }

    private static Optional<ApiKeyPrincipal> currentPrincipal() {
        try {
            return ApiKeyAuthentication.current();
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}
