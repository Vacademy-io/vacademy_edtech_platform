package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentAssistService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * LLM-assisted agent authoring (see {@link AiAgentAssistService}): draft a prompt
 * from a brief, score/critique a prompt, apply selected suggestions, revise from
 * post-call feedback (grounded in the agent's real recent calls), regenerate from the
 * admin's notes. Each operation charges a flat 1 AI credit on success. JWT +
 * institute-membership validated — the feedback path reads that institute's call
 * transcripts. {@code POST /jobs} runs any operation in the background (a long prompt
 * on a reasoning model outlives an HTTP request); {@code GET /jobs/{id}} polls it.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-agents/assist")
@RequiredArgsConstructor
public class AiAgentAssistController {

    private final AiAgentAssistService assistService;
    private final InstituteAccessValidator instituteAccessValidator;

    @Data
    public static class AssistRequest {
        private String instituteId;
        /** draft: the plain-language description of the agent. */
        private String brief;
        /** analyze/improve/feedback: the current system prompt. */
        private String prompt;
        /** Agent language (all operations). */
        private String language;
        /** Agent display name, current opening line, use-case brief (all operations; optional). */
        private String agentName;
        private String openingLine;
        private String useCase;
        /** Current questions-to-find-out and outcome labels, so a rewrite returns a matching set. */
        private List<String> extractionQuestions;
        private List<String> dispositions;
        /** regenerate: the admin's free-form notes. */
        private String notes;
        /** jobs: which operation to run (draft|analyze|improve|feedback|regenerate). */
        private String operation;
        /** improve: the suggestion "addition" texts the admin chose to apply. */
        private List<String> additions;
        /** feedback: the admin's post-call feedback. */
        private String feedback;
        /** feedback: agent id — pulls that agent's recent real calls as grounding. */
        private String agentId;
    }

    @PostMapping("/draft")
    public ResponseEntity<Map<String, Object>> draft(@RequestBody AssistRequest req,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        return ResponseEntity.ok(assistService.draft(req.getInstituteId(), req.getBrief(), ctx(req)));
    }

    @PostMapping("/analyze")
    public ResponseEntity<Map<String, Object>> analyze(@RequestBody AssistRequest req,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        return ResponseEntity.ok(assistService.analyze(req.getInstituteId(), req.getPrompt(), ctx(req)));
    }

    @PostMapping("/improve")
    public ResponseEntity<Map<String, Object>> improve(@RequestBody AssistRequest req,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        return ResponseEntity.ok(assistService.improve(req.getInstituteId(), req.getPrompt(), req.getAdditions(), ctx(req)));
    }

    @PostMapping("/feedback")
    public ResponseEntity<Map<String, Object>> feedback(@RequestBody AssistRequest req,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        return ResponseEntity.ok(assistService.feedbackRevise(
                req.getInstituteId(), req.getAgentId(), req.getPrompt(), req.getFeedback(), ctx(req)));
    }

    @PostMapping("/regenerate")
    public ResponseEntity<Map<String, Object>> regenerate(@RequestBody AssistRequest req,
                                                          @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        return ResponseEntity.ok(assistService.regenerate(
                req.getInstituteId(), req.getAgentId(), req.getPrompt(), req.getNotes(), ctx(req)));
    }

    @PostMapping("/jobs")
    public ResponseEntity<Map<String, Object>> startJob(@RequestBody AssistRequest req,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        String op = req.getOperation() == null ? "" : req.getOperation().trim().toLowerCase();
        AiAgentAssistService.AgentContext agent = ctx(req);
        String iid = req.getInstituteId();
        return ResponseEntity.ok(assistService.startJob(iid, req.getAgentId(), op, () -> switch (op) {
            case "draft" -> assistService.draft(iid, req.getBrief(), agent);
            case "analyze" -> assistService.analyze(iid, req.getPrompt(), agent);
            case "improve" -> assistService.improve(iid, req.getPrompt(), req.getAdditions(), agent);
            case "feedback" -> assistService.feedbackRevise(iid, req.getAgentId(), req.getPrompt(),
                    req.getFeedback(), agent);
            default -> assistService.regenerate(iid, req.getAgentId(), req.getPrompt(), req.getNotes(), agent);
        }));
    }

    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<Map<String, Object>> getJob(@PathVariable String jobId,
                                                      @RequestParam String instituteId,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(assistService.getJob(instituteId, jobId));
    }

    private static AiAgentAssistService.AgentContext ctx(AssistRequest req) {
        return new AiAgentAssistService.AgentContext(
                req.getAgentName(), req.getLanguage(), req.getOpeningLine(), req.getUseCase(),
                req.getExtractionQuestions(), req.getDispositions());
    }
}
