package vacademy.io.admin_core_service.features.discussion.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionPostView;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionRequests;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionThreadView;
import vacademy.io.admin_core_service.features.discussion.service.DiscussionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Discussion slides for institute staff: read every response (including ones awaiting
 * approval, hidden or reported), reply as the teacher, and moderate. Staff of the
 * institute only, with no root-user bypass; the slide must be in one of its courses.
 */
@RestController
@RequestMapping("/admin-core-service/discussion/admin/v1")
@RequiredArgsConstructor
public class AdminDiscussionController {

    private final DiscussionService service;

    @GetMapping("/thread")
    public ResponseEntity<DiscussionThreadView> thread(@RequestParam("slideId") String slideId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.staffThread(user, slideId, instituteId, packageSessionId));
    }

    @PostMapping("/posts")
    public ResponseEntity<DiscussionPostView> create(@RequestParam("instituteId") String instituteId,
            @RequestBody DiscussionRequests.CreatePost request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.createAsStaff(user, instituteId, request));
    }

    @PutMapping("/posts/{postId}")
    public ResponseEntity<DiscussionPostView> edit(@PathVariable("postId") String postId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody DiscussionRequests.EditPost request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.editAsStaff(user, instituteId, postId, request));
    }

    @PostMapping("/posts/{postId}/moderate")
    public ResponseEntity<DiscussionPostView> moderate(@PathVariable("postId") String postId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody DiscussionRequests.Moderate request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.moderate(user, instituteId, postId, request));
    }

    @PostMapping("/posts/{postId}/reactions")
    public ResponseEntity<List<DiscussionPostView.ReactionCount>> react(@PathVariable("postId") String postId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody DiscussionRequests.React request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.react(user, postId, request, null, instituteId));
    }
}
