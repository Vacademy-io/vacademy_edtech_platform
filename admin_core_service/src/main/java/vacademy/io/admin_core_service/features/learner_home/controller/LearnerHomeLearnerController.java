package vacademy.io.admin_core_service.features.learner_home.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeEventService;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Learner side of the home builder. The learner is always the token's user; the institute must be
 * the one the token was minted for (clientId), with no root-user bypass.
 */
@RestController
@RequestMapping("/admin-core-service/learner/home/v1")
public class LearnerHomeLearnerController {

    private final InstituteAccessValidator accessValidator;
    private final LearnerHomeResolver resolver;
    private final LearnerHomeEventService eventService;

    public LearnerHomeLearnerController(InstituteAccessValidator accessValidator, LearnerHomeResolver resolver,
                                        LearnerHomeEventService eventService) {
        this.accessValidator = accessValidator;
        this.resolver = resolver;
        this.eventService = eventService;
    }

    @GetMapping("/resolved")
    public ResponseEntity<ObjectNode> resolved(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam String instituteId) {
        accessValidator.requireInstituteMember(user, instituteId);
        // Personalised: never cached by a CDN or shared cache.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore().cachePrivate())
                .body(resolver.resolve(instituteId, user.getUserId()));
    }

    @PostMapping("/events")
    public ResponseEntity<Void> events(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestParam String instituteId,
                                       @RequestBody(required = false) JsonNode body) {
        accessValidator.requireInstituteMember(user, instituteId);
        eventService.record(instituteId, user.getUserId(), body);
        // 204 whatever was kept: the client never retries analytics.
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/blocks/{blockKey}/dismiss")
    public ResponseEntity<Void> dismiss(@RequestAttribute("user") CustomUserDetails user,
                                        @RequestParam String instituteId,
                                        @PathVariable("blockKey") String blockKey) {
        accessValidator.requireInstituteMember(user, instituteId);
        eventService.dismiss(instituteId, user.getUserId(), blockKey);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/blocks/{blockKey}/ack")
    public ResponseEntity<Void> acknowledge(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestParam String instituteId,
                                            @PathVariable("blockKey") String blockKey) {
        accessValidator.requireInstituteMember(user, instituteId);
        eventService.acknowledge(instituteId, user.getUserId(), blockKey);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(LearnerHomeException.class)
    public ResponseEntity<Map<String, Object>> handle(LearnerHomeException e) {
        return ResponseEntity.status(e.getStatus()).body(e.body());
    }
}
