package vacademy.io.assessment_service.features.assessment.copy_intake.scan.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationService;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Scan station (contract C3): scan a pile in two passes, load by load; the
 * system reads names and pairs sides, the clerk reviews, then one PDF per
 * student goes to the bulk copy intake.
 *
 * <p>Switched off by default: GET /config always answers (enabled:false while
 * off, so the Submissions tab never makes failing calls) and every other route
 * answers 404 unless the station is on for the institute. Tenant binding is the
 * same as {@code CopyIntakeController}'s, and a session is only ever found
 * through the institute (and assessment) it belongs to.
 */
@RestController
@RequestMapping("/assessment-service/assessment/copy-intake/v1/scan")
@RequiredArgsConstructor
public class ScanStationController {

    private final ScanStationService service;
    private final ScanStationProperties properties;
    private final EvaluationAccessValidator accessValidator;
    private final AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    @GetMapping("/config")
    public ResponseEntity<ScanStationDtos.ConfigDto> config(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestHeader(value = "clientId", required = false) String clientId,
                                                            @RequestParam("instituteId") String instituteId) {
        requireMember(user, clientId, instituteId);
        return ResponseEntity.ok(service.config(instituteId));
    }

    @PostMapping("/session")
    public ResponseEntity<ScanStationDtos.SessionDto> create(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("assessmentId") String assessmentId,
                                                             @RequestParam("instituteId") String instituteId) {
        requireOn(instituteId);
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.createSession(user, assessmentId, instituteId));
    }

    @GetMapping("/sessions")
    public ResponseEntity<List<ScanStationDtos.SessionSummaryDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                                        @RequestParam("assessmentId") String assessmentId,
                                                                        @RequestParam("instituteId") String instituteId) {
        requireOn(instituteId);
        requireAssessmentInInstitute(user, clientId, assessmentId, instituteId);
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(service.listSessions(assessmentId, instituteId));
    }

    @GetMapping("/session/{sessionId}")
    public ResponseEntity<ScanStationDtos.SessionDto> get(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("instituteId") String instituteId,
                                                          @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                          @PathVariable String sessionId) {
        return ResponseEntity.ok(service.getSession(requireSession(user, clientId, instituteId, assessmentId, sessionId)));
    }

    @PostMapping("/session/{sessionId}/load")
    public ResponseEntity<ScanStationDtos.SessionDto> addLoad(@RequestAttribute("user") CustomUserDetails user,
                                                              @RequestHeader(value = "clientId", required = false) String clientId,
                                                              @RequestParam("instituteId") String instituteId,
                                                              @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                              @PathVariable String sessionId,
                                                              @RequestBody ScanStationDtos.LoadRequest request) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.addLoad(s, request));
    }

    @PutMapping("/session/{sessionId}/load/{loadNo}")
    public ResponseEntity<ScanStationDtos.SessionDto> replaceLoad(@RequestAttribute("user") CustomUserDetails user,
                                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                                  @RequestParam("instituteId") String instituteId,
                                                                  @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                                  @PathVariable String sessionId,
                                                                  @PathVariable int loadNo,
                                                                  @RequestBody ScanStationDtos.LoadRequest request) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.replaceLoad(s, loadNo, request));
    }

    @DeleteMapping("/session/{sessionId}/load/{loadNo}")
    public ResponseEntity<ScanStationDtos.SessionDto> removeLoad(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                                 @PathVariable String sessionId,
                                                                 @PathVariable int loadNo) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.removeLoad(s, loadNo));
    }

    @PostMapping("/session/{sessionId}/decision")
    public ResponseEntity<ScanStationDtos.SessionDto> decide(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                             @PathVariable String sessionId,
                                                             @RequestBody ScanStationDtos.DecisionRequest request) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.decide(s, request));
    }

    @PostMapping("/session/{sessionId}/build")
    public ResponseEntity<ScanStationDtos.SessionDto> build(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestHeader(value = "clientId", required = false) String clientId,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                            @PathVariable String sessionId) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.build(s));
    }

    @PostMapping("/session/{sessionId}/reopen")
    public ResponseEntity<ScanStationDtos.SessionDto> reopen(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                             @PathVariable String sessionId) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.reopen(s));
    }

    @PostMapping("/session/{sessionId}/start")
    public ResponseEntity<ScanStationDtos.StartResponse> start(@RequestAttribute("user") CustomUserDetails user,
                                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                                               @RequestParam("instituteId") String instituteId,
                                                               @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                               @PathVariable String sessionId,
                                                               @RequestBody(required = false) ScanStationDtos.StartRequest request) {
        AiScanSession s = requireSession(user, clientId, instituteId, assessmentId, sessionId);
        return ResponseEntity.ok(service.start(user, s, request));
    }

    // ---- switch + tenant binding (copied from CopyIntakeController) ----------

    private void requireOn(String instituteId) {
        if (!properties.isOn(instituteId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Not found");
        }
    }

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

    /** On, a member with a staff role, and the session belongs to this institute (and assessment). */
    private AiScanSession requireSession(CustomUserDetails user, String clientId, String instituteId,
                                         String assessmentId, String sessionId) {
        requireOn(instituteId);
        requireMember(user, clientId, instituteId);
        accessValidator.requireStaffRole(user);
        AiScanSession s = service.requireSession(sessionId, instituteId, assessmentId);
        requireAssessmentInInstitute(user, clientId, s.getAssessmentId(), instituteId);
        return s;
    }
}
