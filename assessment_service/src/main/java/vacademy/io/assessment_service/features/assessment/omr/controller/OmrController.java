package vacademy.io.assessment_service.features.assessment.omr.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrDtos;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanBatch;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanItem;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrRollService;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrScanRunner;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrScanService;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrSetService;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * OMR sheets for pen-and-paper MCQ exams: settings and paper sets, the printable sheet
 * per set, the roll-number pre-check, and the upload + review of filled sheets.
 *
 * <p>Every call is bound to the caller's institute exactly as the bulk copy intake is
 * (see CopyIntakeController): the assessment must belong to the institute named in the
 * request, an upload may only be read or changed through the institute that owns it,
 * and only staff may act.
 */
@RestController
@RequestMapping("/assessment-service/assessment/omr/v1")
@RequiredArgsConstructor
public class OmrController {

    private final OmrSetService setService;
    private final OmrRollService rollService;
    private final OmrScanService scanService;
    private final OmrScanRunner runner;
    private final EvaluationAccessValidator accessValidator;
    private final AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    // ------------------------------------------------------------ config / sets

    @GetMapping("/overview")
    public ResponseEntity<OmrDtos.OverviewDto> overview(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("assessmentId") String assessmentId,
                                                        @RequestParam("instituteId") String instituteId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(setService.overview(assessmentId));
    }

    @PutMapping("/config")
    public ResponseEntity<OmrDtos.OverviewDto> saveConfig(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("assessmentId") String assessmentId,
                                                          @RequestParam("instituteId") String instituteId,
                                                          @RequestBody OmrDtos.ConfigRequest request) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(setService.saveConfig(assessmentId, request));
    }

    @PostMapping("/sets/generate")
    public ResponseEntity<OmrDtos.OverviewDto> generateSets(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestHeader(value = "clientId", required = false) String clientId,
                                                            @RequestParam("assessmentId") String assessmentId,
                                                            @RequestParam("instituteId") String instituteId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(setService.generateSets(assessmentId, instituteId));
    }

    /** One set's printed question and option order with the answer key. */
    @GetMapping("/sets/{setId}/paper")
    public ResponseEntity<OmrDtos.PaperDto> paper(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                  @RequestParam("assessmentId") String assessmentId,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @PathVariable String setId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(setService.paper(assessmentId, setId));
    }

    /** The printable OMR sheet of a set (one A4 page; print one per student). */
    @GetMapping(value = "/sets/{setId}/sheet.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> sheet(@RequestAttribute("user") CustomUserDetails user,
                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                        @RequestParam("assessmentId") String assessmentId,
                                        @RequestParam("instituteId") String instituteId,
                                        @PathVariable String setId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        byte[] pdf = setService.sheetPdf(assessmentId, instituteId, setId);
        String code = setService.requireSet(assessmentId, setId).json().getSetCode();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("omr-sheet-set-" + code + ".pdf").build().toString())
                .body(pdf);
    }

    @GetMapping("/roll-check")
    public ResponseEntity<OmrDtos.RollCheckDto> rollCheck(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("assessmentId") String assessmentId,
                                                          @RequestParam("instituteId") String instituteId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(rollService.check(assessmentId, instituteId));
    }

    @GetMapping("/participants")
    public ResponseEntity<List<OmrDtos.ParticipantDto>> participants(@RequestAttribute("user") CustomUserDetails user,
                                                                     @RequestHeader(value = "clientId", required = false) String clientId,
                                                                     @RequestParam("assessmentId") String assessmentId,
                                                                     @RequestParam("instituteId") String instituteId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(scanService.participants(assessmentId, instituteId));
    }

    // -------------------------------------------------------------------- scans

    @PostMapping("/scan/start")
    public ResponseEntity<OmrDtos.BatchDto> start(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                  @RequestParam("assessmentId") String assessmentId,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @RequestBody OmrDtos.StartScanRequest request) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        OmrScanBatch batch = scanService.start(user, assessmentId, instituteId, request);
        runner.run(batch.getId());
        return ResponseEntity.ok(scanService.toDto(batch, false));
    }

    @GetMapping("/scan/batches")
    public ResponseEntity<List<OmrDtos.BatchDto>> batches(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("assessmentId") String assessmentId,
                                                          @RequestParam("instituteId") String instituteId) {
        requireStaffOnAssessment(user, clientId, assessmentId, instituteId);
        return ResponseEntity.ok(scanService.listBatches(assessmentId, instituteId).stream()
                .map(b -> scanService.toDto(b, false)).toList());
    }

    @GetMapping("/scan/batch/{batchId}")
    public ResponseEntity<OmrDtos.BatchDto> batch(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @PathVariable String batchId) {
        OmrScanBatch batch = requireBatch(user, clientId, instituteId, batchId);
        return ResponseEntity.ok(scanService.toDto(batch, true));
    }

    @PostMapping("/scan/item/{itemId}/resolve")
    public ResponseEntity<OmrDtos.SheetDto> resolve(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @PathVariable String itemId,
                                                    @RequestBody OmrDtos.ResolveRequest request) {
        requireItem(user, clientId, instituteId, itemId);
        OmrScanItem item = scanService.resolve(user, itemId, request);
        scanService.finalizeIfDone(item.getBatchId());
        return ResponseEntity.ok(scanService.toDto(item, null));
    }

    @PostMapping("/scan/item/{itemId}/skip")
    public ResponseEntity<OmrDtos.SheetDto> skip(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                 @RequestParam("instituteId") String instituteId,
                                                 @PathVariable String itemId) {
        requireItem(user, clientId, instituteId, itemId);
        OmrScanItem item = scanService.skip(user, itemId);
        scanService.finalizeIfDone(item.getBatchId());
        return ResponseEntity.ok(scanService.toDto(item, null));
    }

    @PostMapping("/scan/item/{itemId}/retry")
    public ResponseEntity<OmrDtos.SheetDto> retry(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @PathVariable String itemId) {
        requireItem(user, clientId, instituteId, itemId);
        OmrScanItem item = scanService.retry(user, itemId);
        runner.run(item.getBatchId());
        return ResponseEntity.ok(scanService.toDto(item, null));
    }

    /** Correct flagged questions (two bubbles, faint marks) on a graded sheet; re-grades it. */
    @PostMapping("/scan/item/{itemId}/fix-answers")
    public ResponseEntity<OmrDtos.SheetDto> fixAnswers(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @PathVariable String itemId,
                                                       @RequestBody OmrDtos.FixAnswersRequest request) {
        requireItem(user, clientId, instituteId, itemId);
        return ResponseEntity.ok(scanService.toDto(scanService.fixAnswers(user, itemId, request), null));
    }

    // ---- tenant binding ------------------------------------------------------

    private void requireMember(CustomUserDetails user, String clientId, String instituteId) {
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireInstituteMembership(user, instituteId);
        accessValidator.requireStaffRole(user);
    }

    private void requireStaffOnAssessment(CustomUserDetails user, String clientId, String assessmentId, String instituteId) {
        requireMember(user, clientId, instituteId);
        if (assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId).isEmpty()) {
            throw new ForbiddenException("This assessment does not belong to your institute");
        }
    }

    private OmrScanBatch requireBatch(CustomUserDetails user, String clientId, String instituteId, String batchId) {
        requireMember(user, clientId, instituteId);
        OmrScanBatch batch = scanService.getBatch(batchId).orElseThrow(() -> new VacademyException("Upload not found"));
        if (!instituteId.equals(batch.getInstituteId())) {
            throw new ForbiddenException("This upload belongs to another institute");
        }
        return batch;
    }

    private void requireItem(CustomUserDetails user, String clientId, String instituteId, String itemId) {
        String batchId = scanService.getItem(itemId).map(OmrScanItem::getBatchId)
                .orElseThrow(() -> new VacademyException("Sheet not found"));
        requireBatch(user, clientId, instituteId, batchId);
    }
}
