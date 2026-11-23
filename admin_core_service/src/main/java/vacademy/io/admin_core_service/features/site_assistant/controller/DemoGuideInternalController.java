package vacademy.io.admin_core_service.features.site_assistant.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantLeadService;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Service-to-service endpoint the demo guide (ai_service app/demo_guide, docs/demo-stage/SPEC.md 2.2)
 * calls when a visitor of the public product demo leaves contact details.
 *
 * <p>It sits beside the Site Assistant's {@code /internal/site-assistant/v1/leads} and runs the same
 * pipeline ({@link SiteAssistantLeadService}: campaign_id when it is an ACTIVE audience of the
 * institute, institute dedup, scoring, counsellor assignment, UTM touch). The only difference is the
 * lead's {@code source_type}: {@code DEMO_GUIDE}, with {@code source_id} = the demo session id
 * ({@code custom_fields.conversation_id}). The Site Assistant route always writes
 * {@code SITE_ASSISTANT}, which is why the guide has its own.
 *
 * <p>Guarded like every internal route: the path has an exact {@code internal} segment
 * ({@code InternalAuthFilter}, HMAC {@code clientName} + {@code Signature}) and
 * {@code /admin-core-service/internal/**} is an authenticated matcher in ApplicationSecurityConfig,
 * so a user JWT or an anonymous call never reaches it. Same body, answer and error envelope as the
 * Site Assistant route ({@link SiteAssistantErrorAdvice}).
 */
@RestController
@RequestMapping("/admin-core-service/internal/demo-guide/v1")
@RequiredArgsConstructor
public class DemoGuideInternalController {

    public static final String SOURCE_TYPE = "DEMO_GUIDE";

    private final SiteAssistantLeadService leads;

    @PostMapping("/leads")
    public ResponseEntity<Map<String, Object>> lead(@RequestBody(required = false) JsonNode body) {
        SiteAssistantLeadService.Outcome outcome =
                leads.submit(SiteAssistantLeadService.validate(body), SOURCE_TYPE);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", outcome.status());
        out.put("lead_ref", outcome.leadRef());
        return ResponseEntity.status("received".equals(outcome.status()) ? HttpStatus.CREATED : HttpStatus.OK)
                .header("Cache-Control", "no-store")
                .body(out);
    }
}
