package vacademy.io.admin_core_service.features.telephony.controller;

import vacademy.io.admin_core_service.features.telephony.core.TtsModelPricingAnnotator;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentKnowledgeExtractor;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentTestCallService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentKnowledgeDocument;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Admin CRUD for the AI-agent registry (Vacademy AI personas). JWT-protected +
 * institute-membership validated (instituteId comes from the caller — without
 * the check any authenticated user could read/rewrite ANY institute's agents,
 * including their system prompts). The settings UI's "AI Agents" card and the
 * workflow builder's CALL_AI agent picker read/write here; saving auto-bridges
 * the agent into AI_CALLING_SETTING.campaigns (see AiAgentService).
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-agents")
@RequiredArgsConstructor
public class AiAgentController {

    private final AiAgentService aiAgentService;
    private final AiAgentKnowledgeExtractor knowledgeExtractor;
    private final AiAgentTestCallService testCallService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<List<AiAgentDTO>> list(@RequestParam("instituteId") String instituteId,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(aiAgentService.list(instituteId));
    }

    /** Create (id null) or update (id set). */
    @PostMapping
    public ResponseEntity<AiAgentDTO> save(@RequestBody AiAgentDTO dto,
                                           @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, dto.getInstituteId());
        return ResponseEntity.ok(aiAgentService.save(dto));
    }

    /**
     * Text of a document for the agent's reference documents. Stores nothing: the editor
     * adds the result to the agent and saving the agent stores it.
     */
    @PostMapping(value = "/knowledge/extract", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AiAgentKnowledgeDocument> extractKnowledge(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("file") MultipartFile file,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(knowledgeExtractor.extract(file));
    }

    public record TestCallBody(String instituteId, String phoneNumber, String name, String preferredNumberId) {}

    /**
     * The saved agent calls the number typed in the editor. A real call, billed like any
     * other; staff only, the same guard as a manual lead call.
     */
    @PostMapping("/{agentId}/test-call")
    public ResponseEntity<AiCallResponseDTO> testCall(@PathVariable("agentId") String agentId,
                                                      @RequestBody TestCallBody body,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = body == null ? null : body.instituteId();
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(testCallService.place(instituteId, agentId,
                new AiAgentTestCallService.TestCallInput(body.phoneNumber(), body.name(), body.preferredNumberId()),
                user == null ? null : user.getUserId()));
    }

    @DeleteMapping("/{agentId}")
    public ResponseEntity<Void> delete(@PathVariable("agentId") String agentId,
                                       @RequestParam("instituteId") String instituteId,
                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        aiAgentService.delete(agentId, instituteId);
        return ResponseEntity.noContent().build();
    }

    /**
     * Voices for the dropdown + tester, model-tagged so the picker can show only
     * the palette that belongs to the selected engine. Served from
     * {@link TtsVoiceCatalog} — previously three hand-maintained copies that drifted.
     * Not institute-scoped (no access check needed).
     */
    @GetMapping("/voices")
    public ResponseEntity<List<Map<String, String>>> voices() {
        return ResponseEntity.ok(TtsVoiceCatalog.all());
    }

    @Autowired
    private TtsModelPricingAnnotator ttsModelPricing;

    /**
     * Engines we sell — label, default, voice list, and what a MINUTE ON THIS
     * ENGINE ACTUALLY COSTS the institute in credits. The surcharge alone was
     * never the interesting number; see {@link TtsModelPricingAnnotator}.
     */
    @GetMapping("/tts-models")
    public ResponseEntity<List<Map<String, Object>>> ttsModels() {
        return ResponseEntity.ok(ttsModelPricing.annotate(TtsVoiceCatalog.models()));
    }
}
