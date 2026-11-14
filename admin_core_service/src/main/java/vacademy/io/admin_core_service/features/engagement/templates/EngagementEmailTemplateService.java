package vacademy.io.admin_core_service.features.engagement.templates;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementBrainClient;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Engine email templates: AI drafts from the brief → human edits → approve → the brain picks an
 * approved one by name and the dispatcher renders it (this class is the catalog).
 *
 * Lifecycle per template name: AI_PROPOSED / USER_REVIEW → APPROVED. Editing an APPROVED template
 * creates the next version in USER_REVIEW; the old version keeps sending until the new one is
 * approved, then it becomes SUPERSEDED (E9). ARCHIVED takes a template out of use.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementEmailTemplateService implements EngagementEmailTemplateCatalog {

    static final Set<String> MODES = Set.of("NEW", "REGENERATE", "MORE_LIKE_THIS");
    static final Set<String> LANGUAGES = Set.of("en", "hi", "hinglish");
    private static final Set<String> REVIEWABLE = Set.of(EngagementEmailTemplate.AI_PROPOSED, EngagementEmailTemplate.USER_REVIEW);

    private final EngagementEmailTemplateRepository repository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final EngagementEmailTemplateAdvisor advisor;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** Field-injected so the constructor the tests use is unchanged; absent = always generate. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.admin_core_service.features.engagement.service.EngagementTemplateReuseMatcher reuseMatcher;

    // ------------------------------------------------------------------ API-facing

    public record GenerateRequest(String purpose, Integer count, String language, String feedback,
                                  String basedOnId, String mode) {}

    public record EditRequest(String title, String purpose, String subject, String preheader, String bodyHtml,
                              List<String> variableNames, List<String> sampleValues,
                              Map<String, String> variableSources) {}

    /** What the dashboard sees: parsed lists plus the current validation issues. */
    public record View(String id, String engineId, String name, int version, String title, String purpose,
                       String language, String subject, String preheader, String bodyHtml,
                       List<String> variableNames, List<String> sampleValues, Map<String, String> variableSources,
                       String status, String rationale, List<EmailTemplateRules.Issue> issues,
                       Instant createdAt, Instant updatedAt, Instant approvedAt, String reusedFromId) {}

    public record Preview(String subject, String html, String text, List<String> missingVariables) {}

    public List<View> list(String engineId, String instituteId) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        String brief = brief(engine);
        return repository.findByEngineIdAndInstituteIdOrderByNameAscVersionDesc(engineId, instituteId)
                .stream().map(t -> view(t, brief, coldOutreach(engine))).toList();
    }

    @Transactional
    public List<View> generate(String engineId, String instituteId, GenerateRequest req, String actor) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        refuseSystemEngine(engine);
        String mode = req == null || req.mode() == null ? "NEW" : req.mode().toUpperCase(Locale.ROOT);
        if (!MODES.contains(mode)) throw new VacademyException("mode must be NEW, REGENERATE or MORE_LIKE_THIS");
        String language = req != null && req.language() != null ? req.language() : engine.getLanguage();
        if (!LANGUAGES.contains(language)) throw new VacademyException("language must be en, hi or hinglish");
        int count = Math.max(1, Math.min(req != null && req.count() != null ? req.count() : 3, 5));

        EngagementEmailTemplate basedOn = null;
        if (!"NEW".equals(mode)) {
            if (req.basedOnId() == null) throw new VacademyException("basedOnId is required for " + mode);
            basedOn = requireTemplate(req.basedOnId(), instituteId);
            if (!basedOn.getEngineId().equals(engineId)) throw new VacademyException("Template belongs to another engine");
            if ("REGENERATE".equals(mode)) {
                if (!REVIEWABLE.contains(basedOn.getStatus())) {
                    throw new VacademyException("Only a draft can be regenerated; edit an approved template instead");
                }
                count = 1;
            }
        }

        String brief = brief(engine);
        boolean cold = coldOutreach(engine);
        String purpose = req != null && req.purpose() != null && !req.purpose().isBlank()
                ? req.purpose().trim() : (basedOn != null ? basedOn.getPurpose() : null);
        String seed = basedOn == null ? null : "SUBJECT: " + basedOn.getSubject() + "\n" + basedOn.getBodyHtml();
        String feedback = req != null ? req.feedback() : null;
        if ("REGENERATE".equals(mode) && (feedback == null || feedback.isBlank())) {
            feedback = "Write a clearly different version of the template above.";
        }

        // Email templates the institute already has approved for another engine come first (no new
        // review needed); the advisor writes only what they don't cover.
        List<View> saved = new ArrayList<>();
        int reusedCount = 0;
        if ("NEW".equals(mode)) {
            saved.addAll(reuseApproved(engine, brief, cold, purpose, language, count, actor));
            reusedCount = saved.size();
            count -= reusedCount;
        }
        if (count < 1) return saved;

        List<EngagementEmailTemplateAdvisor.Draft> drafts = advisor.propose(engine, brief, purpose, language, count,
                cold, feedback, seed, repository.namesUsed(engineId));

        Set<String> taken = new HashSet<>(repository.namesUsed(engineId));
        List<String> dropped = new ArrayList<>();
        for (EngagementEmailTemplateAdvisor.Draft d : drafts) {
            String body = EmailTemplateRules.sanitise(d.bodyHtml());
            List<EmailTemplateRules.Issue> issues = EmailTemplateRules.check(d.subject(), body, d.variableNames(),
                    d.sampleValues(), d.variableSources(), brief, cold);
            if (EmailTemplateRules.hasBlocking(issues)) {
                dropped.add(firstBlock(issues));
                log.warn("Engine {}: dropped AI email template '{}' — {}", engineId, d.name(), firstBlock(issues));
                continue;
            }
            EngagementEmailTemplate t = new EngagementEmailTemplate();
            t.setEngineId(engineId);
            t.setInstituteId(instituteId);
            t.setName(uniqueName(d.name(), taken));
            t.setVersion(1);
            t.setTitle(cap(d.title(), 255));
            t.setPurpose(cap(purpose != null ? purpose : d.purpose(), 120));
            t.setLanguage(language);
            t.setSubject(cap(d.subject().trim(), 255));
            t.setPreheader(cap(d.preheader(), 255));
            t.setBodyHtml(body);
            t.setVariableNames(json(d.variableNames()));
            t.setSampleValues(json(d.sampleValues()));
            t.setVariableSources(json(d.variableSources()));
            t.setWarnings(json(issues));
            t.setStatus(EngagementEmailTemplate.AI_PROPOSED);
            t.setRationale(d.rationale());
            t.setCreatedBy(actor);
            saved.add(view(repository.save(t), brief, cold));
        }
        if (saved.size() == reusedCount) {
            if (reusedCount > 0) return saved; // the taken-over ones are already there; the rest could not be written
            throw new VacademyException("The AI could not write a valid email template"
                    + (dropped.isEmpty() ? "" : " (" + String.join("; ", dropped) + ")")
                    + ". Try again or add the missing facts or links to the brief.");
        }
        if ("REGENERATE".equals(mode)) {
            basedOn.setStatus(EngagementEmailTemplate.ARCHIVED);
            repository.save(basedOn);
        }
        return saved;
    }

    @Transactional
    public View edit(String id, String instituteId, EditRequest req, String actor) {
        EngagementEmailTemplate current = requireTemplate(id, instituteId);
        EngagementEngine engine = requireEngine(current.getEngineId(), instituteId);
        refuseSystemEngine(engine);
        EngagementEmailTemplate target;
        if (EngagementEmailTemplate.APPROVED.equals(current.getStatus())) {
            // E9: the approved version keeps sending; the edit becomes the next version for review.
            // A second edit of the approved one updates that pending version instead of starting another.
            target = repository.findFirstByEngineIdAndInstituteIdAndNameAndStatusInOrderByVersionDesc(
                            current.getEngineId(), instituteId, current.getName(), List.copyOf(REVIEWABLE))
                    .filter(p -> p.getVersion() > current.getVersion())
                    .orElseGet(() -> copyAsNextVersion(current, actor));
        } else if (REVIEWABLE.contains(current.getStatus())) {
            target = current;
        } else {
            throw new VacademyException("A " + current.getStatus().toLowerCase(Locale.ROOT) + " template can't be edited");
        }
        if (req.title() != null) target.setTitle(cap(req.title(), 255));
        if (req.purpose() != null) target.setPurpose(cap(req.purpose(), 120));
        if (req.subject() != null) target.setSubject(cap(req.subject().trim(), 255));
        if (req.preheader() != null) target.setPreheader(cap(req.preheader(), 255));
        if (req.bodyHtml() != null) target.setBodyHtml(EmailTemplateRules.sanitise(req.bodyHtml()));
        if (req.variableNames() != null) target.setVariableNames(json(req.variableNames()));
        if (req.sampleValues() != null) target.setSampleValues(json(req.sampleValues()));
        if (req.variableSources() != null) target.setVariableSources(json(req.variableSources()));

        String brief = brief(engine);
        boolean cold = coldOutreach(engine);
        List<EmailTemplateRules.Issue> issues = issues(target, brief, cold);
        if (EmailTemplateRules.hasBlocking(issues)) {
            throw new VacademyException("Template is not valid: " + firstBlock(issues));
        }
        target.setWarnings(json(issues));
        target.setStatus(EngagementEmailTemplate.USER_REVIEW);
        return view(repository.save(target), brief, cold);
    }

    /**
     * Takes over approved templates of the institute's other engines that fit this engine's brief as
     * written: a copy for this engine, already approved, pointing at its source. Skipped: any that
     * break the email rules against THIS brief (a link this brief does not contain, cold outreach
     * without an unsubscribe line).
     */
    List<View> reuseApproved(EngagementEngine engine, String brief, boolean cold, String purpose, String language,
                             int want, String actor) {
        if (reuseMatcher == null) return List.of();
        try {
            List<EngagementEmailTemplate> pool = new ArrayList<>();
            for (EngagementEmailTemplate c : repository.findReusableFromOtherEngines(
                    engine.getInstituteId(), engine.getId(), language)) {
                if (!EmailTemplateRules.hasBlocking(issues(c, brief, cold))) pool.add(c);
            }
            if (pool.isEmpty()) return List.of();
            List<vacademy.io.admin_core_service.features.engagement.service.EngagementTemplateReuseMatcher.Candidate> cands = new ArrayList<>();
            for (EngagementEmailTemplate c : pool) {
                cands.add(new vacademy.io.admin_core_service.features.engagement.service.EngagementTemplateReuseMatcher.Candidate(
                        c.getId(), c.getName(), c.getPurpose(), "SUBJECT: " + c.getSubject() + " BODY: "
                        + EmailTemplateRules.render("", c.getBodyHtml(), List.of(), Map.of()).text()));
            }
            Map<String, String> picked = reuseMatcher.pick(engine.getInstituteId(), "email", brief, purpose, cands, want);
            List<View> out = new ArrayList<>();
            Instant now = Instant.now();
            for (EngagementEmailTemplate src : pool) {
                String why = picked.get(src.getId());
                if (why == null) continue;
                EngagementEmailTemplate t = new EngagementEmailTemplate();
                t.setEngineId(engine.getId());
                t.setInstituteId(engine.getInstituteId());
                t.setName(src.getName());
                t.setVersion(repository.maxVersion(engine.getId(), src.getName()) + 1);
                t.setTitle(src.getTitle());
                t.setPurpose(src.getPurpose());
                t.setLanguage(src.getLanguage());
                t.setSubject(src.getSubject());
                t.setPreheader(src.getPreheader());
                t.setBodyHtml(src.getBodyHtml());
                t.setVariableNames(src.getVariableNames());
                t.setSampleValues(src.getSampleValues());
                t.setVariableSources(src.getVariableSources());
                t.setWarnings(json(issues(src, brief, cold)));
                t.setStatus(EngagementEmailTemplate.APPROVED);
                t.setApprovedBy(src.getApprovedBy());
                t.setApprovedAt(now);
                t.setReusedFromId(src.getId());
                t.setRationale(cap("Already approved for another engine." + (why.isBlank() ? "" : " " + why), 1000));
                t.setCreatedBy(actor);
                out.add(view(repository.save(t), brief, cold));
            }
            if (!out.isEmpty()) {
                log.info("Engine {}: took over {} approved email template(s) from other engines", engine.getId(), out.size());
            }
            return out;
        } catch (Exception e) {
            log.warn("Engine {}: email template reuse skipped: {}", engine.getId(), e.getMessage());
            return List.of();
        }
    }

    @Transactional
    public View approve(String id, String instituteId, String actor) {
        EngagementEmailTemplate t = requireTemplate(id, instituteId);
        EngagementEngine engine = requireEngine(t.getEngineId(), instituteId);
        refuseSystemEngine(engine);
        String brief = brief(engine);
        boolean cold = coldOutreach(engine);
        List<EmailTemplateRules.Issue> issues = issues(t, brief, cold);
        if (EmailTemplateRules.hasBlocking(issues)) {
            // The brief may have changed since the draft (a link removed): re-check before it can send.
            throw new VacademyException("Template is not valid: " + firstBlock(issues));
        }
        if (!REVIEWABLE.contains(t.getStatus())) {
            throw new VacademyException("Template is not in an approvable state (must be a draft under review)");
        }
        Optional<EngagementEmailTemplate> live = repository.findFirstByEngineIdAndInstituteIdAndNameAndStatus(
                t.getEngineId(), instituteId, t.getName(), EngagementEmailTemplate.APPROVED);
        if (live.isPresent() && live.get().getVersion() > t.getVersion()) {
            throw new VacademyException("A newer version (v" + live.get().getVersion()
                    + ") of this template is already approved; edit that one instead");
        }
        Instant now = Instant.now();
        repository.supersedeApproved(t.getEngineId(), t.getName(), t.getId(), now);
        if (repository.approve(t.getId(), instituteId, actor, now) == 0) {
            throw new VacademyException("Template changed while approving; reload and try again");
        }
        return view(requireTemplate(id, instituteId), brief, cold);
    }

    @Transactional
    public View archive(String id, String instituteId) {
        EngagementEmailTemplate t = requireTemplate(id, instituteId);
        EngagementEngine engine = requireEngine(t.getEngineId(), instituteId);
        refuseSystemEngine(engine);
        if (EngagementEmailTemplate.ARCHIVED.equals(t.getStatus())) return view(t, brief(engine), coldOutreach(engine));
        t.setStatus(EngagementEmailTemplate.ARCHIVED);
        return view(repository.save(t), brief(engine), coldOutreach(engine));
    }

    /** Render with the given values, falling back to the template's sample values (dashboard preview). */
    public Preview preview(String id, String instituteId, Map<String, String> values) {
        EngagementEmailTemplate t = requireTemplate(id, instituteId);
        Map<String, String> v = new LinkedHashMap<>();
        List<String> names = list(t.getVariableNames());
        List<String> samples = list(t.getSampleValues());
        for (int i = 0; i < names.size(); i++) v.put(names.get(i), i < samples.size() ? samples.get(i) : null);
        if (values != null) v.putAll(values);
        EmailTemplateRules.Rendered r = EmailTemplateRules.render(t.getSubject(), t.getBodyHtml(), names, v);
        return new Preview(r.subject(), r.html(), r.text(), r.missing());
    }

    // ------------------------------------------------------------------ catalog (brain / dispatcher)

    @Override
    public List<EngagementBrainClient.TemplateOption> findApprovedEmailTemplates(String engineId, String instituteId) {
        List<EngagementBrainClient.TemplateOption> out = new ArrayList<>();
        EngagementEngine engine = engineRepository.findById(engineId).orElse(null);
        if (engine == null || !instituteId.equals(engine.getInstituteId())) return out;
        String brief = brief(engine);
        boolean cold = coldOutreach(engine);
        for (EngagementEmailTemplate t : repository.findByEngineIdAndInstituteIdAndStatusOrderByNameAsc(
                engineId, instituteId, EngagementEmailTemplate.APPROVED)) {
            if (EmailTemplateRules.hasBlocking(issues(t, brief, cold))) continue; // broke when the brief changed
            // Keep the placeholders visible so the brain knows which values to supply.
            Map<String, String> keep = new LinkedHashMap<>();
            for (String n : list(t.getVariableNames())) keep.put(n, "{{" + n + "}}");
            String text = EmailTemplateRules.render("", t.getBodyHtml(), List.of(), keep).text();
            out.add(new EngagementBrainClient.TemplateOption(t.getName(),
                    "SUBJECT: " + t.getSubject() + "\n\n" + text, list(t.getVariableNames()), t.getLanguage()));
        }
        return out;
    }

    @Override
    public Optional<RenderedEmail> render(String engineId, String instituteId, String templateName,
                                          Map<String, String> variables) {
        return repository.findFirstByEngineIdAndInstituteIdAndNameAndStatus(engineId, instituteId, templateName,
                        EngagementEmailTemplate.APPROVED)
                .map(t -> rendered(t, variables));
    }

    @Override
    public Optional<RenderedEmail> renderById(String templateId, String instituteId, Map<String, String> variables) {
        return repository.findByIdAndInstituteId(templateId, instituteId)
                .filter(t -> !EngagementEmailTemplate.ARCHIVED.equals(t.getStatus()))
                .map(t -> rendered(t, variables));
    }

    private RenderedEmail rendered(EngagementEmailTemplate t, Map<String, String> variables) {
        EmailTemplateRules.Rendered r = EmailTemplateRules.render(t.getSubject(), t.getBodyHtml(),
                list(t.getVariableNames()), variables);
        // Re-check against the engine's current brief: approval was against the brief of that day.
        List<String> problems = new ArrayList<>();
        EngagementEngine engine = engineRepository.findById(t.getEngineId()).orElse(null);
        if (engine == null) {
            problems.add("the engine no longer exists");
        } else {
            issues(t, brief(engine), coldOutreach(engine)).stream()
                    .filter(i -> i.level() == EmailTemplateRules.Level.BLOCK)
                    .forEach(i -> problems.add(i.message()));
        }
        return new RenderedEmail(t.getId(), t.getName(), t.getVersion(), r.subject(), r.html(), r.text(), r.missing(),
                problems);
    }

    // ------------------------------------------------------------------ helpers

    private EngagementEmailTemplate copyAsNextVersion(EngagementEmailTemplate src, String actor) {
        EngagementEmailTemplate n = new EngagementEmailTemplate();
        n.setEngineId(src.getEngineId());
        n.setInstituteId(src.getInstituteId());
        n.setName(src.getName());
        n.setVersion(repository.maxVersion(src.getEngineId(), src.getName()) + 1);
        n.setTitle(src.getTitle());
        n.setPurpose(src.getPurpose());
        n.setLanguage(src.getLanguage());
        n.setSubject(src.getSubject());
        n.setPreheader(src.getPreheader());
        n.setBodyHtml(src.getBodyHtml());
        n.setVariableNames(src.getVariableNames());
        n.setSampleValues(src.getSampleValues());
        n.setVariableSources(src.getVariableSources());
        n.setRationale(src.getRationale());
        n.setCreatedBy(actor);
        return n;
    }

    private List<EmailTemplateRules.Issue> issues(EngagementEmailTemplate t, String brief, boolean cold) {
        return EmailTemplateRules.check(t.getSubject(), t.getBodyHtml(), list(t.getVariableNames()),
                list(t.getSampleValues()), map(t.getVariableSources()), brief, cold);
    }

    private View view(EngagementEmailTemplate t, String brief, boolean cold) {
        return new View(t.getId(), t.getEngineId(), t.getName(), t.getVersion(), t.getTitle(), t.getPurpose(),
                t.getLanguage(), t.getSubject(), t.getPreheader(), t.getBodyHtml(), list(t.getVariableNames()),
                list(t.getSampleValues()), map(t.getVariableSources()), t.getStatus(), t.getRationale(),
                issues(t, brief, cold), t.getCreatedAt(), t.getUpdatedAt(), t.getApprovedAt(), t.getReusedFromId());
    }

    private EngagementEngine requireEngine(String engineId, String instituteId) {
        EngagementEngine engine = engineRepository.findById(engineId)
                .orElseThrow(() -> new VacademyException("Engine not found"));
        if (!engine.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Engine does not belong to this institute");
        }
        return engine;
    }

    private EngagementEmailTemplate requireTemplate(String id, String instituteId) {
        return repository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> new VacademyException("Email template not found"));
    }

    private static void refuseSystemEngine(EngagementEngine engine) {
        if (engine.isSystemManaged()) {
            throw new VacademyException("\"" + engine.getName() + "\" is run by AI calling; its messages come from "
                    + "the AI agent's send rules, not from engine templates.");
        }
    }

    private String brief(EngagementEngine engine) {
        Optional<EngagementPromptVersion> active =
                promptRepository.findTopByEngineIdAndStatusOrderByVersionDesc(engine.getId(), "ACTIVE");
        String compiled = active.map(EngagementPromptVersion::getCompiledText).orElse(null);
        if (compiled == null || compiled.isBlank()) {
            compiled = engine.getObjective() != null ? engine.getObjective() : engine.getName();
        }
        return compiled;
    }

    /** channels.EMAIL.coldOutreach — set for engines that write to people who never contacted us (E4). */
    boolean coldOutreach(EngagementEngine engine) {
        try {
            return objectMapper.readTree(engine.getChannels() == null ? "{}" : engine.getChannels())
                    .path("EMAIL").path("coldOutreach").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    static String uniqueName(String raw, Set<String> taken) {
        String base = raw == null ? "" : raw.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]+", "_")
                .replaceAll("_+", "_").replaceAll("^_|_$", "");
        if (base.isBlank()) base = "email_template";
        if (base.length() > 100) base = base.substring(0, 100);
        String name = base;
        for (int i = 2; taken.contains(name); i++) name = base + "_" + i;
        taken.add(name);
        return name;
    }

    private static String firstBlock(List<EmailTemplateRules.Issue> issues) {
        return issues.stream().filter(i -> i.level() == EmailTemplateRules.Level.BLOCK)
                .map(EmailTemplateRules.Issue::message).findFirst().orElse("invalid");
    }

    private static String cap(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private String json(Object o) {
        try {
            return objectMapper.writeValueAsString(o == null ? List.of() : o);
        } catch (Exception e) {
            return "[]";
        }
    }

    private List<String> list(String json) {
        try {
            return json == null ? List.of() : objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private Map<String, String> map(String json) {
        try {
            return json == null ? Map.of() : objectMapper.readValue(json, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }
}
