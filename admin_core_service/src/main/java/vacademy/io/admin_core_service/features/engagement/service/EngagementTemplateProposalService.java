package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
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
import vacademy.io.admin_core_service.features.engagement.templates.TemplateVariableSources;
import vacademy.io.admin_core_service.features.engagement.templates.WhatsAppTemplateRules;
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

    /** Field-injected so the constructor the tests use is unchanged; absent = always generate. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private EngagementTemplateReuseMatcher reuseMatcher;

    /** Tells the team when Meta rejects or disables a template; absent in unit tests. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    @org.springframework.context.annotation.Lazy
    private EngagementPointsOfContact pointsOfContact;

    // ----- proposal generation -----

    /** AI proposes a first batch (round 1) for the engine. Moves a DRAFT WhatsApp engine to TEMPLATES_PENDING. */
    @Transactional
    public List<EngagementTemplateProposal> recommend(String engineId, String instituteId, String createdBy, Integer count) {
        return recommend(engineId, instituteId, createdBy, count, null, null);
    }

    /** recommend() with a purpose ("first touch", "missed class") and a language (en | hi | hinglish). */
    @Transactional
    public List<EngagementTemplateProposal> recommend(String engineId, String instituteId, String createdBy, Integer count,
                                                      String purpose, String language) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        refuseSystemEngine(engine);
        int want = clampCount(count);
        String lang = validLanguage(language);
        // Templates the institute already has approved for another engine come first: they need no new
        // Meta review. Only what they don't cover is generated.
        List<EngagementTemplateProposal> reused = reuseApproved(engine, want, purpose, lang, createdBy);
        List<EngagementTemplateProposal> created = new ArrayList<>(reused);
        if (reused.size() < want) {
            try {
                created.addAll(generate(engine, null, want - reused.size(), createdBy, purpose, lang, null));
            } catch (VacademyException e) {
                if (reused.isEmpty()) throw e; // nothing to show: the admin needs the reason
                log.info("Engine {}: reused {} template(s); the rest could not be generated: {}",
                        engineId, reused.size(), e.getMessage());
            }
        }
        // Signal the wizard the engine is mid-negotiation — but NEVER pause a live engine (D8):
        // a prompt edit on an ACTIVE engine that needs a new template keeps running on approved ones.
        // Templates taken over are already approved, so only newly generated ones put it on hold.
        if ("DRAFT".equals(engine.getStatus()) && whatsAppEnabled(engine) && created.size() > reused.size()) {
            engine.setStatus("TEMPLATES_PENDING");
            engineRepository.save(engine);
        }
        return created;
    }

    /**
     * Takes over approved templates of the institute's other engines that fit this engine's brief as
     * written: a copy for this engine, already approved (same Meta template), pointing at its source.
     * Skipped: templates whose links come from another engine's brief, or that break the rules
     * against this brief.
     */
    List<EngagementTemplateProposal> reuseApproved(EngagementEngine engine, int want, String purpose,
                                                   String language, String createdBy) {
        if (reuseMatcher == null) return List.of();
        try {
            String compiled = activePrompt(engine);
            String lang = language != null ? language : engine.getLanguage();
            List<EngagementTemplateProposal> pool = new ArrayList<>();
            for (EngagementTemplateProposal c : proposalRepository
                    .findReusableFromOtherEngines(engine.getInstituteId(), engine.getId(), lang)) {
                if (c.getVariableSources() != null && c.getVariableSources().contains("brief.link.")) continue;
                if (WhatsAppTemplateRules.linkProblem(c.getProposedBody(), compiled) != null) continue;
                pool.add(c);
            }
            if (pool.isEmpty()) return List.of();
            List<EngagementTemplateReuseMatcher.Candidate> candidates = new ArrayList<>();
            for (EngagementTemplateProposal c : pool) {
                candidates.add(new EngagementTemplateReuseMatcher.Candidate(c.getId(), c.getName(), c.getPurpose(),
                        c.getProposedBody()));
            }
            Map<String, String> picked = reuseMatcher.pick(engine.getInstituteId(), "WhatsApp", compiled, purpose,
                    candidates, want);
            List<EngagementTemplateProposal> out = new ArrayList<>();
            int round = proposalRepository.maxRound(engine.getId()) + 1;
            for (EngagementTemplateProposal src : pool) {
                String why = picked.get(src.getId());
                if (why == null) continue;
                EngagementTemplateProposal row = new EngagementTemplateProposal();
                row.setEngineId(engine.getId());
                row.setInstituteId(engine.getInstituteId());
                row.setNotificationTemplateId(src.getNotificationTemplateId());
                row.setName(src.getName());
                row.setLanguage(src.getLanguage());
                row.setProposedBody(src.getProposedBody());
                row.setProposedCategory(src.getProposedCategory());
                row.setMetaCategory(src.getMetaCategory());
                row.setStatus(src.getStatus());
                row.setRound(round);
                row.setVariableNames(src.getVariableNames());
                row.setSampleValues(src.getSampleValues());
                row.setVariableSources(src.getVariableSources());
                row.setPurpose(src.getPurpose());
                row.setHeaderType(src.getHeaderType());
                row.setHeaderText(src.getHeaderText());
                row.setHeaderMediaUrl(src.getHeaderMediaUrl());
                row.setButtons(src.getButtons());
                row.setFooterText(src.getFooterText());
                row.setSubmittedAt(src.getSubmittedAt());
                row.setReusedFromId(src.getId());
                row.setRationale(cap("Already approved for another engine, so no new Meta review is needed."
                        + (why.isBlank() ? "" : " " + why), 1000));
                row.setCreatedBy(createdBy);
                out.add(proposalRepository.save(row));
            }
            if (!out.isEmpty()) {
                log.info("Engine {}: took over {} approved template(s) from other engines", engine.getId(), out.size());
            }
            return out;
        } catch (Exception e) {
            log.warn("Engine {}: template reuse skipped: {}", engine.getId(), e.getMessage());
            return List.of();
        }
    }

    /** "Give me other options" — a fresh round, seeded with the human's steer / Meta's rejection. */
    @Transactional
    public List<EngagementTemplateProposal> requestAlternatives(String engineId, String instituteId,
                                                                TemplateAlternativesRequest req, String createdBy) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        refuseSystemEngine(engine);
        String feedback = req != null ? req.getFeedback() : null;
        int count = clampCount(req != null ? req.getCount() : null);
        String mode = req != null && req.getMode() != null ? req.getMode().toUpperCase() : "NEW";
        if (!Set.of("NEW", "REGENERATE", "MORE_LIKE_THIS").contains(mode)) {
            throw new VacademyException("mode must be NEW, REGENERATE or MORE_LIKE_THIS");
        }
        String purpose = req != null ? req.getPurpose() : null;
        String language = validLanguage(req != null ? req.getLanguage() : null);
        EngagementTemplateProposal basedOn = null;
        String seed = null;
        if (!"NEW".equals(mode)) {
            if (req.getBasedOnId() == null) throw new VacademyException("basedOnId is required for " + mode);
            basedOn = requireProposal(req.getBasedOnId(), instituteId);
            if (!basedOn.getEngineId().equals(engineId)) throw new VacademyException("Template belongs to another engine");
            seed = basedOn.getProposedBody();
            if (purpose == null) purpose = basedOn.getPurpose();
            if (language == null) language = basedOn.getLanguage();
            if ("REGENERATE".equals(mode)) {
                if (!EDITABLE.contains(basedOn.getStatus())) {
                    throw new VacademyException("Only a draft or a rejected template can be regenerated");
                }
                count = 1;
                if (feedback == null || feedback.isBlank()) {
                    feedback = "Write a clearly different version of the template above.";
                }
            }
        }
        List<EngagementTemplateProposal> created = generate(engine, feedback, count, createdBy, purpose, language, seed);
        if ("REGENERATE".equals(mode)) {
            // The new draft replaces the old one; withdraw is status-guarded, so a row that moved on
            // (approved meanwhile) is left alone.
            proposalRepository.withdraw(basedOn.getId(), instituteId, Instant.now());
        }
        return created;
    }

    private static String validLanguage(String language) {
        if (language == null || language.isBlank()) return null;
        if (!Set.of("en", "hi", "hinglish").contains(language)) {
            throw new VacademyException("language must be en, hi or hinglish");
        }
        return language;
    }

    private List<EngagementTemplateProposal> generate(EngagementEngine engine, String feedback, int count, String createdBy,
                                                      String purpose, String language, String seed) {
        String compiled = activePrompt(engine);
        List<String> avoid = proposalRepository
                .findByEngineIdAndInstituteIdOrderByRoundDescCreatedAtDesc(engine.getId(), engine.getInstituteId())
                .stream().map(EngagementTemplateProposal::getName).filter(n -> n != null && !n.isBlank()).toList();

        List<EngagementTemplateAdvisor.Proposal> proposals =
                advisor.propose(engine, compiled, feedback, avoid, count, purpose, language, seed);
        List<String> briefLinks = TemplateVariableSources.briefLinks(compiled);

        int round = proposalRepository.maxRound(engine.getId()) + 1;
        List<EngagementTemplateProposal> saved = new ArrayList<>();
        int dropped = 0;
        for (EngagementTemplateAdvisor.Proposal p : proposals) {
            String problem = alignmentProblem(p.body(), p.variableNames(), p.sampleValues(), p.category());
            if (problem == null) problem = WhatsAppTemplateRules.linkProblem(p.body(), compiled);
            if (problem != null) {
                dropped++;
                log.warn("Engine {}: dropped AI template proposal '{}' — {}", engine.getId(), p.name(), problem);
                continue;
            }
            EngagementTemplateProposal row = new EngagementTemplateProposal();
            row.setEngineId(engine.getId());
            row.setInstituteId(engine.getInstituteId());
            row.setName(metaName(p.name()));           // meta-legal + uniqueness-suffixed
            row.setLanguage(language != null ? language : engine.getLanguage());
            row.setPurpose(cap(p.purpose() != null ? p.purpose() : purpose, 120));
            row.setVariableSources(writeJson(validSources(p.variableNames(), p.variableSources(), briefLinks)));
            row.setProposedBody(p.body());
            // W6: the AI called a promotional message UTILITY. Meta would re-categorise or reject it,
            // so propose it as MARKETING and say why; the human can still change it.
            String category = p.category().toUpperCase();
            String rationale = p.rationale();
            if (WhatsAppTemplateRules.categoryWarning(p.body(), category) != null) {
                category = "MARKETING";
                rationale = (rationale == null || rationale.isBlank() ? "" : rationale + " ")
                        + "(Proposed as MARKETING: the text promotes, so UTILITY would be re-categorised by Meta.)";
            }
            row.setProposedCategory(category);
            row.setStatus("AI_PROPOSED");
            row.setRound(round);
            row.setVariableNames(writeJson(p.variableNames()));
            row.setSampleValues(writeJson(p.sampleValues()));
            row.setFooterText(trimFooter(p.footerText()));
            row.setRationale(rationale);
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
        if (APPROVED_OR_DISABLED.contains(p.getStatus())) {
            // W15: an approved template is not changed in place (Meta would re-review it and the
            // engine would lose it meanwhile). The edit becomes a new version that replaces it once
            // Meta approves the new one.
            p = nextVersionFor(p, editedBy);
        } else if (!EDITABLE.contains(p.getStatus())) {
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
        if (req.getFooterText() != null) {
            // W3: a human-typed footer over Meta's limit is refused, not cut mid-word (AI footers are trimmed).
            if (req.getFooterText().trim().length() > WhatsAppTemplateRules.MAX_FOOTER_CHARS) {
                throw new VacademyException("Template is not valid: footer exceeds Meta's "
                        + WhatsAppTemplateRules.MAX_FOOTER_CHARS + "-char limit");
            }
            p.setFooterText(trimFooter(req.getFooterText()));
        }
        if (req.getPurpose() != null) p.setPurpose(cap(req.getPurpose(), 120));
        if (req.getVariableSources() != null) {
            List<String> sourceProblems = TemplateVariableSources.problems(readJsonArray(p.getVariableNames()),
                    req.getVariableSources(), TemplateVariableSources.briefLinks(activePrompt(requireEngine(p.getEngineId(), instituteId))));
            if (!sourceProblems.isEmpty()) throw new VacademyException("Template is not valid: " + sourceProblems.get(0));
            p.setVariableSources(writeJson(req.getVariableSources()));
        }

        if (req.getHeaderType() != null) p.setHeaderType(req.getHeaderType().trim().toUpperCase());
        if (req.getHeaderText() != null) p.setHeaderText(req.getHeaderText().isBlank() ? null : req.getHeaderText().trim());
        if (req.getHeaderMediaUrl() != null) {
            p.setHeaderMediaUrl(req.getHeaderMediaUrl().isBlank() ? null : req.getHeaderMediaUrl().trim());
        }
        if (req.getButtons() != null) p.setButtons(writeJson(req.getButtons()));

        // Re-validate AFTER applying edits so a human can't approve something Meta will reject.
        String problem = fullProblem(p);
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
        String problem = fullProblem(pre);
        if (problem != null) throw new VacademyException("Template is not valid: " + problem);

        // W10: Meta limits how many templates a business account can create per hour. Over the limit
        // the template waits (QUEUED) and the sync job submits it when there is room.
        if (metaSubmitsPerHour > 0 && proposalRepository.countSubmittedSince(instituteId,
                Instant.now().minus(Duration.ofHours(1))) >= metaSubmitsPerHour) {
            if (proposalRepository.queueForMeta(id, instituteId, Instant.now()) == 1) {
                log.info("Template {} queued: institute {} reached {} Meta submissions this hour", id, instituteId,
                        metaSubmitsPerHour);
                return requireProposal(id, instituteId);
            }
        }

        // Double-submit guard: USER_APPROVED → SUBMITTED, single winner.
        if (proposalRepository.claimForSubmit(id, instituteId, Instant.now()) == 0) {
            throw new VacademyException("Template is not approvable or is already being submitted");
        }
        // Fresh (status == SUBMITTED) because claimForSubmit clears the persistence context.
        EngagementTemplateProposal p = requireProposal(id, instituteId);

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
            // W10: Meta said "too many" — wait in the queue instead of failing.
            if (isMetaRateLimit(e) && proposalRepository.queueForMeta(id, instituteId, Instant.now()) == 1) {
                log.info("Template {} queued after a Meta rate-limit response: {}", id, e.getMessage());
                return requireProposal(id, instituteId);
            }
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
        // Commit the FK on its own so a later failure retries via update. A targeted UPDATE, never
        // save(p): under open-session-in-view p could be the copy read before the SUBMITTED claim,
        // and a full save wrote USER_APPROVED back — every first submit was then never polled.
        proposalRepository.stampSubmittedTemplateId(p.getId(), p.getInstituteId(), templateId, Instant.now());
        p.setNotificationTemplateId(templateId);
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
                    retireReplacedIfApproved(p, toStatus);
                    if ("META_REJECTED".equals(toStatus)) alertTemplateProblem(p, "rejected", rejection);
                }
            } catch (Exception e) {
                log.warn("Template sync: reconcile failed for proposal {}: {}", p.getId(), e.getMessage());
            }
        }
        if (changed > 0) log.info("Template sync: {} proposal(s) changed state for institute {}", changed, instituteId);
        return changed;
    }

    /** Statuses of templates that are (or were) usable and can still change at Meta. */
    private static final List<String> APPROVED_OR_DISABLED = List.of("META_APPROVED", "META_RECATEGORISED", "META_DISABLED");

    /**
     * W12 — Meta can disable or pause an APPROVED template later (quality rating). The 5-minute
     * sync only looks at pending rows, so without this the brain kept picking a template every
     * send of which would fail. An approved row Meta now reports DISABLED / PAUSED / DELETED
     * becomes META_DISABLED (findApproved drops it); one Meta re-approves comes back. Needs a
     * fresh Meta refresh: if the refresh fails nothing changes.
     */
    public int syncApproved(String instituteId) {
        try {
            clients.syncWhatsAppTemplates(instituteId);
        } catch (Exception e) {
            log.warn("Approved-template sync: Meta refresh failed for institute {}: {}", instituteId, e.getMessage());
            return 0;
        }
        int changed = 0;
        Instant now = Instant.now();
        for (EngagementTemplateProposal p : proposalRepository.findByInstituteIdAndStatusIn(instituteId, APPROVED_OR_DISABLED)) {
            if (p.getNotificationTemplateId() == null) continue;
            try {
                JsonNode t = clients.getWhatsAppTemplate(p.getNotificationTemplateId());
                String metaStatus = t.path("status").asText("").toUpperCase();
                String toStatus = switch (metaStatus) {
                    case "DISABLED", "PAUSED", "DELETED" -> "META_DISABLED";
                    case "APPROVED" -> "META_DISABLED".equals(p.getStatus())
                            ? mapMetaStatus("APPROVED", p.getProposedCategory(), textOrNull(t, "category")) : null;
                    default -> null;
                };
                if (toStatus == null || toStatus.equals(p.getStatus())) continue;
                String reason = "META_DISABLED".equals(toStatus)
                        ? (textOrNull(t, "rejectionReason") != null ? textOrNull(t, "rejectionReason")
                                : "Meta " + metaStatus.toLowerCase() + " this template; it is no longer sent.")
                        : null;
                int moved = proposalRepository.reconcileApprovedFromMeta(p.getId(), toStatus, reason, now);
                changed += moved;
                if (moved == 1 && "META_DISABLED".equals(toStatus)) alertTemplateProblem(p, "disabled", reason);
            } catch (Exception e) {
                log.warn("Approved-template sync failed for proposal {}: {}", p.getId(), e.getMessage());
            }
        }
        if (changed > 0) log.info("Approved-template sync: {} template(s) changed state for institute {}", changed, instituteId);
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
        EngagementTemplateProposal row = requireProposal(id, instituteId);
        retireReplacedIfApproved(row, row.getStatus());
        if ("META_REJECTED".equals(row.getStatus())) alertTemplateProblem(row, "rejected", rejection);
        return row;
    }

    /**
     * Tells the admins (email and bell) that Meta rejected or disabled a WhatsApp template, with the engine it
     * belongs to and Meta's reason, so a rejected template does not sit unnoticed while the engine waits
     * on it. Called once per change of state (the status updates are guarded, so a repeat is a no-op).
     */
    private void alertTemplateProblem(EngagementTemplateProposal p, String what, String reason) {
        if (pointsOfContact == null) return;
        try {
            EngagementEngine engine = p.getEngineId() == null ? null : engineRepository.findById(p.getEngineId()).orElse(null);
            boolean shared = p.getPurpose() != null && p.getPurpose().startsWith("SYS:");
            String where = shared ? "the institute's shared \"" + p.getName() + "\" template (used for thank-you and meeting messages)"
                    : "the \"" + p.getName() + "\" template of the engine \"" + (engine == null ? "" : engine.getName()) + "\"";
            String why = reason == null || reason.isBlank() ? "Meta gave no reason." : reason;
            String title = "WhatsApp template " + what + ": " + p.getName();
            String body = "<p>Meta " + what + " " + EngagementPointsOfContact.esc(where) + ".</p><p><b>Meta's reason:</b> "
                    + EngagementPointsOfContact.esc(why) + "</p><p>"
                    + (shared ? "Messages that need it go by email only until it is fixed."
                              : "The engine will not send it. Open the engine, edit the template or ask for new options, and submit it again.")
                    + "</p>";
            pointsOfContact.alert(p.getInstituteId(), null, title, body, "ENGAGEMENT_TEMPLATE", p.getId());
        } catch (Exception e) {
            log.warn("Template {}: could not tell the team it was {}: {}", p.getId(), what, e.getMessage());
        }
    }

    private Map<String, Object> buildTemplateDto(EngagementTemplateProposal p, String actorId) {
        Map<String, Object> dto = new java.util.HashMap<>();
        dto.put("instituteId", p.getInstituteId());
        dto.put("name", p.getName());
        dto.put("language", metaLanguageCode(p.getLanguage()));
        dto.put("category", p.getProposedCategory());
        String headerType = p.getHeaderType() != null ? p.getHeaderType() : "NONE";
        dto.put("headerType", headerType);
        if ("TEXT".equals(headerType) && p.getHeaderText() != null) dto.put("headerText", p.getHeaderText());
        if (!"NONE".equals(headerType) && !"TEXT".equals(headerType) && p.getHeaderMediaUrl() != null) {
            dto.put("headerSampleUrl", p.getHeaderMediaUrl());
        }
        List<WhatsAppTemplateRules.Button> buttons = readButtons(p.getButtons());
        if (!buttons.isEmpty()) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (WhatsAppTemplateRules.Button b : buttons) {
                Map<String, Object> m = new java.util.HashMap<>();
                m.put("type", b.type().toUpperCase());
                m.put("text", b.text().trim());
                if (b.url() != null) m.put("url", b.url().trim());
                if (b.phoneNumber() != null) m.put("phoneNumber", b.phoneNumber().trim());
                out.add(m);
            }
            dto.put("buttons", out);
        }
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
        // W3/W4: Meta's body rules (start/end variable, adjacent variables, variable density).
        return WhatsAppTemplateRules.problem(body, null);
    }

    /** Keep the AI's source for each variable only when that source is valid; the rest are left to the reviewer. */
    private static Map<String, String> validSources(List<String> variableNames, Map<String, String> sources,
                                                    List<String> briefLinks) {
        Map<String, String> out = new java.util.LinkedHashMap<>();
        if (sources == null || variableNames == null) return out;
        for (String v : variableNames) {
            String src = sources.get(v);
            if (src != null && TemplateVariableSources.problems(List.of(v), Map.of(v, src), briefLinks).isEmpty()) {
                out.put(v, src.trim());
            }
        }
        return out;
    }

    /** W1 brief check; field-injected so the constructor (used by tests) is unchanged. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefAdvisor briefAdvisor;

    /** W1 — is the engine's brief enough to write templates from? If not, questions for the admin. */
    public vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefAdvisor.BriefCheck briefCheck(
            String engineId, String instituteId) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        if (briefAdvisor == null) {
            return new vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefAdvisor.BriefCheck(
                    false, 0, List.of(), List.of());
        }
        return briefAdvisor.check(engine, activePrompt(engine));
    }

    /** Meta's per-hour limit on template creation per business account (W10); 0 turns the queue off. */
    @Value("${engagement.templates.meta-submits-per-hour:90}")
    private int metaSubmitsPerHour = 90;

    /** Every rule a proposal must meet before review, approval and submit. Null when fine. */
    private String fullProblem(EngagementTemplateProposal p) {
        String problem = alignmentProblem(p.getProposedBody(), readJsonArray(p.getVariableNames()),
                readJsonArray(p.getSampleValues()), p.getProposedCategory());
        String brief = problem == null ? briefFor(p.getEngineId()) : null;
        if (problem == null) problem = WhatsAppTemplateRules.linkProblem(p.getProposedBody(), brief);
        if (problem == null) {
            problem = WhatsAppTemplateRules.headerProblem(p.getHeaderType(), p.getHeaderText(), p.getHeaderMediaUrl(), brief);
        }
        if (problem == null) problem = WhatsAppTemplateRules.buttonsProblem(readButtons(p.getButtons()), brief);
        return problem;
    }

    /**
     * W15 — the editable next version of an approved template: the existing one if a draft is already
     * open, otherwise a copy that replaces the approved one when Meta approves it.
     */
    private EngagementTemplateProposal nextVersionFor(EngagementTemplateProposal approved, String editedBy) {
        Optional<EngagementTemplateProposal> open = proposalRepository.findFirstByReplacesIdOrderByCreatedAtDesc(approved.getId())
                .filter(x -> !Set.of("WITHDRAWN", "SUPERSEDED").contains(x.getStatus()));
        if (open.isPresent()) {
            if (EDITABLE.contains(open.get().getStatus())) return open.get();
            throw new VacademyException("A new version of this template is already " + open.get().getStatus()
                    .toLowerCase().replace('_', ' ') + "; wait for Meta or withdraw it first");
        }
        EngagementTemplateProposal n = new EngagementTemplateProposal();
        n.setEngineId(approved.getEngineId());
        n.setInstituteId(approved.getInstituteId());
        n.setName(metaName(approved.getName() == null ? null : approved.getName().replaceAll("_[0-9a-f]{6}$", "")));
        n.setLanguage(approved.getLanguage());
        n.setPurpose(approved.getPurpose());
        n.setProposedBody(approved.getProposedBody());
        n.setProposedCategory(approved.getMetaCategory() != null ? approved.getMetaCategory().toUpperCase()
                : approved.getProposedCategory());
        n.setVariableNames(approved.getVariableNames());
        n.setSampleValues(approved.getSampleValues());
        n.setVariableSources(approved.getVariableSources());
        n.setFooterText(approved.getFooterText());
        n.setHeaderType(approved.getHeaderType());
        n.setHeaderText(approved.getHeaderText());
        n.setHeaderMediaUrl(approved.getHeaderMediaUrl());
        n.setButtons(approved.getButtons());
        n.setRound(proposalRepository.maxRound(approved.getEngineId()) + 1);
        n.setReplacesId(approved.getId());
        n.setRationale("Edited version of " + approved.getName());
        n.setCreatedBy(editedBy);
        return n;
    }

    /** W15 — once an edited version is approved by Meta, the template it replaces stops being used. */
    private void retireReplacedIfApproved(EngagementTemplateProposal p, String status) {
        if (p.getReplacesId() == null) return;
        if (!"META_APPROVED".equals(status) && !"META_RECATEGORISED".equals(status)) return;
        if (proposalRepository.supersedeReplaced(p.getReplacesId(), Instant.now()) == 1) {
            log.info("Template {} approved; it replaces {}", p.getId(), p.getReplacesId());
        }
    }

    /**
     * W10 — submit queued templates while the institute is under Meta's hourly limit. Called by the
     * sync job; each one goes through the normal submit (validation, idempotent draft, reconcile).
     */
    public int drainQueued(String instituteId) {
        long room = metaSubmitsPerHour - proposalRepository.countSubmittedSince(instituteId,
                Instant.now().minus(Duration.ofHours(1)));
        int submitted = 0;
        for (EngagementTemplateProposal p : proposalRepository.findQueued(instituteId)) {
            if (submitted >= room) break;
            if (proposalRepository.unqueue(p.getId(), Instant.now()) != 1) continue;
            try {
                EngagementTemplateProposal out = submit(p.getId(), instituteId, "SYSTEM_QUEUE");
                if (!"QUEUED".equals(out.getStatus())) submitted++;
                else break; // Meta pushed back again; wait for the next sweep
            } catch (Exception e) {
                log.warn("Queued template {} could not be submitted: {}", p.getId(), e.getMessage());
            }
        }
        return submitted;
    }

    private static boolean isMetaRateLimit(Exception e) {
        String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        return m.contains("rate limit") || m.contains("too many") || m.contains("80008") || m.contains("(#4)");
    }

    private List<WhatsAppTemplateRules.Button> readButtons(String json) {
        try {
            return json == null || json.isBlank() ? List.of()
                    : objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<List<WhatsAppTemplateRules.Button>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    /** The engine's current brief, or null when the engine can't be read (then any written link fails W2). */
    private String briefFor(String engineId) {
        return engineId == null ? null : engineRepository.findById(engineId).map(this::activePrompt).orElse(null);
    }

    private static String cap(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
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

    /** The AI-call engine sends the templates admins put on agents' rules; it has no brief to propose from. */
    private static void refuseSystemEngine(EngagementEngine engine) {
        if (engine.isSystemManaged()) {
            throw new VacademyException("\"" + engine.getName() + "\" sends the templates set on your AI agents' "
                    + "rules; it doesn't take template proposals.");
        }
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
