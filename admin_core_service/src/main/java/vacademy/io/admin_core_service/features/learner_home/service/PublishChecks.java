package vacademy.io.admin_core_service.features.learner_home.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_home.model.HomeImages;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerFacts;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.LiveInfo;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.PackageInfo;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Publish checks (spec 6.6). Errors block publish; warnings are shown and publish goes on.
 * The audience ownership part also runs on every draft save.
 */
@Slf4j
@Component
public class PublishChecks {

    public record Result(List<Issue> errors, List<Issue> warnings) {
    }

    private final LearnerHomeJdbc jdbc;
    private final LinkMetaService linkMeta;
    private final ShelfResolver shelfResolver;

    public PublishChecks(LearnerHomeJdbc jdbc, LinkMetaService linkMeta, ShelfResolver shelfResolver) {
        this.jdbc = jdbc;
        this.linkMeta = linkMeta;
        this.shelfResolver = shelfResolver;
    }

    public Result check(String instituteId, List<Block> blocks, Instant now) {
        List<Issue> errors = new ArrayList<>();
        List<Issue> warnings = new ArrayList<>();
        HomeParser.checkLayoutRules(blocks, errors);
        contentChecks(blocks, now, errors, warnings);
        audienceChecks(instituteId, blocks, errors, warnings);
        linkChecks(instituteId, blocks, now, errors, warnings);
        shelfChecks(instituteId, blocks, warnings);
        return new Result(errors, warnings);
    }

    // ── Content (pure) ──────────────────────────────────────────────────────

    public static void contentChecks(List<Block> blocks, Instant now, List<Issue> errors, List<Issue> warnings) {
        for (Block b : blocks) {
            String k = b.blockKey();
            if (b.endsAt() != null && !now.isBefore(b.endsAt())) {
                warnings.add(new Issue(k, "ends_at", "BLOCK_ENDED", "This block's schedule has already ended"));
            }
            if (!b.audience().everyone()) {
                if (b.audience().allOf().isEmpty()) {
                    errors.add(new Issue(k, "audience.all_of", "REQUIRED", "Add at least one condition, or show it to everyone"));
                }
                for (int i = 0; i < b.audience().allOf().size(); i++) {
                    if (b.audience().allOf().get(i).ids().isEmpty()) {
                        errors.add(new Issue(k, "audience.all_of[" + i + "]", "REQUIRED", "Pick at least one item"));
                    }
                }
            }
            if (b.builtinWidget() != null && b.builtinWidget().hiddenInFunSkin) {
                warnings.add(new Issue(k, "builtin_widget", "NOT_IN_FUN_SKIN", "Not shown in the Fun look"));
            }
            switch (b.type()) {
                case BANNER_CAROUSEL -> banner(k, (BannerConfig) b.config(), now, errors, warnings);
                case SHORTCUTS -> shortcuts(k, (ShortcutsConfig) b.config(), errors);
                case COURSE_SHELF -> shelf(k, (ShelfConfig) b.config(), errors);
                case NOTICE -> notice(k, (NoticeConfig) b.config(), errors);
                case EVENT -> event(k, (EventConfig) b.config(), errors);
                case BUILTIN -> {
                }
            }
            for (ImageSlotRef img : HomeImages.images(b)) {
                ImageRef i = img.image();
                if (!i.decorative() && (i.alt() == null || i.alt().isBlank())) {
                    errors.add(new Issue(k, img.path() + ".alt", "ALT_REQUIRED",
                            "Describe the image for screen readers, or mark it decorative"));
                }
                if (i.fileId() == null) {
                    errors.add(new Issue(k, img.path() + ".file_id", "REQUIRED", "Upload the image"));
                }
            }
            for (LinkRef ref : LinkMetaService.links(b)) {
                LinkTarget l = ref.link();
                if (incomplete(l)) {
                    errors.add(new Issue(k, ref.path(), "LINK_INCOMPLETE", "Pick where this link goes"));
                } else if (l.kind() == LinkKind.FEATURE && l.feature().conditional) {
                    warnings.add(new Issue(k, ref.path(), "FEATURE_CONDITIONAL",
                            "Shown only to learners who have this feature"));
                } else if (l.kind() == LinkKind.ASSESSMENT) {
                    warnings.add(new Issue(k, ref.path(), "ASSESSMENT_NOT_VERIFIED",
                            "Make sure this assessment exists and learners can open it"));
                }
            }
        }
    }

    static boolean incomplete(LinkTarget l) {
        return switch (l.kind()) {
            case COURSE -> l.packageId() == null;
            case COURSE_LIST -> false;
            case PRODUCT_PAGE -> l.code() == null;
            case LIVE_CLASS -> l.sessionId() == null;
            case ASSESSMENT -> l.assessmentId() == null;
            case FEATURE -> l.feature() == null;
            case URL -> l.url() == null;
            case APP_PATH -> l.path() == null;
        };
    }

    private static void banner(String k, BannerConfig c, Instant now, List<Issue> errors, List<Issue> warnings) {
        if (c.slides().isEmpty()) {
            errors.add(new Issue(k, "config.slides", "TOO_FEW", "Add at least one slide"));
            return;
        }
        if (c.slides().size() > 3) {
            warnings.add(new Issue(k, "config.slides", "MANY_SLIDES", "Slides after the third get few views"));
        }
        boolean allEnded = true;
        for (int i = 0; i < c.slides().size(); i++) {
            Slide s = c.slides().get(i);
            if (s.image() == null) {
                errors.add(new Issue(k, "config.slides[" + i + "].image", "REQUIRED", "Add the slide image"));
            }
            if (s.endsAt() == null || now.isBefore(s.endsAt())) allEnded = false;
        }
        if (allEnded) {
            errors.add(new Issue(k, "config.slides", "ALL_SLIDES_ENDED", "Every slide's schedule has ended"));
        }
    }

    private static void shortcuts(String k, ShortcutsConfig c, List<Issue> errors) {
        if (c.tiles().isEmpty()) {
            errors.add(new Issue(k, "config.tiles", "TOO_FEW", "Add at least one shortcut"));
        }
        for (int i = 0; i < c.tiles().size(); i++) {
            Tile t = c.tiles().get(i);
            String p = "config.tiles[" + i + "]";
            if (t.label() == null || t.label().isBlank()) {
                errors.add(new Issue(k, p + ".label", "REQUIRED", "Add a label"));
            }
            if (t.link() == null) {
                errors.add(new Issue(k, p + ".link", "REQUIRED", "Pick where this shortcut goes"));
            }
            TileIcon icon = t.icon();
            if (icon == null || ("ICON".equals(icon.kind()) && icon.name() == null)
                    || ("IMAGE".equals(icon.kind()) && icon.image() == null)) {
                errors.add(new Issue(k, p + ".icon", "REQUIRED", "Pick an icon or an image"));
            }
        }
    }

    private static void shelf(String k, ShelfConfig c, List<Issue> errors) {
        if (c.title() == null || c.title().isBlank()) {
            errors.add(new Issue(k, "config.title", "REQUIRED", "Add a title"));
        }
        if (c.source() == ShelfSource.TAG && c.tags().isEmpty()) {
            errors.add(new Issue(k, "config.tags", "TOO_FEW", "Pick at least one course tag"));
        }
        if (c.source() == ShelfSource.HAND_PICKED && c.packageIds().isEmpty()) {
            errors.add(new Issue(k, "config.package_ids", "TOO_FEW", "Pick at least one course"));
        }
    }

    private static void notice(String k, NoticeConfig c, List<Issue> errors) {
        if (c.title() == null || c.title().isBlank()) {
            errors.add(new Issue(k, "config.title", "REQUIRED", "Add a title"));
        }
        cta(k, "config.button", c.button(), errors);
    }

    private static void event(String k, EventConfig c, List<Issue> errors) {
        if (c.source() == EventSource.CUSTOM) {
            if (c.title() == null || c.title().isBlank()) {
                errors.add(new Issue(k, "config.title", "REQUIRED", "Add a title"));
            }
            if (c.startsAt() == null) errors.add(new Issue(k, "config.starts_at", "REQUIRED", "Set the start time"));
            if (c.endsAt() == null) errors.add(new Issue(k, "config.ends_at", "REQUIRED", "Set the end time"));
        } else if (c.liveSessionId() == null) {
            errors.add(new Issue(k, "config.live_session_id", "REQUIRED", "Pick the live class"));
        }
        cta(k, "config.register_cta", c.registerCta(), errors);
        cta(k, "config.join_cta", c.joinCta(), errors);
    }

    private static void cta(String k, String path, Cta cta, List<Issue> errors) {
        if (cta == null) return;
        if (cta.label() == null || cta.label().isBlank()) {
            errors.add(new Issue(k, path + ".label", "REQUIRED", "Add the button text"));
        }
        if (cta.link() == null) {
            errors.add(new Issue(k, path + ".link", "REQUIRED", "Pick where the button goes"));
        }
    }

    // ── Audience ids (also on every save) ───────────────────────────────────

    /** Ids of another institute are errors; ids that exist nowhere are warnings (they match nobody). */
    public void audienceChecks(String instituteId, List<Block> blocks, List<Issue> errors, List<Issue> warnings) {
        Set<String> batches = new LinkedHashSet<>();
        Set<String> packages = new LinkedHashSet<>();
        Set<String> tags = new LinkedHashSet<>();
        for (Block b : blocks) {
            for (Condition c : b.audience().allOf()) {
                switch (c.kind()) {
                    case PACKAGE_SESSION -> batches.addAll(c.ids());
                    case ENROLLED_IN_COURSE, NOT_ENROLLED_IN_COURSE -> packages.addAll(c.ids());
                    case USER_TAG -> tags.addAll(c.ids());
                }
            }
        }
        if (batches.isEmpty() && packages.isEmpty() && tags.isEmpty()) {
            return;
        }
        Map<String, Ownership> batchOwn = ownership(jdbc.batchOwners(batches), instituteId, false);
        Map<String, Ownership> packageOwn = ownership(jdbc.packageOwners(packages), instituteId, false);
        Map<String, Ownership> tagOwn = ownership(jdbc.tagOwners(tags), instituteId, true);
        for (Block b : blocks) {
            List<Condition> rows = b.audience().allOf();
            for (int i = 0; i < rows.size(); i++) {
                Condition c = rows.get(i);
                Map<String, Ownership> own = switch (c.kind()) {
                    case PACKAGE_SESSION -> batchOwn;
                    case ENROLLED_IN_COURSE, NOT_ENROLLED_IN_COURSE -> packageOwn;
                    case USER_TAG -> tagOwn;
                };
                for (String id : c.ids()) {
                    Ownership o = own.getOrDefault(id, Ownership.MISSING);
                    String path = "audience.all_of[" + i + "]";
                    if (o == Ownership.OTHER) {
                        errors.add(new Issue(b.blockKey(), path, "OTHER_INSTITUTE",
                                "An id in this condition belongs to another institute: " + id));
                    } else if (o == Ownership.MISSING) {
                        warnings.add(new Issue(b.blockKey(), path, "AUDIENCE_ID_MISSING",
                                "An item in this condition no longer exists: " + id));
                    }
                }
            }
        }
    }

    enum Ownership { OURS, OTHER, MISSING }

    /** Tags with no institute are platform defaults and count as ours. */
    static Map<String, Ownership> ownership(List<LearnerHomeJdbc.Owner> rows, String instituteId,
                                            boolean nullInstituteIsShared) {
        Map<String, Ownership> out = new HashMap<>();
        for (LearnerHomeJdbc.Owner row : rows) {
            boolean ours = instituteId.equals(row.instituteId())
                    || (nullInstituteIsShared && row.instituteId() == null);
            if (ours) {
                out.put(row.id(), Ownership.OURS);
            } else {
                out.putIfAbsent(row.id(), row.instituteId() == null ? Ownership.MISSING : Ownership.OTHER);
            }
        }
        return out;
    }

    // ── Link targets ────────────────────────────────────────────────────────

    void linkChecks(String instituteId, List<Block> blocks, Instant now, List<Issue> errors, List<Issue> warnings) {
        LinkMetaService.LinkMeta meta = linkMeta.loadMeta(instituteId, blocks);
        Set<String> handPicked = new LinkedHashSet<>();
        blocks.forEach(b -> {
            if (b.config() instanceof ShelfConfig s && s.source() == ShelfSource.HAND_PICKED) {
                handPicked.addAll(s.packageIds());
            }
        });
        Map<String, PackageInfo> picked = handPicked.isEmpty() ? Map.of() : linkMeta.packages(instituteId, handPicked);
        Set<String> sessionIds = LinkMetaService.liveSessionIds(blocks);
        Map<String, LiveInfo> live = sessionIds.isEmpty() ? Map.of() : linkMeta.live(sessionIds);
        for (Block b : blocks) {
            String k = b.blockKey();
            for (LinkRef ref : LinkMetaService.links(b)) {
                LinkTarget l = ref.link();
                if (incomplete(l)) continue;
                switch (l.kind()) {
                    case COURSE -> packageIssue(k, ref.path(), meta.packages().get(l.packageId()), errors);
                    case PRODUCT_PAGE -> {
                        LinkMetaService.PageInfo page = meta.productPages().get(l.code());
                        if (page == null || !instituteId.equals(page.instituteId())) {
                            errors.add(new Issue(k, ref.path(), "LINK_TARGET_MISSING", "This product page does not exist"));
                        } else if (!"ACTIVE".equals(page.status())) {
                            errors.add(new Issue(k, ref.path(), "LINK_TARGET_INACTIVE", "This product page is not active"));
                        }
                    }
                    case LIVE_CLASS -> liveIssue(k, ref.path(), live.get(l.sessionId()), instituteId, now, errors);
                    default -> {
                    }
                }
            }
            if (b.config() instanceof EventConfig e && e.source() == EventSource.LIVE_SESSION
                    && e.liveSessionId() != null) {
                liveIssue(k, "config.live_session_id", live.get(e.liveSessionId()), instituteId, now, errors);
            }
            if (b.config() instanceof ShelfConfig s && s.source() == ShelfSource.HAND_PICKED) {
                for (int i = 0; i < s.packageIds().size(); i++) {
                    packageIssue(k, "config.package_ids[" + i + "]", picked.get(s.packageIds().get(i)), errors);
                }
            }
        }
    }

    private static void packageIssue(String k, String path, PackageInfo p, List<Issue> errors) {
        if (p == null || !p.inInstitute()) {
            errors.add(new Issue(k, path, "LINK_TARGET_MISSING", "This course does not exist in your institute"));
        } else if (!"ACTIVE".equals(p.status())) {
            errors.add(new Issue(k, path, "LINK_TARGET_INACTIVE", "This course is not active"));
        }
    }

    private static void liveIssue(String k, String path, LiveInfo info, String instituteId, Instant now,
                                  List<Issue> errors) {
        if (info == null || !instituteId.equals(info.instituteId())) {
            errors.add(new Issue(k, path, "LINK_TARGET_MISSING", "This live class does not exist"));
        } else if (!info.availableFor(instituteId, now)) {
            errors.add(new Issue(k, path, "LINK_TARGET_INACTIVE",
                    "This live class is not public, not published, or has no upcoming session"));
        }
    }

    // ── Shelves ─────────────────────────────────────────────────────────────

    void shelfChecks(String instituteId, List<Block> blocks, List<Issue> warnings) {
        for (Block b : blocks) {
            if (!(b.config() instanceof ShelfConfig s)) continue;
            if ((s.source() == ShelfSource.TAG && s.tags().isEmpty())
                    || (s.source() == ShelfSource.HAND_PICKED && s.packageIds().isEmpty())) {
                continue;
            }
            try {
                ShelfConfig showAll = new ShelfConfig(s.title(), s.source(), s.tags(), s.packageIds(), s.limit(),
                        false, s.showPrice(), s.seeAll());
                if (ShelfResolver.forLearner(shelfResolver.candidates(instituteId, b.blockKey(), -1, s), showAll,
                        LearnerFacts.EMPTY).isEmpty()) {
                    warnings.add(new Issue(b.blockKey(), "config", "SHELF_EMPTY_NOW",
                            "No course matches this shelf right now, so learners will not see it"));
                }
            } catch (RuntimeException e) {
                log.warn("[learner-home] shelf check failed for {}: {}", instituteId, e.getMessage());
                warnings.add(new Issue(b.blockKey(), "config", "SHELF_CHECK_FAILED", "The courses could not be checked"));
            }
        }
    }
}
