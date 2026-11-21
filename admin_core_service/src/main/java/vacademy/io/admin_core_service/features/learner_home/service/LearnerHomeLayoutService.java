package vacademy.io.admin_core_service.features.learner_home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;
import vacademy.io.admin_core_service.features.learner_home.media.LearnerHomeMediaService;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Devices;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.LayoutBody;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeBlockRepository;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeLayoutRepository;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Draft, publish, versions and rollback of an institute's learner home (spec 2.5, 5.2).
 *
 * <ul>
 *   <li>One DRAFT per institute (partial unique index). A save replaces the whole block set and
 *       bumps {@code revision}; a save against an older revision is 409 STALE_DRAFT.</li>
 *   <li>Publish: checks and image work first, outside any transaction; then one transaction locks
 *       the draft, re-checks the revision, archives the old PUBLISHED row, inserts the new version
 *       (block keys kept), deletes the draft and prunes ARCHIVED rows beyond the newest 20.</li>
 * </ul>
 */
@Slf4j
@Service
public class LearnerHomeLayoutService {

    public static final int KEEP_ARCHIVED = 20;

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final LearnerHomeLayoutRepository layoutRepository;
    private final LearnerHomeBlockRepository blockRepository;
    private final PublishChecks publishChecks;
    private final LearnerHomeMediaService mediaService;
    private final LearnerHomeLayoutCache layoutCache;
    private final LearnerHomeResolver resolver;
    private final TransactionTemplate tx;
    private Clock clock = Clock.systemUTC();

    public LearnerHomeLayoutService(LearnerHomeLayoutRepository layoutRepository,
                                    LearnerHomeBlockRepository blockRepository, PublishChecks publishChecks,
                                    LearnerHomeMediaService mediaService, LearnerHomeLayoutCache layoutCache,
                                    LearnerHomeResolver resolver, PlatformTransactionManager transactionManager) {
        this.layoutRepository = layoutRepository;
        this.blockRepository = blockRepository;
        this.publishChecks = publishChecks;
        this.mediaService = mediaService;
        this.layoutCache = layoutCache;
        this.resolver = resolver;
        this.tx = new TransactionTemplate(transactionManager);
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── Body parsing ────────────────────────────────────────────────────────

    /** Raw body to JSON, with the 256 KB cap. */
    public static JsonNode readBody(String raw) {
        if (raw == null || raw.isBlank()) {
            return F.objectNode();
        }
        if (raw.getBytes(StandardCharsets.UTF_8).length > HomeParser.MAX_BODY_BYTES) {
            throw new LearnerHomeException(HttpStatus.UNPROCESSABLE_ENTITY, "PAYLOAD_TOO_LARGE",
                    "The layout is larger than 256 KB");
        }
        try {
            JsonNode node = HomeWriter.MAPPER.readTree(raw);
            if (node == null || !node.isObject()) {
                throw new LearnerHomeException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "The body must be a JSON object");
            }
            return node;
        } catch (LearnerHomeException e) {
            throw e;
        } catch (Exception e) {
            throw new LearnerHomeException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "The body is not valid JSON");
        }
    }

    private static void allowOnly(JsonNode body, Set<String> allowed, List<Issue> issues) {
        Iterator<String> names = body.fieldNames();
        while (names.hasNext()) {
            String n = names.next();
            if (!allowed.contains(n)) issues.add(new Issue(null, n, "UNKNOWN_FIELD", "Unknown field '" + n + "'"));
        }
    }

    /** Parses and validates a layout body; 422 with every problem when anything is wrong. */
    LayoutBody parseValid(String instituteId, JsonNode body, Set<String> allowedTop) {
        List<Issue> issues = new ArrayList<>();
        allowOnly(body, allowedTop, issues);
        LayoutBody parsed = new HomeParser(issues).parseLayout(body.get("settings"), body.get("blocks"));
        List<Issue> ignoredWarnings = new ArrayList<>();
        publishChecks.audienceChecks(instituteId, parsed.blocks(), issues, ignoredWarnings);
        if (!issues.isEmpty()) {
            throw LearnerHomeException.validation("VALIDATION_FAILED", issues, null);
        }
        return parsed;
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    public ObjectNode draftView(String instituteId, boolean moduleEnabled, boolean holistic) {
        return tx.execute(s -> draftViewOnPrimary(instituteId, moduleEnabled, holistic));
    }

    private ObjectNode draftViewOnPrimary(String instituteId, boolean moduleEnabled, boolean holistic) {
        ObjectNode out = F.objectNode();
        out.put("module_enabled", moduleEnabled);
        out.put("holistic", holistic);
        Optional<LearnerHomeLayout> draft = layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                LearnerHomeLayout.DRAFT);
        out.set("draft", draft.<JsonNode>map(this::layoutJson).orElse(F.nullNode()));
        Optional<LearnerHomeLayout> pub = layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                LearnerHomeLayout.PUBLISHED);
        if (pub.isPresent()) {
            ObjectNode p = out.putObject("published");
            p.put("version", pub.get().getVersion());
            p.put("published_at", HomeWriter.instant(pub.get().getPublishedAt()));
            p.put("published_by", pub.get().getPublishedByUserId());
            // The published blocks in the editor's shape: the publish dialog diffs the draft against
            // them, and the results tab names blocks the draft has removed.
            List<Block> published = BlockMapper.fromEntities(
                    blockRepository.findByLayoutIdOrderByPositionAsc(pub.get().getId()), new ArrayList<>());
            p.put("block_count", published.size());
            ArrayNode arr = p.putArray("blocks");
            published.forEach(b -> arr.add(HomeWriter.block(b)));
        } else {
            out.putNull("published");
        }
        return out;
    }

    public ObjectNode versions(String instituteId) {
        return tx.execute(s -> versionsOnPrimary(instituteId));
    }

    private ObjectNode versionsOnPrimary(String instituteId) {
        List<LearnerHomeLayout> rows = layoutRepository.findVersions(instituteId, KEEP_ARCHIVED);
        Map<String, Long> counts = blockCounts(rows.stream().map(LearnerHomeLayout::getId).toList());
        ObjectNode out = F.objectNode();
        ArrayNode arr = out.putArray("versions");
        for (LearnerHomeLayout l : rows) {
            ObjectNode v = arr.addObject();
            v.put("version", l.getVersion());
            v.put("status", l.getStatus());
            v.put("published_at", HomeWriter.instant(l.getPublishedAt()));
            v.put("published_by", l.getPublishedByUserId());
            v.put("block_count", counts.getOrDefault(l.getId(), 0L));
        }
        return out;
    }

    private Map<String, Long> blockCounts(List<String> layoutIds) {
        Map<String, Long> out = new HashMap<>();
        if (layoutIds.isEmpty()) return out;
        for (Object[] row : blockRepository.countByLayout(layoutIds)) {
            out.put((String) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    ObjectNode layoutJson(LearnerHomeLayout l) {
        List<Issue> issues = new ArrayList<>();
        List<Block> blocks = BlockMapper.fromEntities(blockRepository.findByLayoutIdOrderByPositionAsc(l.getId()), issues);
        return layoutJson(l, BlockMapper.settings(l), blocks);
    }

    static ObjectNode layoutJson(LearnerHomeLayout l, Settings settings, List<Block> blocks) {
        ObjectNode o = F.objectNode();
        o.put("id", l.getId());
        o.put("status", l.getStatus());
        o.put("version", l.getVersion());
        if (l.getBaseVersion() == null) o.putNull("base_version");
        else o.put("base_version", l.getBaseVersion());
        o.put("revision", l.getRevision());
        o.put("template_key", l.getTemplateKey());
        o.set("settings", HomeWriter.settings(settings));
        ArrayNode arr = o.putArray("blocks");
        blocks.forEach(b -> arr.add(HomeWriter.block(b)));
        o.put("created_at", HomeWriter.instant(l.getCreatedAt()));
        o.put("updated_at", HomeWriter.instant(l.getUpdatedAt()));
        o.put("updated_by", l.getUpdatedByUserId());
        o.put("published_at", HomeWriter.instant(l.getPublishedAt()));
        o.put("published_by", l.getPublishedByUserId());
        return o;
    }

    // ── Draft lifecycle ─────────────────────────────────────────────────────

    public ObjectNode createDraft(String instituteId, String userId, JsonNode body) {
        String templateKey = body.hasNonNull("template_key") ? body.get("template_key").asText() : null;
        List<Issue> issues = new ArrayList<>();
        if (templateKey != null && !HomeModel.TEMPLATE_KEYS.contains(templateKey)) {
            issues.add(new Issue(null, "template_key", "INVALID_VALUE", "Unknown template_key"));
        }
        if (!issues.isEmpty()) throw LearnerHomeException.validation("VALIDATION_FAILED", issues, null);
        LayoutBody parsed = parseValid(instituteId, body, Set.of("template_key", "settings", "blocks"));
        return tx.execute(s -> {
            requireNoDraft(instituteId);
            LearnerHomeLayout layout = insertDraft(instituteId, userId, templateKey, null, parsed.settings(),
                    parsed.blocks());
            return layoutJson(layout, parsed.settings(), parsed.blocks());
        });
    }

    public ObjectNode createFromPublished(String instituteId, String userId) {
        return tx.execute(s -> {
            LearnerHomeLayout pub = layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                    LearnerHomeLayout.PUBLISHED).orElseThrow(() -> new LearnerHomeException(HttpStatus.NOT_FOUND,
                    "NO_PUBLISHED", "Nothing is published yet"));
            requireNoDraft(instituteId);
            return copyToDraft(instituteId, userId, pub);
        });
    }

    public ObjectNode restore(String instituteId, String userId, int version, boolean force) {
        return tx.execute(s -> {
            LearnerHomeLayout source = layoutRepository.findFirstByInstituteIdAndVersionAndStatusIn(instituteId,
                    version, List.of(LearnerHomeLayout.PUBLISHED, LearnerHomeLayout.ARCHIVED))
                    .orElseThrow(() -> new LearnerHomeException(HttpStatus.NOT_FOUND, "VERSION_NOT_FOUND",
                            "Version " + version + " is not kept any more"));
            Optional<LearnerHomeLayout> draft = layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                    LearnerHomeLayout.DRAFT);
            if (draft.isPresent()) {
                if (!force) {
                    throw new LearnerHomeException(HttpStatus.CONFLICT, "DRAFT_EXISTS",
                            "A draft exists; restore with force=true to replace it");
                }
                layoutRepository.deleteLayout(draft.get().getId());
            }
            return copyToDraft(instituteId, userId, source);
        });
    }

    private ObjectNode copyToDraft(String instituteId, String userId, LearnerHomeLayout source) {
        List<Issue> issues = new ArrayList<>();
        List<Block> blocks = BlockMapper.fromEntities(
                blockRepository.findByLayoutIdOrderByPositionAsc(source.getId()), issues);
        Settings settings = BlockMapper.settings(source);
        LearnerHomeLayout layout = insertDraft(instituteId, userId, source.getTemplateKey(), source.getVersion(),
                settings, blocks);
        return layoutJson(layout, settings, blocks);
    }

    private void requireNoDraft(String instituteId) {
        if (layoutRepository.findFirstByInstituteIdAndStatus(instituteId, LearnerHomeLayout.DRAFT).isPresent()) {
            throw new LearnerHomeException(HttpStatus.CONFLICT, "DRAFT_EXISTS", "A draft already exists");
        }
    }

    private LearnerHomeLayout insertDraft(String instituteId, String userId, String templateKey, Integer baseVersion,
                                          Settings settings, List<Block> blocks) {
        Instant now = clock.instant();
        LearnerHomeLayout layout = LearnerHomeLayout.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .status(LearnerHomeLayout.DRAFT)
                .version(0)
                .baseVersion(baseVersion)
                .revision(1)
                .templateKey(templateKey)
                .settingsJson(HomeWriter.toJson(HomeWriter.settings(settings)))
                .createdByUserId(userId)
                .updatedByUserId(userId)
                .createdAt(now)
                .updatedAt(now)
                .build();
        try {
            layoutRepository.saveAndFlush(layout);
        } catch (DataIntegrityViolationException e) {
            throw new LearnerHomeException(HttpStatus.CONFLICT, "DRAFT_EXISTS", "A draft already exists");
        }
        blockRepository.saveAllAndFlush(BlockMapper.toEntities(blocks, layout.getId(), instituteId, now));
        return layout;
    }

    public ObjectNode saveDraft(String instituteId, String userId, JsonNode body) {
        JsonNode rev = body.get("revision");
        if (rev == null || !rev.isIntegralNumber()) {
            throw LearnerHomeException.validation("VALIDATION_FAILED",
                    List.of(new Issue(null, "revision", "REQUIRED", "revision is required")), null);
        }
        int revision = rev.asInt();
        LayoutBody parsed = parseValid(instituteId, body, Set.of("revision", "settings", "blocks"));
        return tx.execute(s -> {
            LearnerHomeLayout draft = layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                    LearnerHomeLayout.DRAFT).orElseThrow(() -> new LearnerHomeException(HttpStatus.NOT_FOUND,
                    "NO_DRAFT", "There is no draft"));
            int updated = layoutRepository.bumpDraftRevision(draft.getId(), revision, userId,
                    HomeWriter.toJson(HomeWriter.settings(parsed.settings())));
            if (updated == 0) {
                throw stale(layoutRepository.draftState(draft.getId()), draft);
            }
            blockRepository.deleteByLayout(draft.getId());
            blockRepository.saveAllAndFlush(BlockMapper.toEntities(parsed.blocks(), draft.getId(), instituteId,
                    clock.instant()));
            LearnerHomeLayout saved = layoutRepository.findById(draft.getId()).orElseThrow();
            ObjectNode out = F.objectNode();
            out.put("revision", saved.getRevision());
            out.put("updated_at", HomeWriter.instant(saved.getUpdatedAt()));
            out.set("layout", layoutJson(saved, parsed.settings(), parsed.blocks()));
            return out;
        });
    }

    private static LearnerHomeException stale(LearnerHomeLayout current) {
        return new LearnerHomeException(HttpStatus.CONFLICT, "STALE_DRAFT", "Someone else saved this draft")
                .with("revision", current.getRevision())
                .with("updated_by", current.getUpdatedByUserId())
                .with("updated_at", HomeWriter.instant(current.getUpdatedAt()));
    }

    /** From a (revision, updated_by_user_id, updated_at) row; falls back to the entity when the row is gone. */
    private static LearnerHomeException stale(List<Object[]> state, LearnerHomeLayout fallback) {
        if (state == null || state.isEmpty()) {
            return stale(fallback);
        }
        Object[] row = state.get(0);
        return new LearnerHomeException(HttpStatus.CONFLICT, "STALE_DRAFT", "Someone else saved this draft")
                .with("revision", ((Number) row[0]).intValue())
                .with("updated_by", row[1])
                .with("updated_at", toInstantString(row[2]));
    }

    static String toInstantString(Object value) {
        if (value == null) return null;
        if (value instanceof Instant i) return i.toString();
        if (value instanceof java.sql.Timestamp t) return t.toInstant().toString();
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant().toString();
        return value.toString();
    }

    public void deleteDraft(String instituteId) {
        tx.executeWithoutResult(s -> layoutRepository.findFirstByInstituteIdAndStatus(instituteId,
                LearnerHomeLayout.DRAFT).ifPresent(d -> layoutRepository.deleteLayout(d.getId())));
    }

    // ── Publish ─────────────────────────────────────────────────────────────

    public ObjectNode publishChecks(String instituteId) {
        List<Block> blocks = tx.execute(s -> {
            LearnerHomeLayout draft = requireDraft(instituteId);
            return BlockMapper.fromEntities(blockRepository.findByLayoutIdOrderByPositionAsc(draft.getId()),
                    new ArrayList<>());
        });
        PublishChecks.Result r = publishChecks.check(instituteId, blocks, clock.instant());
        ObjectNode out = F.objectNode();
        out.set("errors", HomeWriter.MAPPER.valueToTree(r.errors()));
        out.set("warnings", HomeWriter.MAPPER.valueToTree(r.warnings()));
        return out;
    }

    private LearnerHomeLayout requireDraft(String instituteId) {
        return layoutRepository.findFirstByInstituteIdAndStatus(instituteId, LearnerHomeLayout.DRAFT)
                .orElseThrow(() -> new LearnerHomeException(HttpStatus.NOT_FOUND, "NO_DRAFT", "There is no draft"));
    }

    /** The draft and its blocks, read on the primary. */
    private record DraftRead(LearnerHomeLayout draft, List<Block> blocks, List<Issue> unreadable) {
    }

    public ObjectNode publish(String instituteId, String userId, int revision) {
        DraftRead read = tx.execute(s -> {
            LearnerHomeLayout d = requireDraft(instituteId);
            List<Issue> bad = new ArrayList<>();
            return new DraftRead(d, BlockMapper.fromEntities(blockRepository.findByLayoutIdOrderByPositionAsc(d.getId()),
                    bad), bad);
        });
        LearnerHomeLayout draft = read.draft();
        if (draft.getRevision() != revision) {
            throw stale(draft);
        }
        List<Issue> unreadable = read.unreadable();
        List<Block> blocks = read.blocks();
        Settings settings = BlockMapper.settings(draft);
        PublishChecks.Result checks = publishChecks.check(instituteId, blocks, clock.instant());
        if (!unreadable.isEmpty() || !checks.errors().isEmpty()) {
            List<Issue> errors = new ArrayList<>(unreadable);
            errors.addAll(checks.errors());
            throw LearnerHomeException.validation("PUBLISH_CHECKS_FAILED", errors, checks.warnings());
        }
        List<Issue> warnings = new ArrayList<>(checks.warnings());
        // Image work happens before the transaction, so no lock is held while the media service works.
        List<Block> prepared = mediaService.prepare(instituteId, blocks, warnings);

        Integer version = tx.execute(s -> {
            List<Object[]> state = layoutRepository.lockDraftState(draft.getId());
            if (state.isEmpty()) {
                throw new LearnerHomeException(HttpStatus.NOT_FOUND, "NO_DRAFT", "There is no draft");
            }
            if (((Number) state.get(0)[0]).intValue() != revision) {
                throw stale(state, draft);
            }
            LearnerHomeLayout locked = draft;
            Instant now = clock.instant();
            layoutRepository.archivePublished(instituteId);
            int next = layoutRepository.maxVersion(instituteId) + 1;
            LearnerHomeLayout pub = LearnerHomeLayout.builder()
                    .id(UUID.randomUUID().toString())
                    .instituteId(instituteId)
                    .status(LearnerHomeLayout.PUBLISHED)
                    .version(next)
                    .baseVersion(locked.getBaseVersion())
                    .revision(locked.getRevision())
                    .templateKey(locked.getTemplateKey())
                    .settingsJson(HomeWriter.toJson(HomeWriter.settings(settings)))
                    .createdByUserId(locked.getCreatedByUserId())
                    .updatedByUserId(userId)
                    .publishedByUserId(userId)
                    .publishedAt(now)
                    .createdAt(now)
                    .updatedAt(now)
                    .build();
            layoutRepository.saveAndFlush(pub);
            blockRepository.saveAllAndFlush(BlockMapper.toEntities(prepared, pub.getId(), instituteId, now));
            layoutRepository.deleteLayout(locked.getId());
            layoutRepository.pruneArchived(instituteId, KEEP_ARCHIVED);
            layoutCache.evict(instituteId);
            return next;
        });
        layoutCache.evict(instituteId);
        ObjectNode out = F.objectNode();
        out.put("version", version == null ? 0 : version);
        out.set("warnings", HomeWriter.MAPPER.valueToTree(warnings));
        return out;
    }

    public void unpublish(String instituteId) {
        tx.executeWithoutResult(s -> {
            layoutRepository.archivePublished(instituteId);
            layoutRepository.pruneArchived(instituteId, KEEP_ARCHIVED);
            layoutCache.evict(instituteId);
        });
        layoutCache.evict(instituteId);
    }

    // ── Preview ─────────────────────────────────────────────────────────────

    public ObjectNode preview(String instituteId, JsonNode body) {
        List<Issue> issues = new ArrayList<>();
        allowOnly(body, Set.of("source", "blocks", "settings", "as", "device", "at"), issues);
        String source = body.hasNonNull("source") ? body.get("source").asText() : "DRAFT";
        LearnerHomeResolver.PreviewAs as = previewAs(body.get("as"), issues);
        Devices device = null;
        if (body.hasNonNull("device")) {
            String d = body.get("device").asText();
            if ("PHONE".equals(d)) device = Devices.PHONE;
            else if ("DESKTOP".equals(d)) device = Devices.DESKTOP;
            else issues.add(new Issue(null, "device", "INVALID_VALUE", "device must be PHONE or DESKTOP"));
        }
        Instant at = null;
        if (body.hasNonNull("at")) {
            at = HomeParser.parseInstant(body.get("at").asText());
            if (at == null) issues.add(new Issue(null, "at", "INVALID_VALUE", "at must be an instant"));
        }
        Settings settings;
        List<Block> blocks;
        int version;
        switch (source) {
            case "INLINE" -> {
                HomeParser parser = new HomeParser(issues);
                LayoutBody parsed = parser.parseLayout(body.get("settings"), body.get("blocks"));
                // Layout rules (HERO, limits) are the editor's business while drafting; shape errors are not.
                issues.removeIf(i -> i.blockKey() == null && "blocks".equals(i.path())
                        && ("HERO_REQUIRED".equals(i.code()) || "TOO_MANY".equals(i.code())));
                settings = parsed.settings();
                blocks = parsed.blocks();
                version = 0;
            }
            case "DRAFT", "PUBLISHED" -> {
                if (body.hasNonNull("blocks") || body.hasNonNull("settings")) {
                    issues.add(new Issue(null, "blocks", "INVALID_VALUE", "blocks and settings are for source INLINE"));
                }
                String status = "DRAFT".equals(source) ? LearnerHomeLayout.DRAFT : LearnerHomeLayout.PUBLISHED;
                DraftRead read = tx.execute(s -> {
                    LearnerHomeLayout l = layoutRepository.findFirstByInstituteIdAndStatus(instituteId, status)
                            .orElseThrow(() -> new LearnerHomeException(HttpStatus.NOT_FOUND,
                                    "DRAFT".equals(source) ? "NO_DRAFT" : "NO_PUBLISHED", "Nothing to preview"));
                    return new DraftRead(l, BlockMapper.fromEntities(
                            blockRepository.findByLayoutIdOrderByPositionAsc(l.getId()), new ArrayList<>()), List.of());
                });
                settings = BlockMapper.settings(read.draft());
                blocks = read.blocks();
                version = read.draft().getVersion();
            }
            default -> {
                issues.add(new Issue(null, "source", "INVALID_VALUE", "source must be DRAFT, PUBLISHED or INLINE"));
                settings = Settings.DEFAULT;
                blocks = List.of();
                version = 0;
            }
        }
        if (!issues.isEmpty()) {
            throw LearnerHomeException.validation("VALIDATION_FAILED", issues, null);
        }
        return resolver.preview(instituteId, version, settings, blocks, as, device, at);
    }

    private static LearnerHomeResolver.PreviewAs previewAs(JsonNode node, List<Issue> issues) {
        if (node == null || node.isNull()) return LearnerHomeResolver.PreviewAs.NOBODY;
        if (!node.isObject()) {
            issues.add(new Issue(null, "as", "INVALID_TYPE", "as must be an object"));
            return LearnerHomeResolver.PreviewAs.NOBODY;
        }
        allowOnly(node, Set.of("package_session_ids", "user_tag_ids"), issues);
        return new LearnerHomeResolver.PreviewAs(ids(node.get("package_session_ids"), "as.package_session_ids", issues),
                ids(node.get("user_tag_ids"), "as.user_tag_ids", issues));
    }

    private static List<String> ids(JsonNode node, String path, List<Issue> issues) {
        List<String> out = new ArrayList<>();
        if (node == null || node.isNull()) return out;
        if (!node.isArray() || node.size() > HomeParser.MAX_CONDITION_IDS) {
            issues.add(new Issue(null, path, "INVALID_VALUE", "Expected an array of at most 200 ids"));
            return out;
        }
        for (JsonNode n : node) {
            if (n.isTextual() && !n.asText().isBlank()) out.add(n.asText().trim());
        }
        return out;
    }
}
