package vacademy.io.admin_core_service.features.learner_home.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeAnalyticsService;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeLayoutService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;

/**
 * Learner home editor API. Institute ADMIN only, with no root-user bypass. While the
 * {@code learner_home} module is off every endpoint except GET /draft answers 403 MODULE_OFF.
 */
@RestController
@RequestMapping("/admin-core-service/v1/learner-home/admin")
public class LearnerHomeAdminController {

    private final InstituteAccessValidator accessValidator;
    private final LearnerHomeGate gate;
    private final LearnerHomeLayoutService layoutService;
    private final LearnerHomeAnalyticsService analyticsService;

    public LearnerHomeAdminController(InstituteAccessValidator accessValidator, LearnerHomeGate gate,
                                      LearnerHomeLayoutService layoutService,
                                      LearnerHomeAnalyticsService analyticsService) {
        this.accessValidator = accessValidator;
        this.gate = gate;
        this.layoutService = layoutService;
        this.analyticsService = analyticsService;
    }

    /** ADMIN of this institute, then the module switch. */
    void admin(CustomUserDetails user, String instituteId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        if (!gate.moduleEnabled(instituteId)) {
            throw new LearnerHomeException(HttpStatus.FORBIDDEN, "MODULE_OFF", "Learner home is not enabled for this institute");
        }
    }

    /** Starting or publishing a layout is refused for an institute whose home is hard-coded. */
    void notHolistic(String instituteId) {
        if (gate.isHolistic(instituteId)) {
            throw new LearnerHomeException(HttpStatus.CONFLICT, "HOLISTIC_LAYOUT",
                    "This institute's learner home is fixed and cannot be built here");
        }
    }

    @GetMapping("/draft")
    public ResponseEntity<ObjectNode> getDraft(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam String instituteId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(layoutService.draftView(instituteId, gate.moduleEnabled(instituteId),
                gate.isHolistic(instituteId)));
    }

    @PostMapping("/draft")
    public ResponseEntity<ObjectNode> createDraft(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam String instituteId,
                                                  @RequestBody(required = false) String body) {
        admin(user, instituteId);
        notHolistic(instituteId);
        JsonNode json = LearnerHomeLayoutService.readBody(body);
        return ResponseEntity.status(HttpStatus.CREATED).body(layoutService.createDraft(instituteId, user.getUserId(), json));
    }

    @PostMapping("/draft/from-published")
    public ResponseEntity<ObjectNode> createFromPublished(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestParam String instituteId) {
        admin(user, instituteId);
        notHolistic(instituteId);
        return ResponseEntity.status(HttpStatus.CREATED).body(layoutService.createFromPublished(instituteId, user.getUserId()));
    }

    @PutMapping("/draft")
    public ResponseEntity<ObjectNode> saveDraft(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam String instituteId,
                                                @RequestBody(required = false) String body) {
        admin(user, instituteId);
        JsonNode json = LearnerHomeLayoutService.readBody(body);
        return ResponseEntity.ok(layoutService.saveDraft(instituteId, user.getUserId(), json));
    }

    @DeleteMapping("/draft")
    public ResponseEntity<Void> deleteDraft(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestParam String instituteId) {
        admin(user, instituteId);
        layoutService.deleteDraft(instituteId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/publish-checks")
    public ResponseEntity<ObjectNode> publishChecks(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam String instituteId) {
        admin(user, instituteId);
        return ResponseEntity.ok(layoutService.publishChecks(instituteId));
    }

    @PostMapping("/publish")
    public ResponseEntity<ObjectNode> publish(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestParam String instituteId,
                                              @RequestBody(required = false) String body) {
        admin(user, instituteId);
        notHolistic(instituteId);
        JsonNode json = LearnerHomeLayoutService.readBody(body);
        JsonNode rev = json.get("revision");
        if (rev == null || !rev.isIntegralNumber()) {
            throw new LearnerHomeException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "revision is required");
        }
        return ResponseEntity.ok(layoutService.publish(instituteId, user.getUserId(), rev.asInt()));
    }

    @PostMapping("/unpublish")
    public ResponseEntity<Void> unpublish(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestParam String instituteId) {
        admin(user, instituteId);
        layoutService.unpublish(instituteId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/versions")
    public ResponseEntity<ObjectNode> versions(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam String instituteId) {
        admin(user, instituteId);
        return ResponseEntity.ok(layoutService.versions(instituteId));
    }

    @PostMapping("/versions/{version}/restore")
    public ResponseEntity<ObjectNode> restore(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestParam String instituteId,
                                              @PathVariable("version") int version,
                                              @RequestParam(defaultValue = "false") boolean force) {
        admin(user, instituteId);
        notHolistic(instituteId);
        return ResponseEntity.ok(layoutService.restore(instituteId, user.getUserId(), version, force));
    }

    @PostMapping("/preview")
    public ResponseEntity<ObjectNode> preview(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestParam String instituteId,
                                              @RequestBody(required = false) String body) {
        admin(user, instituteId);
        return ResponseEntity.ok(layoutService.preview(instituteId, LearnerHomeLayoutService.readBody(body)));
    }

    @GetMapping("/analytics")
    public ResponseEntity<ObjectNode> analytics(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam String instituteId,
                                                @RequestParam String from,
                                                @RequestParam String to) {
        admin(user, instituteId);
        LocalDate fromDay;
        LocalDate toDay;
        try {
            fromDay = LocalDate.parse(from);
            toDay = LocalDate.parse(to);
        } catch (DateTimeParseException e) {
            throw new LearnerHomeException(HttpStatus.BAD_REQUEST, "BAD_RANGE", "from and to must be dates (yyyy-MM-dd)");
        }
        return ResponseEntity.ok(analyticsService.summary(instituteId, fromDay, toDay));
    }

    @GetMapping("/acks")
    public ResponseEntity<ObjectNode> acks(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam String instituteId,
                                           @RequestParam("block_key") String blockKey,
                                           @RequestParam(defaultValue = "0") int page,
                                           @RequestParam(defaultValue = "50") int size) {
        admin(user, instituteId);
        return ResponseEntity.ok(analyticsService.acks(instituteId, blockKey, page, size));
    }

    @ExceptionHandler(LearnerHomeException.class)
    public ResponseEntity<Map<String, Object>> handle(LearnerHomeException e) {
        return ResponseEntity.status(e.getStatus()).body(e.body());
    }
}
