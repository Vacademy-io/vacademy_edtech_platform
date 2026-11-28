package vacademy.io.assessment_service.features.question_paper_folder.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment_folder.service.AssessmentFolderAccessGuard;
import vacademy.io.assessment_service.features.question_paper_folder.dto.*;
import vacademy.io.assessment_service.features.question_paper_folder.service.QuestionPaperFolderService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Folders of the Question Banks and Papers page. Staff only, with the same rule as the
 * assessment folders: instituteId must be the caller's active institute (clientId header)
 * and a learner-only role is refused.
 */
@RestController
@RequestMapping("/assessment-service/question-paper/folder/v1")
public class QuestionPaperFolderController {

    @Autowired
    private QuestionPaperFolderService folderService;

    @Autowired
    private AssessmentFolderAccessGuard accessGuard;

    @GetMapping("/list")
    public ResponseEntity<List<QuestionPaperFolderDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.list(instituteId));
    }

    @PostMapping("/create")
    public ResponseEntity<QuestionPaperFolderDto> create(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestHeader(value = "clientId", required = false) String clientId,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestBody QuestionPaperFolderRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.create(user, instituteId, request));
    }

    @PutMapping("/update")
    public ResponseEntity<QuestionPaperFolderDto> update(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestHeader(value = "clientId", required = false) String clientId,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestParam("folderId") String folderId,
                                                         @RequestBody QuestionPaperFolderRequest request) {
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
                                          @RequestBody ReorderQuestionPaperFoldersRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.reorder(instituteId, request));
    }

    @PostMapping("/move-papers")
    public ResponseEntity<String> move(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                       @RequestParam("instituteId") String instituteId,
                                       @RequestBody MoveQuestionPapersRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.move(instituteId, request));
    }

    /** Which folder each of the given papers is in (for the folder chip on paper cards). */
    @PostMapping("/by-papers")
    public ResponseEntity<List<QuestionPaperFolderLinkDto>> byPapers(@RequestAttribute("user") CustomUserDetails user,
                                                                     @RequestHeader(value = "clientId", required = false) String clientId,
                                                                     @RequestParam("instituteId") String instituteId,
                                                                     @RequestBody List<String> questionPaperIds) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(folderService.foldersForPapers(instituteId, questionPaperIds));
    }
}
