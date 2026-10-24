package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateAlternativesRequest;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The D8 template-negotiation state machine (design §9): AI proposes → human edits/approves →
 * Meta adjudicates → alternatives on rejection. {@code TEMPLATES_PENDING} on the engine gates
 * activation; the poll ({@link EngagementTemplateSyncJob}) is the only status source (Meta sends
 * no template-status webhook to this system).
 *
 * The submit path is deliberately NOT wrapped in one big @Transactional: it makes cross-service
 * HTTP calls (create draft → submit to Meta) whose side effects can't be rolled back, so each
 * durable step commits on its own and a mid-flight failure rolls the proposal back to
 * USER_APPROVED (retryable) while keeping the notification_template FK so the retry updates rather
 * than re-creates.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementTemplateProposalService {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\d+)}}");
    // META_RECATEGORISED is NOT editable: Meta already APPROVED that template (under a different
    // category), and an approved template can't be edited-and-resubmitted to change its category —
    // notification_service's update() rejects any non-DRAFT/REJECTED row. The review action for a
    // recategorised template is accept-as-is (it's usable, counts toward the gate) or request
    // alternatives (a fresh template with a new name), never edit-in-place.
    private static final Set<String> EDITABLE = Set.of("AI_PROPOSED", "USER_REVIEW", "META_REJECTED");
    private static final Set<String> VALID_CATEGORIES = Set.of("MARKETING", "UTILITY", "AUTHENTICATION");
    private static final List<String> PENDING = List.of("SUBMITTED", "META_PENDING");

    private final EngagementTemplateProposalRepository proposalRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final EngagementTemplateAdvisor advisor;
    private final EngagementInternalClients clients;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ----- proposal generation -----

    /** AI proposes a first batch (round 1) for the engine. Moves a DRAFT WhatsApp engine to TEMPLATES_PENDING. */
    @Transactional
    public List<EngagementTemplateProposal> recommend(String engineId, String instituteId, String createdBy, Integer count) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        List<EngagementTemplateProposal> created = generate(engine, null, clampCount(count), createdBy);
        // Signal the wizard the engine is mid-negotiation — but NEVER pause a live engine (D8):
        // a prompt edit on an ACTIVE engine that needs a new template keeps running on approved ones.
        if ("DRAFT".equals(engine.getStatus()) && whatsAppEnabled(engine)) {
            engine.setStatus("TEMPLATES_PENDING");
            engineRepository.save(engine);
        }
        return created;
    }

    /** "Give me other options" — a fresh round, seeded with the human's steer / Meta's rejection. */
    @Transactional
    public List<EngagementTemplateProposal> requestAlternatives(String engineId, String instituteId,
                                                                TemplateAlternativesRequest req, String createdBy) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        String feedback = req != null ? req.getFeedback() : null;
        int count = clampCount(req != null ? req.getCount() : null);
        return generate(engine, feedback, count, createdBy);
    }

    private List<EngagementTemplateProposal> generate(EngagementEngine engine, String feedback, int count, String createdBy) {
        String compiled = activePrompt(engine);
        List<String> avoid = proposalRepository
                .findByEngineIdAndInstituteIdOrderByRoundDescCreatedAtDesc(engine.getId(), engine.getInstituteId())
                .stream().map(EngagementTemplateProposal::getName).filter(n -> n != null && !n.isBlank()).toList();

        List<EngagementTemplateAdvisor.Proposal> proposals =
                advisor.propose(engine, compiled, feedback, avoid, count);

        int round = proposalRepository.maxRound(engine.getId()) + 1;
        List<EngagementTemplateProposal> saved = new ArrayList<>();
        int dropped = 0;
        for (EngagementTemplateAdvisor.Proposal p : proposals) {
            String problem = alignmentProblem(p.body(), p.variableNames(), p.sampleValues(), p.category());
            if (problem != null) {
                dropped++;
                log.warn("Engine {}: dropped AI template proposal '{}' — {}", engine.getId(), p.name(), problem);
                continue;
            }
            EngagementTemplateProposal row = new EngagementTemplateProposal();
            row.setEngineId(engine.getId());
            row.setInstituteId(engine.getInstituteId());
            row.setName(metaName(p.name()));           // meta-legal + uniqueness-suffixed
            row.setLanguage(engine.getLanguage());
            row.setProposedBody(p.body());
            row.setProposedCategory(p.category().toUpperCase());
            row.setStatus("AI_PROPOSED");
            row.setRound(round);
            row.setVariableNames(writeJson(p.variableNames()));
            row.setSampleValues(writeJson(p.sampleValues()));
            row.setFooterText(trimFooter(p.footerText()));
            row.setRationale(p.rationale());
            row.setCreatedBy(createdBy);
            saved.add(proposalRepository.save(row));
        }
        if (saved.isEmpty()) {
            throw new VacademyException("The AI produced no Meta-valid template"
                    + (dropped > 0 ? " (" + dropped + " dropped for placeholder/sample mismatch)" : "")
                    + " — try again or refine the brief");
        }
        return saved;
    }

    // ----- human review -----

    public List<EngagementTemplateProposal> list(String engineId, String instituteId) {
        requireEngine(engineId, instituteId);
        return proposalRepository.findByEngineIdAndInstituteIdOrderByRoundDescCreatedAtDesc(engineId, instituteId);
    }

    /** Approved-and-usable templates for the engine (name + variables) — for the sender/brain to reference. */
    public List<EngagementTemplateProposal> approved(String engineId, String instituteId) {
        requireEngine(engineId, instituteId);
        return proposalRepository.findApproved(engineId, instituteId);
    }

    @Transactional
    public EngagementTemplateProposal edit(String id, String instituteId, TemplateEditRequest req, String editedBy) {
        EngagementTemplateProposal p = requireProposal(id, instituteId);
        if (!EDITABLE.contains(p.getStatus())) {
            throw new VacademyException("This template can't be edited in state " + p.getStatus());
        }
        if (req.getBody() != null) p.setProposedBody(req.getBody());
        if (req.getCategory() != null) {
            String c = req.getCategory().toUpperCase();
            if (!VALID_CATEGORIES.contains(c)) throw new VacademyException("category must be MARKETING|UTILITY|AUTHENTICATION");
            p.setProposedCategory(c);
        }
        if (req.getVariableNames() != null) p.setVariableNames(writeJson(req.getVariableNames()));
        if (req.getSampleValues() != null) p.setSampleValues(writeJson(req.getSampleValues()));
        if (req.getFooterText() != null) p.setFooterText(trimFooter(req.getFooterText()));

        // Re-validate AFTER applying edits so a human can't approve something Meta will reject.
        String problem = alignmentProblem(p.getProposedBody(), readJsonArray(p.getVariableNames()),
                readJsonArray(p.getSampleValues()), p.getProposedCategory());
        if (problem != null) throw new VacademyException("Template is not valid: " + problem);

        p.setStatus("USER_REVIEW");
        p.setRejectionReason(null);
        return proposalRepository.save(p);
    }

    public EngagementTemplateProposal approve(String id, String instituteId) {
        if (proposalRepository.approve(id, instituteId, Instant.now()) == 0) {
            throw new VacademyException("Template is not in an approvable state (must be proposed or under review)");
        }
        return requireProposal(id, instituteId);
    }

    @Transactional
    public EngagementTemplateProposal withdraw(String id, String instituteId) {
        if (proposalRepository.withdraw(id, instituteId, Instant.now()) == 0) {
            throw new VacademyException("Template can't be withdrawn in its current state");
        }
        return requireProposal(id, instituteId);
    }

    // ----- Meta submission (NOT @Transactional; see class doc) -----

    public EngagementTemplateProposal submit(String id, String instituteId, String actorId) {
        EngagementTemplateProposal pre = requireProposal(id, instituteId);
        if (!"USER_APPROVED".equals(pre.getStatus())) {
            throw new VacademyException("Approve the template before submitting it to Meta");
        }
        // Defensive re-validate — the row could have been edited then approved through another path.
        String problem = alignmentProblem(pre.getProposedBody(), readJsonArray(pre.getVariableNames()),
                readJsonArray(pre.getSampleValues()), pre.getProposedCategory());
        if (problem != null) throw new VacademyException("Template is not valid: " + problem);

        // Double-submit guard: USER_APPROVED → SUBMITTED, single winner.
        if (proposalRepository.claimForSubmit(id, instituteId, Instant.now()) == 0) {
            throw new VacademyException("Template is not approvable or is already being submitted");
        }
        EngagementTemplateProposal p = requireProposal(id, instituteId); // fresh: status == SUBMITTED

        try {
            Map<String, Object> dto = buildTemplateDto(p, actorId);
            String templateId = resolveOrCreateDraft(p, dto);   // idempotent: adopt orphan or create

            // The notification_template is the source of truth for what's actually at Meta. Read it
            // and branch on its REAL status — never blindly update() a row that's already past DRAFT,
            // which would 500 ("Can only edit DRAFT or REJECTED"). This is what recovers a submit
            // whose response was lost after Meta already accepted it.
            JsonNode cur = clients.getWhatsAppTemplate(templateId);
            String curStatus = cur.path("status").asText("DRAFT").toUpperCase();
            if (!"DRAFT".equals(curStatus) && !"REJECTED".equals(curStatus)) {
                // Already submitted to Meta (PENDING/APPROVED/DISABLED). Reconcile, do NOT resubmit.
                return reconcileTerminal(id, instituteId, p.getProposedCategory(),
                        curStatus, textOrNull(cur, "category"), textOrNull(cur, "rejectionReason"));
            }

            // DRAFT/REJECTED → (re)author the body then submit to Meta.
            clients.updateWhatsAppTemplateDraft(templateId, dto);
            JsonNode resp = clients.submitWhatsAppTemplate(templateId);
            return reconcileTerminal(id, instituteId, p.getProposedCategory(),
                    resp.path("status").asText("PENDING"),
                    textOrNull(resp, "category"), textOrNull(resp, "rejectionReason"));
        } catch (Exception e) {
            // Status-guarded rollback: only if STILL SUBMITTED. If a concurrent poll already advanced
            // this row (e.g. our submit landed but the response was lost), rollbackSubmit affects 0
            // rows and the winning META_* state stands — never un-approve a Meta-approved template.
            proposalRepository.rollbackSubmit(id, null, "Submit failed: " + e.getMessage(), Instant.now());
            throw new VacademyException("Template submission failed: " + e.getMessage());
        }
    }

    /**
     * Return an existing notification_template id for this proposal, creating a draft only if none
     * exists. Idempotent across a lost create response: if the FK is null we FIRST look the draft up
     * by natural key (institute, name, language) and adopt an orphan left by a prior attempt, so a
     * retry never re-creates the same name and dead-ends on the uniqueness 409. The adopted/created
     * FK is committed before we go further so the next step is always the update path.
     */
    private String resolveOrCreateDraft(EngagementTemplateProposal p, Map<String, Object> dto) {
        String templateId = p.getNotificationTemplateId();
        if (templateId != null && !templateId.isBlank()) return templateId;

        JsonNode existing = clients.getWhatsAppTemplateByName(
                p.getInstituteId(), p.getName(), metaLanguageCode(p.getLanguage()));
        templateId = existing != null && existing.hasNonNull("id") ? existing.get("id").asText() : null;
        if (templateId == null || templateId.isBlank()) {
            JsonNode created = clients.createWhatsAppTemplateDraft(dto);
            templateId = created.path("id").asText(null);
            if (templateId == null || templateId.isBlank()) {
                throw new VacademyException("notification_service returned no template id");
            }
        }
        p.setNotificationTemplateId(templateId);
        proposalRepository.save(p);   // commit the FK on its own so a later failure retries via update
        return templateId;
    }

    // ----- Meta poll reconcile -----

    /** How long a SUBMITTED row may sit untouched before the reaper treats it as a crashed submit. */
    private static final Duration SUBMIT_STALE = Duration.ofMinutes(10);

    /** Refresh one institute's pending proposals from Meta. Returns how many changed state. */
    public int sync(String instituteId) {
        // Refresh ALL of the institute's templates at notification_service from Meta first. If this
        // FAILS (e.g. the institute's Meta token expired), do NOT bail: the stranded-submit reaper
        // below depends only on notification_service DB reads, and a crashed SUBMITTED row must stay
        // recoverable even while Meta creds are broken. We only skip the FORWARD reconcile, which is
        // the one step that needs genuinely fresh Meta data.
        boolean refreshed;
        try {
            clients.syncWhatsAppTemplates(instituteId);
            refreshed = true;
        } catch (Exception e) {
            log.warn("Template sync: Meta refresh failed for institute {}: {}", instituteId, e.getMessage());
            refreshed = false;
        }
        List<EngagementTemplateProposal> pending = proposalRepository.findByInstituteIdAndStatusIn(instituteId, PENDING);
        Instant now = Instant.now();
        Instant staleBefore = now.minus(SUBMIT_STALE);
        int changed = 0;
        for (EngagementTemplateProposal p : pending) {
            try {
                boolean stale = p.getUpdatedAt() != null && p.getUpdatedAt().isBefore(staleBefore);
                String templateId = p.getNotificationTemplateId();

                if (templateId == null) {
                    // SUBMITTED with no FK = a submit that died before stamping it. Give a live submit
                    // time to finish; once stale, adopt any orphan draft it left (retry via update),
                    // else free the row back to USER_APPROVED so a human/retry can submit it. Needs
                    // only notification_service reads, so it runs regardless of the Meta refresh.
                    if (!"SUBMITTED".equals(p.getStatus()) || !stale) continue;
                    JsonNode orphan = clients.getWhatsAppTemplateByName(
                            instituteId, p.getName(), metaLanguageCode(p.getLanguage()));
                    String adopt = orphan != null && orphan.hasNonNull("id") ? orphan.get("id").asText() : null;
                    if (proposalRepository.rollbackSubmit(p.getId(), adopt,
                            "Submission interrupted; ready to retry", now) == 1) changed++;
                    continue;
                }

                JsonNode t = clients.getWhatsAppTemplate(templateId);
                String metaStatus = t.path("status").asText(null);
                String metaCategory = textOrNull(t, "category");
                String rejection = textOrNull(t, "rejectionReason");

                // Still a DRAFT at notification_service = it never reached Meta (crash after create,
                // before submit). Once stale, free it for retry rather than polling it forever. Also
                // a notification-DB-only read, so it runs even when the Meta refresh failed.
                if ("DRAFT".equalsIgnoreCase(metaStatus)) {
                    if ("SUBMITTED".equals(p.getStatus()) && stale
                            && proposalRepository.rollbackSubmit(p.getId(), templateId,
                                    "Submission did not reach Meta; ready to retry", now) == 1) changed++;
                    continue;
                }

                // Forward reconcile from Meta's real verdict — the ONE step that needs a fresh Meta
                // refresh. On a failed refresh the notification-side status is stale, so skip it;
                // the next successful sweep advances it.
                if (!refreshed) continue;
                String toStatus = mapMetaStatus(metaStatus, p.getProposedCategory(), metaCategory);
                if (toStatus == null || toStatus.equals(p.getStatus())) continue; // no real change; avoid churn
                if (proposalRepository.reconcileFromMeta(p.getId(), toStatus, metaCategory, rejection, now) == 1) {
                    changed++;
                }
            } catch (Exception e) {
                log.warn("Template sync: reconcile failed for proposal {}: {}", p.getId(), e.getMessage());
            }
        }
        if (changed > 0) log.info("Template sync: {} proposal(s) changed state for institute {}", changed, instituteId);
        return changed;
    }

    // ----- helpers -----

    /** Map a notification_template Meta status → proposal status; null = leave as-is. */
    private String mapMetaStatus(String metaStatus, String proposedCategory, String metaCategory) {
        if (metaStatus == null) return null;
        return switch (metaStatus.toUpperCase()) {
            case "APPROVED" -> (metaCategory != null && proposedCategory != null
                    && !metaCategory.equalsIgnoreCase(proposedCategory)) ? "META_RECATEGORISED" : "META_APPROVED";
            case "REJECTED", "DISABLED" -> "META_REJECTED";
            case "PENDING" -> "META_PENDING";
            default -> null; // DELETED / unknown — don't clobber
        };
    }

    /**
     * Write a submit-time verdict through the SAME status-guarded CAS the poll uses, so a concurrent
     * poll that already advanced this row to a terminal META_* state wins and submit()'s (possibly
     * staler) verdict is dropped — reconcileFromMeta's WHERE status IN ('SUBMITTED','META_PENDING')
     * never overwrites META_APPROVED/REJECTED/RECATEGORISED. Then return the row's actual DB state.
     */
    private EngagementTemplateProposal reconcileTerminal(String id, String instituteId, String proposedCategory,
                                                         String metaStatus, String metaCategory, String rejection) {
        String toStatus = mapMetaStatus(metaStatus, proposedCategory, metaCategory);
        proposalRepository.reconcileFromMeta(id, toStatus != null ? toStatus : "META_PENDING",
                metaCategory, rejection, Instant.now());
        return requireProposal(id, instituteId);
    }

    private Map<String, Object> buildTemplateDto(EngagementTemplateProposal p, String actorId) {
        Map<String, Object> dto = new java.util.HashMap<>();
        dto.put("instituteId", p.getInstituteId());
        dto.put("name", p.getName());
        dto.put("language", metaLanguageCode(p.getLanguage()));
        dto.put("category", p.getProposedCategory());
        dto.put("headerType", "NONE");
        dto.put("bodyText", p.getProposedBody());
        if (p.getFooterText() != null) dto.put("footerText", p.getFooterText());
        dto.put("bodyVariableNames", readJsonArray(p.getVariableNames()));
        dto.put("bodySampleValues", readJsonArray(p.getSampleValues()));
        dto.put("createdBy", actorId);
        return dto;
    }

    /** Hinglish is authored under Meta code "en" (no Hinglish language code exists). */
    private static String metaLanguageCode(String lang) {
        return "hinglish".equals(lang) ? "en" : (lang != null ? lang : "en");
    }

    /**
     * Meta requires: placeholders {{1..K}} contiguous from 1, and exactly K variable names AND K
     * samples in matching order. Returns a human-readable problem, or null when valid.
     */
    private String alignmentProblem(String body, List<String> variableNames, List<String> sampleValues, String category) {
        if (body == null || body.isBlank()) return "empty body";
        if (body.length() > 1024) return "body exceeds Meta's 1024-char limit";
        if (category == null || !VALID_CATEGORIES.contains(category.toUpperCase())) {
            return "category must be MARKETING|UTILITY|AUTHENTICATION";
        }
        TreeSet<Integer> nums = new TreeSet<>();
        Matcher m = PLACEHOLDER.matcher(body);
        while (m.find()) nums.add(Integer.parseInt(m.group(1)));
        // Meta numbers placeholders from 1: reject {{0}} (and any sub-1 index the regex captured).
        if (!nums.isEmpty() && nums.first() < 1) {
            return "placeholder {{" + nums.first() + "}} is not allowed (numbering starts at 1)";
        }
        int k = nums.isEmpty() ? 0 : nums.last();
        // contiguous 1..k, no gaps
        for (int i = 1; i <= k; i++) {
            if (!nums.contains(i)) return "placeholder {{" + i + "}} is missing (must be sequential from 1)";
        }
        int vn = variableNames == null ? 0 : variableNames.size();
        int sv = sampleValues == null ? 0 : sampleValues.size();
        if (vn != k) return "has " + k + " placeholder(s) but " + vn + " variable name(s)";
        if (sv != k) return "has " + k + " placeholder(s) but " + sv + " sample value(s)";
        // Variables are filled by name, so two placeholders sharing a name collapse into one value
        // and Meta rejects the send (#132000: parameter count mismatch).
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (String name : variableNames == null ? List.<String>of() : variableNames) {
            String key = name == null ? "" : name.trim().toLowerCase();
            if (key.isEmpty()) return "every placeholder needs a variable name";
            if (!seen.add(key)) return "variable name '" + name.trim() + "' is used twice; each placeholder needs its own";
        }
        return null;
    }

    private String activePrompt(EngagementEngine engine) {
        Optional<EngagementPromptVersion> active =
                promptRepository.findTopByEngineIdAndStatusOrderByVersionDesc(engine.getId(), "ACTIVE");
        String compiled = active.map(EngagementPromptVersion::getCompiledText).orElse(null);
        if (compiled == null || compiled.isBlank()) {
            compiled = engine.getObjective() != null ? engine.getObjective() : engine.getName();
        }
        return compiled;
    }

    private boolean whatsAppEnabled(EngagementEngine engine) {
        try {
            return objectMapper.readTree(engine.getChannels()).path("WHATSAPP").path("enabled").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Meta-legal name (lowercase/underscore) + a short uniqueness suffix so rounds/resubmits never
     * collide. Capped so the FINAL name (base + '_' + 6 hex = base+7) fits the 255-char name column
     * on BOTH engagement_template_proposal and notification_template — the AI's "name" field is
     * model-produced and otherwise unbounded, and an over-long name would fail the proposal INSERT.
     */
    private static String metaName(String base) {
        String norm = (base == null || base.isBlank() ? "engagement_template" : base)
                .toLowerCase().replaceAll("[^a-z0-9_]", "_");
        if (norm.length() > 240) norm = norm.substring(0, 240);
        String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6);
        return norm + "_" + suffix;
    }

    private static String trimFooter(String footer) {
        if (footer == null) return null;
        String f = footer.trim();
        if (f.isEmpty()) return null;
        return f.length() > 60 ? f.substring(0, 60) : f;
    }

    private static int clampCount(Integer count) {
        if (count == null) return 2;
        return Math.max(1, Math.min(count, 3));
    }

    private EngagementEngine requireEngine(String engineId, String instituteId) {
        EngagementEngine engine = engineRepository.findById(engineId)
                .orElseThrow(() -> new VacademyException("Engine not found"));
        if (!engine.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Engine does not belong to this institute");
        }
        return engine;
    }

    private EngagementTemplateProposal requireProposal(String id, String instituteId) {
        return proposalRepository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> new VacademyException("Template proposal not found"));
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o != null ? o : List.of());
        } catch (Exception e) {
            throw new VacademyException("Invalid JSON payload: " + e.getMessage());
        }
    }

    private List<String> readJsonArray(String json) {
        try {
            List<String> out = new ArrayList<>();
            JsonNode n = objectMapper.readTree(json == null ? "[]" : json);
            if (n.isArray()) n.forEach(e -> out.add(e.asText()));
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asText() : null;
    }
}
