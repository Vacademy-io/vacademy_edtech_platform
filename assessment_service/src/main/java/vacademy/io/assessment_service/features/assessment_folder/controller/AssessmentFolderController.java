package vacademy.io.assessment_service.features.assessment_folder.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment_folder.dto.*;
import vacademy.io.assessment_service.features.assessment_folder.service.AssessmentFolderAccessGuard;
import vacademy.io.assessment_service.features.assessment_folder.service.AssessmentFolderService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/assessment-service/assessment/folder/v1")
public class AssessmentFolderController {

    @Autowired
    private AssessmentFolderService folderService;

    @Autowired
    private AssessmentFolderAccessGuard accessGuard;

    @GetMapping("/list")
    public ResponseEntity<List<AssessmentFolderDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam("instituteId") String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.listForAdmin(instituteId));
    }

    @PostMapping("/create")
    public ResponseEntity<AssessmentFolderDto> create(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestHeader(value = "clientId", required = false) String clientId,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody AssessmentFolderRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.create(user, instituteId, request));
    }

    @PutMapping("/update")
    public ResponseEntity<AssessmentFolderDto> update(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestHeader(value = "clientId", required = false) String clientId,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestParam("folderId") String folderId,
                                                      @RequestBody AssessmentFolderRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.update(instituteId, folderId, request));
    }

    @DeleteMapping("/delete")
    public ResponseEntity<String> delete(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestHeader(value = "clientId", required = false) String clientId,
                                         @RequestParam("instituteId") String instituteId,
                                         @RequestParam("folderId") String folderId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.delete(instituteId, folderId));
    }

    @PostMapping("/reorder")
    public ResponseEntity<String> reorder(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                          @RequestParam("instituteId") String instituteId,
                                          @RequestBody ReorderFoldersRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.reorder(instituteId, request));
    }

    @PostMapping("/move-assessments")
    public ResponseEntity<String> move(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                       @RequestParam("instituteId") String instituteId,
                                       @RequestBody MoveAssessmentsRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.move(instituteId, request));
    }

    /** Which folder each of the given assessments is in (for the folder chip on admin cards). */
    @PostMapping("/by-assessments")
    public ResponseEntity<List<AssessmentFolderLinkDto>> byAssessments(@RequestAttribute("user") CustomUserDetails user,
                                                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                                                       @RequestParam("instituteId") String instituteId,
                                                                       @RequestBody List<String> assessmentIds) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.foldersForAssessments(instituteId, assessmentIds));
    }

    @PostMapping("/learner/list")
    public ResponseEntity<LearnerFolderListResponse> learnerList(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody LearnerFolderListRequest request) {
        accessGuard.requireMember(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.listForLearner(instituteId, request));
    }
}
