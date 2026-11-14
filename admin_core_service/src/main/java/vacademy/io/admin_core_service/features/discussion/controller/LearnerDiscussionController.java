package vacademy.io.admin_core_service.features.discussion.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionPostView;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionRequests;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionThreadView;
import vacademy.io.admin_core_service.features.discussion.service.DiscussionService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** Discussion slides for the signed-in learner. The learner is always the token holder. */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/discussion/learner/v1")
@RequiredArgsConstructor
public class LearnerDiscussionController {

    private final DiscussionService service;
    private final LearnerTrackingService learnerTrackingService;

    @GetMapping("/thread")
    public ResponseEntity<DiscussionThreadView> thread(@RequestParam("slideId") String slideId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "chapterId", required = false) String chapterId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.learnerThread(user, slideId, packageSessionId, chapterId, clientId));
    }

    @PostMapping("/posts")
    public ResponseEntity<DiscussionPostView> create(@RequestBody DiscussionRequests.CreatePost request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        DiscussionService.Created created = service.createAsLearner(user, request, clientId);
        if (created.firstResponse()) {
            // Responding is what completes a discussion. Done after the post has committed,
            // and never allowed to fail the post itself.
            try {
                learnerTrackingService.markSlideCompletion(request.getSlideId(), "DOCUMENT",
                        created.chapterId(), request.getModuleId(), request.getSubjectId(),
                        created.packageSessionId(), true, user);
            } catch (RuntimeException e) {
                log.warn("[discussion] could not mark slide {} complete for {}: {}", request.getSlideId(),
                        user.getUserId(), e.getMessage());
            }
        }
        return ResponseEntity.ok(created.post());
    }

    @PutMapping("/posts/{postId}")
    public ResponseEntity<DiscussionPostView> edit(@PathVariable("postId") String postId,
            @RequestBody DiscussionRequests.EditPost request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.editAsLearner(user, postId, request, clientId));
    }

    @DeleteMapping("/posts/{postId}")
    public ResponseEntity<Boolean> delete(@PathVariable("postId") String postId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        service.deleteAsLearner(user, postId, clientId);
        return ResponseEntity.ok(true);
    }

    @PostMapping("/posts/{postId}/reactions")
    public ResponseEntity<List<DiscussionPostView.ReactionCount>> react(@PathVariable("postId") String postId,
            @RequestBody DiscussionRequests.React request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.react(user, postId, request, clientId, null));
    }

    @PostMapping("/posts/{postId}/report")
    public ResponseEntity<Boolean> report(@PathVariable("postId") String postId,
            @RequestBody(required = false) DiscussionRequests.Report request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        service.report(user, postId, request, clientId);
        return ResponseEntity.ok(true);
    }
}
