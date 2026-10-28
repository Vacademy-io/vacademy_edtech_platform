package vacademy.io.admin_core_service.features.engagement.templates;

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
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/** Engine email templates: list, AI-generate, edit, approve, archive, preview. Institute admins only. */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/email-templates")
@RequiredArgsConstructor
public class EngagementEmailTemplateController {

    private final EngagementEmailTemplateService service;
    private final EngagementAccessGuard accessGuard;

    @GetMapping
    public ResponseEntity<List<EngagementEmailTemplateService.View>> list(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.list(engineId, instituteId));
    }

    /** Generate with AI. mode NEW (default), REGENERATE (replace a draft) or MORE_LIKE_THIS (basedOnId). */
    @PostMapping("/generate")
    public ResponseEntity<List<EngagementEmailTemplateService.View>> generate(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestBody(required = false) EngagementEmailTemplateService.GenerateRequest req,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.generate(engineId, instituteId, req, user.getUserId()));
    }

    @PutMapping("/{id}")
    public ResponseEntity<EngagementEmailTemplateService.View> edit(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestBody EngagementEmailTemplateService.EditRequest req,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.edit(id, instituteId, req, user.getUserId()));
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<EngagementEmailTemplateService.View> approve(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.approve(id, instituteId, user.getUserId()));
    }

    @PostMapping("/{id}/archive")
    public ResponseEntity<EngagementEmailTemplateService.View> archive(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.archive(id, instituteId));
    }

    /** Render with sample values (or the given ones) — exactly what a send would produce. */
    @PostMapping("/{id}/preview")
    public ResponseEntity<EngagementEmailTemplateService.Preview> preview(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestBody(required = false) Map<String, String> values,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.preview(id, instituteId, values));
    }
}
