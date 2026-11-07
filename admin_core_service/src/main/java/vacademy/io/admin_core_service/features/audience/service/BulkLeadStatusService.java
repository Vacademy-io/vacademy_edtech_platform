package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * "Change status" in the leads list's Bulk actions menu.
 *
 * <p>Deliberately a thin loop over {@link LeadStatusService#changeLeadStatus} rather than a bulk
 * UPDATE: that method is the single path every status change goes through, and it also writes
 * {@code lead_status_history}, logs the timeline entry, emits {@code LEAD_STATUS_CHANGED} and
 * mirrors {@code user_lead_profile.conversion_status}. A bulk UPDATE would move the column and
 * silently skip all four, leaving the list and the side-view disagreeing (the dual-store
 * invariant) and any status-driven workflow unfired.</p>
 *
 * <p>It lives in its own bean, not on {@code LeadStatusService}, so each per-lead call goes
 * through the Spring proxy and gets its OWN transaction. Looping inside {@code LeadStatusService}
 * would be a self-invocation: the proxy is bypassed, {@code @Transactional} never applies, and
 * one bad lead would take the whole batch down with it.</p>
 *
 * <p>Partial success is the normal outcome and is reported per bucket — a selection carried over
 * from a stale page can name leads that were since deleted.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BulkLeadStatusService {

    /** How many failure reasons to hand back; enough for a useful toast, not a wall of text. */
    private static final int MAX_REPORTED_ERRORS = 5;

    private final LeadStatusService leadStatusService;
    private final AudienceResponseRepository audienceResponseRepository;
    private final LeadStatusRepository leadStatusRepository;

    public BulkLeadStatusResponseDTO changeStatusBulk(BulkLeadStatusRequestDTO request,
                                                      CustomUserDetails actor) {
        if (request == null || request.getStatusId() == null || request.getStatusId().isBlank()) {
            throw new VacademyException("statusId is required");
        }
        // De-duplicate up front: "select all across pages" can hand back the same response id
        // twice when a page boundary shifted between fetches, and a repeat would otherwise be
        // counted as a second (no-op) update.
        List<String> responseIds = request.getResponseIds() == null ? List.of()
                : new ArrayList<>(new LinkedHashSet<>(request.getResponseIds().stream()
                        .filter(id -> id != null && !id.isBlank())
                        .collect(Collectors.toList())));
        if (responseIds.isEmpty()) {
            return BulkLeadStatusResponseDTO.builder().errors(List.of()).build();
        }

        // Validate the target once rather than per lead — changeLeadStatus would re-read and
        // re-throw it for every id otherwise, turning one bad status id into N identical errors.
        if (!leadStatusRepository.existsById(request.getStatusId())) {
            throw new VacademyException("Lead status not found: " + request.getStatusId());
        }

        String source = request.getSource() != null && !request.getSource().isBlank()
                ? request.getSource() : "BULK_MANUAL";
        String actorUserId = actor != null ? actor.getUserId() : null;

        // One batch read so leads already on the target status are counted without a query each.
        Map<String, AudienceResponse> byId = audienceResponseRepository.findAllById(responseIds)
                .stream()
                .collect(Collectors.toMap(AudienceResponse::getId, Function.identity(), (a, b) -> a));

        int updated = 0;
        int unchanged = 0;
        int failed = 0;
        List<String> errors = new ArrayList<>();

        for (String responseId : responseIds) {
            AudienceResponse lead = byId.get(responseId);
            if (lead == null) {
                failed++;
                addError(errors, "Lead " + responseId + " no longer exists");
                continue;
            }
            if (Objects.equals(lead.getLeadStatusId(), request.getStatusId())) {
                unchanged++;
                continue;
            }
            try {
                leadStatusService.changeLeadStatus(responseId, request.getStatusId(), actorUserId, source);
                updated++;
            } catch (Exception ex) {
                failed++;
                addError(errors, "Lead " + responseId + ": " + ex.getMessage());
                log.warn("[BulkLeadStatus] Failed to restatus lead {}: {}", responseId, ex.getMessage());
            }
        }

        log.info("[BulkLeadStatus] institute={} actor={} target={} updated={} unchanged={} failed={}",
                request.getInstituteId(), actorUserId, request.getStatusId(), updated, unchanged, failed);

        return BulkLeadStatusResponseDTO.builder()
                .updated(updated)
                .unchanged(unchanged)
                .failed(failed)
                .errors(errors)
                .build();
    }

    private void addError(List<String> errors, String message) {
        if (errors.size() < MAX_REPORTED_ERRORS) {
            errors.add(message);
        }
    }
}
