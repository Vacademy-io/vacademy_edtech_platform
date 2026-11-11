package vacademy.io.assessment_service.features.question_library.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment_folder.service.AssessmentFolderAccessGuard;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_library.dto.*;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryAccess;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryCopyService;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryCurationService;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryEditService;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryImportService;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_SIZE;

/**
 * Question Library: the questions and papers the platform provides, organised by topic.
 * <p>
 * Every call is staff-only and pinned to the caller's active institute (the clientId
 * header), with the same guard as assessment folders. Every other institute reads and copies
 * only the topics the owner gave it (see QuestionLibraryScope). Everything that changes the
 * library, including who is given what, is limited to its owner institute.
 */
@RestController
@RequestMapping("/assessment-service/question-library/v1")
public class QuestionLibraryController {

    @Autowired
    private QuestionLibraryService libraryService;

    @Autowired
    private QuestionLibraryEditService editService;

    @Autowired
    private QuestionLibraryCopyService copyService;

    @Autowired
    private QuestionLibraryCurationService curationService;

    @Autowired
    private QuestionLibraryImportService importService;

    @Autowired
    private QuestionLibraryAccess libraryAccess;

    @Autowired
    private AssessmentFolderAccessGuard accessGuard;

    private void requireManager(CustomUserDetails user, String clientId, String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        libraryAccess.requireOwner(instituteId);
    }

    @GetMapping("/tree")
    public ResponseEntity<LibraryTreeResponse> tree(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                    @RequestParam("instituteId") String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.getTree(instituteId));
    }

    @PostMapping("/nodes")
    public ResponseEntity<LibraryNodeDto> createNode(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestHeader(value = "clientId", required = false) String clientId,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestBody LibraryNodeRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.createNode(user, instituteId, request));
    }

    @PutMapping("/nodes")
    public ResponseEntity<String> updateNode(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                             @RequestParam("instituteId") String instituteId,
                                             @RequestParam("nodeId") String nodeId,
                                             @RequestBody LibraryNodeRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.updateNode(instituteId, nodeId, request));
    }

    @PostMapping("/nodes/move")
    public ResponseEntity<String> moveNode(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestHeader(value = "clientId", required = false) String clientId,
                                           @RequestParam("instituteId") String instituteId,
                                           @RequestBody MoveLibraryNodeRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.moveNode(instituteId, request));
    }

    @PostMapping("/nodes/reorder")
    public ResponseEntity<String> reorderNodes(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestBody ReorderLibraryNodesRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.reorderNodes(instituteId, request));
    }

    @DeleteMapping("/nodes")
    public ResponseEntity<LibraryActionResponse> deleteNode(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestHeader(value = "clientId", required = false) String clientId,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestParam("nodeId") String nodeId) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.deleteNode(instituteId, nodeId));
    }

    @PostMapping("/questions/filter")
    public ResponseEntity<Page<LibraryQuestionDto>> listQuestions(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) QuestionBankFilter filter,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.listQuestions(user, instituteId, filter, pageNo, Math.min(Math.max(pageSize, 1), 100)));
    }

    @PostMapping("/questions/assign")
    public ResponseEntity<LibraryActionResponse> assignQuestions(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody AssignLibraryQuestionsRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.assignQuestions(instituteId, request));
    }

    @PostMapping("/questions/remove")
    public ResponseEntity<LibraryActionResponse> removeQuestions(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody RemoveLibraryQuestionsRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.removeQuestions(instituteId, request));
    }

    /** Edit one question. Saved as a new version when an assessment already uses it. */
    @PostMapping("/questions/edit")
    public ResponseEntity<LibraryQuestionEditResponse> editQuestion(@RequestAttribute("user") CustomUserDetails user,
                                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                                    @RequestParam("instituteId") String instituteId,
                                                                    @RequestBody QuestionDTO question) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(editService.edit(user, instituteId, question));
    }

    @PostMapping("/papers/add-to-node")
    public ResponseEntity<LibraryActionResponse> addPaperToNode(@RequestAttribute("user") CustomUserDetails user,
                                                                @RequestHeader(value = "clientId", required = false) String clientId,
                                                                @RequestParam("instituteId") String instituteId,
                                                                @RequestBody AddPaperToLibraryNodeRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.addPaperToNode(instituteId, request));
    }

    @PostMapping("/papers/remove")
    public ResponseEntity<LibraryActionResponse> removePaper(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestBody AddPaperToLibraryNodeRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.removePaperFromNode(instituteId, request));
    }

    /** Whole papers on a topic and the topics below it, or on the whole library. */
    @GetMapping("/papers")
    public ResponseEntity<List<LibraryPaperDto>> papers(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @RequestParam(value = "nodeId", required = false) String nodeId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.listPapers(instituteId, nodeId));
    }

    /** Copies the picked questions, or a whole paper, into the caller's institute for one test. */
    @PostMapping("/questions/copy")
    public ResponseEntity<LibraryCopyResponse> copyQuestions(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestBody CopyLibraryQuestionsRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(copyService.copy(instituteId, request));
    }

    /** Random questions per difficulty. Reads only; adding them goes through /questions/copy. */
    @PostMapping("/questions/random-pick")
    public ResponseEntity<LibraryRandomPickResponse> randomPick(@RequestAttribute("user") CustomUserDetails user,
                                                                @RequestHeader(value = "clientId", required = false) String clientId,
                                                                @RequestParam("instituteId") String instituteId,
                                                                @RequestBody(required = false) LibraryRandomPickRequest request) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.randomPick(instituteId, request));
    }

    /** The caller's own copy, for editing it before its test has been saved. */
    @GetMapping("/copies")
    public ResponseEntity<QuestionDTO> getCopy(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestParam("questionId") String questionId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(copyService.getCopy(instituteId, questionId));
    }

    /** Edits the caller's own copy. Only copies pass: the library itself cannot be reached here. */
    @PostMapping("/copies/edit")
    public ResponseEntity<Boolean> editCopy(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestHeader(value = "clientId", required = false) String clientId,
                                            @RequestParam("instituteId") String instituteId,
                                            @RequestBody QuestionDTO question) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(copyService.editCopy(instituteId, question));
    }

    @GetMapping("/subject-tags")
    public ResponseEntity<List<LibrarySubjectTagDto>> subjectTags(@RequestAttribute("user") CustomUserDetails user,
                                                                  @RequestHeader(value = "clientId", required = false) String clientId,
                                                                  @RequestParam("instituteId") String instituteId) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.listSubjectTags(instituteId));
    }

    @PostMapping("/subject-tags/import")
    public ResponseEntity<LibraryActionResponse> importSubjectTags(@RequestAttribute("user") CustomUserDetails user,
                                                                   @RequestHeader(value = "clientId", required = false) String clientId,
                                                                   @RequestParam("instituteId") String instituteId,
                                                                   @RequestBody ImportLibraryTagsRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(libraryService.importSubjectTags(user, instituteId, request));
    }

    // ---------------------------------------------------------------- tags, difficulty, access

    /** Concept, past-paper and source tags in use, scoped to what the caller sees. */
    @GetMapping("/tags")
    public ResponseEntity<List<LibraryTagDto>> tags(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @RequestParam(value = "nodeId", required = false) String nodeId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.listTags(instituteId, nodeId));
    }

    @PostMapping("/tags/add")
    public ResponseEntity<LibraryActionResponse> addTag(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @RequestBody LibraryTagRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.addTag(instituteId, request));
    }

    @PostMapping("/tags/remove")
    public ResponseEntity<LibraryActionResponse> removeTag(@RequestAttribute("user") CustomUserDetails user,
                                                           @RequestHeader(value = "clientId", required = false) String clientId,
                                                           @RequestParam("instituteId") String instituteId,
                                                           @RequestBody LibraryTagRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.removeTag(instituteId, request));
    }

    /** New questions (Word upload, AI, hand-written, Excel rows) saved straight into topics. */
    @PostMapping("/questions/import")
    public ResponseEntity<LibraryImportResponse> importQuestions(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody LibraryImportRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(importService.importQuestions(user, instituteId, request));
    }

    @PostMapping("/questions/difficulty")
    public ResponseEntity<LibraryActionResponse> setDifficulty(@RequestAttribute("user") CustomUserDetails user,
                                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                                               @RequestParam("instituteId") String instituteId,
                                                               @RequestBody LibraryDifficultyRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.setDifficulty(instituteId, request));
    }

    /** Institutes given one topic. */
    @GetMapping("/access")
    public ResponseEntity<List<LibraryAccessDto>> listAccess(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestParam("nodeId") String nodeId) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.listAccess(instituteId, nodeId));
    }

    /** Gives a topic, with everything below it, to another institute (by its id). */
    @PostMapping("/access")
    public ResponseEntity<LibraryAccessDto> grantAccess(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @RequestBody LibraryAccessRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.grant(user, instituteId, request));
    }

    @PostMapping("/access/remove")
    public ResponseEntity<LibraryActionResponse> revokeAccess(@RequestAttribute("user") CustomUserDetails user,
                                                              @RequestHeader(value = "clientId", required = false) String clientId,
                                                              @RequestParam("instituteId") String instituteId,
                                                              @RequestBody LibraryAccessRequest request) {
        requireManager(user, clientId, instituteId);
        return ResponseEntity.ok(curationService.revoke(instituteId, request));
    }
}
