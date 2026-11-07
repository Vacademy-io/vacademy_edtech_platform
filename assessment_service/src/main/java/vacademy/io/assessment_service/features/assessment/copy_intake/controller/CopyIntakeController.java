package vacademy.io.assessment_service.features.assessment.copy_intake.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Bulk AI copy-check: upload many scanned copies, let the system read the
 * names, match the students, and queue the checks. Files are uploaded to the
 * media service by the dashboard first; only their ids travel here.
 *
 * <p>Every call is bound to the caller's institute the same way the single
 * copy-check endpoints are (see {@link EvaluationAccessValidator}): a batch
 * spends that institute's credits and creates attempts on its students, so
 * the assessment must belong to the institute named in the request, and a
 * batch may only be read or changed through the institute that owns it.
 */
@RestController
@RequestMapping("/assessment-service/assessment/copy-intake/v1")
@RequiredArgsConstructor
public class CopyIntakeController {

    private final CopyIntakeService service;
    private final CopyIntakeRunner runner;
    private final EvaluationAccessValidator accessValidator;
    private final AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    @PostMapping("/start")
    public ResponseEntity<CopyIntakeDtos.BatchDto> start(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestHeader(value = "clientId", required = false) String clientId,
                                                         @RequestParam("assessmentId") String assessmentId,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestBody CopyIntakeDtos.StartRequest request) {
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        AiCopyIntakeBatch batch = service.start(user, assessmentId, instituteId, request);
        runner.run(batch.getId());
        return ResponseEntity.ok(service.toDto(batch, false));
    }

    /**
     * What a check of the learners' own submissions would do - how many have a
     * copy, how many are already checked or running, how many would be queued -
     * so the dialog can quote the cost before anything is spent.
     */
    @PostMapping("/submitted/preview")
    public ResponseEntity<CopyIntakeDtos.SubmittedPreviewDto> previewSubmitted(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) CopyIntakeDtos.SubmittedRequest request) {
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.previewSubmitted(assessmentId,
                request == null ? null : request.getAttemptIds(),
                request != null && Boolean.TRUE.equals(request.getIncludeChecked())));
    }

    /**
     * Queue the AI check for copies the learners submitted themselves - the
     * checked rows, or every submitted copy on the assessment - as one batch.
     */
    @PostMapping("/submitted/start")
    public ResponseEntity<CopyIntakeDtos.BatchDto> startFromSubmitted(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) CopyIntakeDtos.SubmittedRequest request) {
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        AiCopyIntakeBatch batch = service.startFromSubmitted(user, assessmentId, instituteId, request);
        runner.run(batch.getId());
        return ResponseEntity.ok(service.toDto(batch, false));
    }

    /** The AI checking settings kept on the assessment (subject, instructions, language feedback). */
    @GetMapping("/copy-check-config")
    public ResponseEntity<CopyCheckConfig.Settings> copyCheckConfig(@RequestAttribute("user") CustomUserDetails user,
                                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                                    @RequestParam("assessmentId") String assessmentId,
                                                                    @RequestParam("instituteId") String instituteId) {
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(service.copyCheckConfig(assessmentId));
    }

    /**
     * Save the AI checking settings on the assessment without sending copies (used where
     * copies are checked one by one, e.g. a course's assessment slide). Empty settings
     * clear them, so the institute default applies again.
     */
    @PutMapping("/copy-check-config")
    public ResponseEntity<CopyCheckConfig.Settings> saveCopyCheckConfig(@RequestAttribute("user") CustomUserDetails user,
                                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                                        @RequestParam("assessmentId") String assessmentId,
                                                                        @RequestParam("instituteId") String instituteId,
                                                                        @RequestBody CopyCheckConfig.Settings settings) {
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.saveCopyCheckConfig(assessmentId,
                settings == null ? new CopyCheckConfig.Settings() : settings));
    }

    @GetMapping("/batches")
    public ResponseEntity<List<CopyIntakeDtos.BatchDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                              @RequestHeader(value = "clientId", required = false) String clientId,
                                                              @RequestParam("assessmentId") String assessmentId,
                                                              @RequestParam("instituteId") String instituteId) {
        requireMember(user, clientId, instituteId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.listBatches(assessmentId, instituteId).stream()
                .map(b -> service.toDto(b, false)).toList());
    }

    @GetMapping("/batch/{batchId}")
    public ResponseEntity<CopyIntakeDtos.BatchDto> get(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @PathVariable String batchId) {
        AiCopyIntakeBatch batch = requireBatch(user, clientId, instituteId, batchId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.toDto(batch, true));
    }

    /** The batch's checked copies, for downloading them all at once. Read-only. */
    @GetMapping("/batch/{batchId}/checked-copies")
    public ResponseEntity<List<CopyIntakeDtos.CheckedCopyDto>> checkedCopies(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("instituteId") String instituteId,
            @PathVariable String batchId) {
        requireBatch(user, clientId, instituteId, batchId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.checkedCopies(batchId));
    }

    @PostMapping("/item/{itemId}/resolve")
    public ResponseEntity<CopyIntakeDtos.ItemDto> resolve(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("instituteId") String instituteId,
                                                          @PathVariable String itemId,
                                                          @RequestBody CopyIntakeDtos.ResolveRequest request) {
        requireItem(user, clientId, instituteId, itemId);
        accessValidator.requireStaffRole(user);
        AiCopyIntakeItem item = service.resolve(user, itemId, request);
        service.finalizeIfDone(item.getBatchId());
        return ResponseEntity.ok(service.toDto(item));
    }

    @PostMapping("/item/{itemId}/skip")
    public ResponseEntity<CopyIntakeDtos.ItemDto> skip(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @PathVariable String itemId) {
        requireItem(user, clientId, instituteId, itemId);
        accessValidator.requireStaffRole(user);
        AiCopyIntakeItem item = service.skip(user, itemId);
        service.finalizeIfDone(item.getBatchId());
        return ResponseEntity.ok(service.toDto(item));
    }

    @PostMapping("/item/{itemId}/retry")
    public ResponseEntity<CopyIntakeDtos.ItemDto> retry(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @PathVariable String itemId) {
        requireItem(user, clientId, instituteId, itemId);
        accessValidator.requireStaffRole(user);
        AiCopyIntakeItem item = service.retry(user, itemId);
        runner.run(item.getBatchId());
        return ResponseEntity.ok(service.toDto(item));
    }

    // ---- tenant binding ------------------------------------------------------

    /**
     * The instituteId parameter must be the clientId institute the caller's roles
     * were loaded for; otherwise an admin of their own institute could name
     * another one here and pass the membership and staff checks with their roles.
     */
    private void requireMember(CustomUserDetails user, String clientId, String instituteId) {
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireInstituteMembership(user, instituteId);
    }

    private void requireAssessmentInInstitute(CustomUserDetails user, String clientId, String assessmentId,
                                              String instituteId) {
        requireMember(user, clientId, instituteId);
        if (assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId).isEmpty()) {
            throw new ForbiddenException("This assessment does not belong to your institute");
        }
    }

    private AiCopyIntakeBatch requireBatch(CustomUserDetails user, String clientId, String instituteId,
                                           String batchId) {
        requireMember(user, clientId, instituteId);
        AiCopyIntakeBatch batch = service.getBatch(batchId).orElseThrow(() -> new VacademyException("Batch not found"));
        if (!instituteId.equals(batch.getInstituteId())) {
            throw new ForbiddenException("This upload belongs to another institute");
        }
        return batch;
    }

    private void requireItem(CustomUserDetails user, String clientId, String instituteId, String itemId) {
        String batchId = service.getItem(itemId).map(AiCopyIntakeItem::getBatchId)
                .orElseThrow(() -> new VacademyException("Copy not found"));
        requireBatch(user, clientId, instituteId, batchId);
    }
}
