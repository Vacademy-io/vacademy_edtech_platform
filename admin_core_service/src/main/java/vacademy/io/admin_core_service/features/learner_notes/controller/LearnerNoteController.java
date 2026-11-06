package vacademy.io.admin_core_service.features.learner_notes.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner_notes.dto.LearnerNoteDTO;
import vacademy.io.admin_core_service.features.learner_notes.dto.NotebookPageDTO;
import vacademy.io.admin_core_service.features.learner_notes.dto.ReviewResultDTO;
import vacademy.io.admin_core_service.features.learner_notes.service.LearnerNoteService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/** A learner's own notebook. The user always comes from the token. */
@RestController
@RequestMapping("/admin-core-service/learner-notes/v1")
public class LearnerNoteController {

    private final LearnerNoteService service;

    public LearnerNoteController(LearnerNoteService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<LearnerNoteDTO>> forSlide(
            @RequestParam("slide_id") String slideId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.forSlide(user.getUserId(), slideId));
    }

    @GetMapping("/notebook")
    public ResponseEntity<NotebookPageDTO> notebook(
            @RequestParam("institute_id") String instituteId,
            @RequestParam(value = "kind", required = false) String kind,
            @RequestParam(value = "q", required = false) String query,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.notebook(user.getUserId(), instituteId, kind, query, page, size));
    }

    @GetMapping("/review/due")
    public ResponseEntity<List<LearnerNoteDTO>> due(
            @RequestParam("institute_id") String instituteId,
            @RequestParam(value = "limit", defaultValue = "20") int limit,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.due(user.getUserId(), instituteId, limit));
    }

    @GetMapping("/review/count")
    public ResponseEntity<Map<String, Long>> dueCount(
            @RequestParam("institute_id") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(Map.of("due", service.dueCount(user.getUserId(), instituteId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<LearnerNoteDTO> save(
            @PathVariable String id,
            @RequestBody LearnerNoteDTO body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.save(user.getUserId(), id, body));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable String id,
            @RequestAttribute("user") CustomUserDetails user) {
        service.delete(user.getUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/review")
    public ResponseEntity<LearnerNoteDTO> review(
            @PathVariable String id,
            @RequestBody ReviewResultDTO body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.recordReview(user.getUserId(), id, body.isRemembered()));
    }
}
