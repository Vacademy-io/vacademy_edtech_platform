package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_session.dto.BulkLiveSessionRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.BulkLiveSessionResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep1RequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep2RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class BulkLiveSessionService {

    private final Step1Service step1Service;
    private final Step2Service step2Service;
    private final LiveSessionWorkflowAsyncHelper workflowAsyncHelper;
    private final LiveSessionInstructorService instructorService;

    /**
     * Self-reference used to invoke {@link #createOneAtomically} through the
     * Spring proxy so the {@code @Transactional} annotation actually takes
     * effect — calling {@code this.createOneAtomically(...)} would bypass the
     * proxy and the per-row transaction would never start.
     * {@code @Lazy} avoids the self-bean-definition cycle that would otherwise
     * trip Spring at startup.
     */
    @Autowired
    @Lazy
    private BulkLiveSessionService self;

    public BulkLiveSessionResponseDTO createBulk(BulkLiveSessionRequestDTO request,
                                                 CustomUserDetails user) {
        if (request == null || request.getSessions() == null || request.getSessions().isEmpty()) {
            throw new VacademyException("At least one session is required for bulk creation.");
        }

        List<LiveSessionStep1RequestDTO> sessions = request.getSessions();
        LiveSessionStep2RequestDTO step2Template = request.getStep2Template();
        List<LiveSessionStep2RequestDTO> step2PerRow = request.getStep2PerRow();
        log.info(
                "Bulk create requested: sessions={}, step2_per_row={}, step2_template={}",
                sessions.size(),
                step2PerRow == null ? "null" : "size=" + step2PerRow.size(),
                step2Template == null ? "null" : "present");
        if (step2PerRow != null && step2PerRow.size() != sessions.size()) {
            throw new VacademyException(
                    "step2_per_row length (" + step2PerRow.size() +
                            ") must match sessions length (" + sessions.size() + ")");
        }

        // Resolve the CSV's instructor identifiers (ids / emails / usernames)
        // BEFORE the row loop, so the whole import costs one staff-directory
        // fetch instead of one per row, and so an identifier that matches
        // nobody surfaces as a per-row warning rather than a failed row.
        Map<Integer, List<String>> unresolvedInstructorsByRow =
                resolveInstructorIdentifiers(sessions, step2Template, step2PerRow);

        List<BulkLiveSessionResponseDTO.RowResult> results = new ArrayList<>(sessions.size());
        // Collect (savedSession, instituteId) pairs and fire the workflow
        // asynchronously *after* we've finished writing every row. This is the
        // single biggest perf improvement — each LIVE_SESSION_CREATE workflow
        // can take 0.5-2s (attendance HTML generation + cross-region notification
        // service POST), so doing N of them inside the request thread blew up
        // the bulk endpoint's latency.
        List<LiveSession> sessionsToFireWorkflow = new ArrayList<>(sessions.size());
        List<String> instituteIdsForWorkflow = new ArrayList<>(sessions.size());
        int created = 0;
        int failed = 0;

        // Per-row try/catch on purpose — partial failures must not roll back
        // rows that already succeeded. Each row runs in its OWN transaction
        // (REQUIRES_NEW inside createOneAtomically), so a step2 failure
        // rolls back that row's session+schedules instead of leaving a
        // half-applied DRAFT in the DB. The caller surfaces failures back
        // to the user.
        for (int i = 0; i < sessions.size(); i++) {
            LiveSessionStep1RequestDTO row = sessions.get(i);
            String title = row != null ? row.getTitle() : null;

            // Resolve which step-2 payload (if any) to apply to this row:
            // per-row entry > shared template > nothing.
            LiveSessionStep2RequestDTO perRowStep2 = null;
            if (step2PerRow != null) {
                perRowStep2 = step2PerRow.get(i);
            } else if (step2Template != null) {
                perRowStep2 = step2Template;
            }

            try {
                LiveSession saved = self.createOneAtomically(row, perRowStep2, user);
                boolean step2Applied = perRowStep2 != null;

                sessionsToFireWorkflow.add(saved);
                instituteIdsForWorkflow.add(saved.getInstituteId());
                List<String> unresolved = unresolvedInstructorsByRow.get(i);
                results.add(BulkLiveSessionResponseDTO.RowResult.builder()
                        .index(i)
                        .success(true)
                        .sessionId(saved.getId())
                        .title(title)
                        .step2Applied(step2Applied)
                        .warnings(unresolved == null || unresolved.isEmpty() ? null
                                : List.of("These instructors were not found in this institute and were skipped: "
                                        + String.join(", ", unresolved)))
                        .build());
                created++;
            } catch (Exception ex) {
                log.error("Bulk live session creation failed at row {}: {}", i, ex.getMessage(), ex);
                results.add(BulkLiveSessionResponseDTO.RowResult.builder()
                        .index(i)
                        .success(false)
                        .title(title)
                        .error(describeFailure(ex))
                        .build());
                failed++;
            }
        }

        // Fire LIVE_SESSION_CREATE workflows asynchronously. Each call hands
        // off to Spring's @Async pool and returns immediately, so the request
        // thread can wrap up and respond. Workflows still run — admin-side
        // workflow integrations (e.g. emails to enrolled learners) keep
        // working — they just no longer block the API response.
        for (int i = 0; i < sessionsToFireWorkflow.size(); i++) {
            workflowAsyncHelper.fireLiveSessionCreateWorkflow(
                    sessionsToFireWorkflow.get(i),
                    user.getUserId(),
                    instituteIdsForWorkflow.get(i));
        }

        return BulkLiveSessionResponseDTO.builder()
                .totalRequested(sessions.size())
                .totalCreated(created)
                .totalFailed(failed)
                .results(results)
                .build();
    }

    /**
     * Runs step1 + step2 for a single row inside its OWN transaction. If
     * step2 throws, the framework rolls back the row's session and schedules
     * — no orphan DRAFT is left behind, and the caller sees the real
     * exception message instead of a misleading "created but step2 not
     * applied" outcome.
     *
     * Must be called via the {@link #self} proxy (not {@code this.}) for the
     * {@code @Transactional} annotation to be honoured.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public LiveSession createOneAtomically(LiveSessionStep1RequestDTO row,
                                           LiveSessionStep2RequestDTO perRowStep2,
                                           CustomUserDetails user) {
        // Skip the synchronous workflow trigger — the caller fires it
        // asynchronously after the bulk request finishes.
        LiveSession saved = step1Service.step1AddService(row, user, false);
        if (perRowStep2 != null) {
            LiveSessionStep2RequestDTO step2ForRow =
                    cloneTemplateForSession(perRowStep2, saved.getId());
            step2Service.step2AddService(step2ForRow, user);
            log.info("Bulk row step2 applied for sessionId={}", saved.getId());
        } else {
            log.info(
                    "Bulk row step2 SKIPPED (no per-row payload and no template) for sessionId={}",
                    saved.getId());
        }
        return saved;
    }

    /**
     * Returns a copy of the shared step-2 payload with its session_id replaced
     * by the freshly created session id. The template object itself is not
     * mutated so it can be safely reused across rows.
     */
    @SuppressWarnings("deprecation")
    private LiveSessionStep2RequestDTO cloneTemplateForSession(LiveSessionStep2RequestDTO template,
                                                               String sessionId) {
        LiveSessionStep2RequestDTO copy = new LiveSessionStep2RequestDTO();
        copy.setSessionId(sessionId);
        copy.setAccessType(template.getAccessType());
        copy.setPackageSessionIds(template.getPackageSessionIds());
        copy.setDeletedPackageSessionIds(template.getDeletedPackageSessionIds());
        copy.setIndividualUserIds(template.getIndividualUserIds());
        copy.setDeletedIndividualUserIds(template.getDeletedIndividualUserIds());
        // The frontend may send `{{SESSION_ID}}` as a placeholder in the join
        // link (PUBLIC sessions need the real id, which only exists after
        // step 1 saves). Substitute here so the persisted link is valid.
        String join = template.getJoinLink();
        if (join != null && join.contains("{{SESSION_ID}}")) {
            join = join.replace("{{SESSION_ID}}", sessionId);
        }
        copy.setJoinLink(join);
        copy.setAddedNotificationActions(template.getAddedNotificationActions());
        copy.setUpdatedNotificationActions(template.getUpdatedNotificationActions());
        copy.setDeletedNotificationActionIds(template.getDeletedNotificationActionIds());
        copy.setAddedFields(template.getAddedFields());
        copy.setUpdatedFields(template.getUpdatedFields());
        copy.setDeletedFieldIds(template.getDeletedFieldIds());
        copy.setInstituteCustomFields(template.getInstituteCustomFields());
        copy.setRecordingAutoLinkConfig(template.getRecordingAutoLinkConfig());
        // Already resolved to ids by resolveInstructorIdentifiers, so the
        // identifiers list is deliberately NOT carried over — re-resolving it
        // per row would repeat the directory fetch for every row.
        copy.setInstructorUserIds(template.getInstructorUserIds());
        return copy;
    }

    /**
     * Turns each row's {@code instructor_identifiers} into user ids on the row's
     * step-2 payload, and returns the identifiers that matched nobody, keyed by
     * row index.
     *
     * <p>Mutates the request's step-2 payloads in place, which is safe because
     * they are per-request deserialized objects. The shared template is handled
     * once rather than per row, so a template-level instructor list costs a
     * single lookup.
     *
     * @return unresolved identifiers per row index; empty when nothing needed resolving
     */
    private Map<Integer, List<String>> resolveInstructorIdentifiers(
            List<LiveSessionStep1RequestDTO> sessions,
            LiveSessionStep2RequestDTO step2Template,
            List<LiveSessionStep2RequestDTO> step2PerRow) {

        Map<Integer, List<String>> unresolvedByRow = new HashMap<>();

        String instituteId = sessions.stream()
                .filter(java.util.Objects::nonNull)
                .map(LiveSessionStep1RequestDTO::getInstituteId)
                .filter(id -> id != null && !id.isBlank())
                .findFirst()
                .orElse(null);
        if (instituteId == null) {
            return unresolvedByRow;
        }

        if (step2PerRow != null) {
            for (int i = 0; i < step2PerRow.size(); i++) {
                List<String> unresolved = applyResolvedInstructors(step2PerRow.get(i), instituteId);
                if (!unresolved.isEmpty()) {
                    unresolvedByRow.put(i, unresolved);
                }
            }
        } else if (step2Template != null) {
            List<String> unresolved = applyResolvedInstructors(step2Template, instituteId);
            if (!unresolved.isEmpty()) {
                for (int i = 0; i < sessions.size(); i++) {
                    unresolvedByRow.put(i, unresolved);
                }
            }
        }
        return unresolvedByRow;
    }

    /** Folds resolved identifiers into {@code instructorUserIds} and clears the raw list. */
    private List<String> applyResolvedInstructors(LiveSessionStep2RequestDTO step2, String instituteId) {
        if (step2 == null || step2.getInstructorIdentifiers() == null
                || step2.getInstructorIdentifiers().isEmpty()) {
            return List.of();
        }
        LiveSessionInstructorService.ResolvedIdentifiers resolved =
                instructorService.resolveIdentifiers(instituteId, step2.getInstructorIdentifiers());

        List<String> merged = new ArrayList<>();
        if (step2.getInstructorUserIds() != null) {
            merged.addAll(step2.getInstructorUserIds());
        }
        resolved.userIds().stream().filter(id -> !merged.contains(id)).forEach(merged::add);
        step2.setInstructorUserIds(merged);
        step2.setInstructorIdentifiers(null);
        return resolved.unresolved();
    }

    /**
     * Build a non-null, human-readable error string for the response. Walks
     * the exception cause chain so we don't end up with {@code null} when the
     * top-level exception (e.g. NPE, some Spring wrappers) carries no message
     * but its cause does. Falls back to the simple class name so the caller
     * always has *something* actionable to display.
     */
    private String describeFailure(Throwable ex) {
        Throwable cur = ex;
        while (cur != null) {
            String msg = cur.getMessage();
            if (msg != null && !msg.isBlank()) {
                if (cur == ex) return msg;
                return ex.getClass().getSimpleName() + ": " + msg;
            }
            cur = cur.getCause();
        }
        return ex.getClass().getName();
    }
}
