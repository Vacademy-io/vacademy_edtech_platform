package vacademy.io.admin_core_service.features.learner_home.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Typed form of a learner home layout. Built by {@link HomeParser} from the editor's JSON (which
 * rejects unknown keys) and written back by {@link HomeWriter}; the stored JSON is always the
 * writer's normalised output.
 */
public final class HomeModel {

    private HomeModel() {
    }

    public static final int SCHEMA_VERSION = 1;

    public enum BlockType { BANNER_CAROUSEL, SHORTCUTS, COURSE_SHELF, NOTICE, EVENT, BUILTIN }

    public enum Placement { FULL, MAIN, RAIL }

    public enum Devices { BOTH, PHONE, DESKTOP }

    public enum LinkKind { COURSE, COURSE_LIST, PRODUCT_PAGE, LIVE_CLASS, ASSESSMENT, FEATURE, URL, APP_PATH }

    public enum Feature {
        COURSES(false), LIVE_CLASSES(false), ASSESSMENTS(false), REPORTS(false), HOMEWORK(true),
        ATTENDANCE(false), NOTEBOOK(true), DOUBTS(true), REFERRAL(true), MENTORS(false), DAILY_TASKS(true),
        AI_CHAT(true), DOWNLOADS(true), MY_FILES(false), LEADERBOARD(true), PROFILE(false), NOTIFICATIONS(false),
        STORE_MEMBERSHIPS(true), STORE_BOOKS(true);

        /** Shown only when a per-learner or per-institute condition holds; checked by the learner app. */
        public final boolean conditional;

        Feature(boolean conditional) {
            this.conditional = conditional;
        }

        public boolean isStore() {
            return this == STORE_MEMBERSHIPS || this == STORE_BOOKS;
        }
    }

    public enum BuiltinWidget {
        HERO(false), PINS(false), NOTEBOOK_REVIEW(false), COMPANIONS(false), TODAY_TASKS(true),
        CONTINUE_LEARNING(false), ENROLLED_COURSES(false), STATS_ROW(true), LEARNING_ANALYTICS(true),
        MY_MEMBERSHIP(true), MY_BOOKS(true), MY_ORDERS(true), UPCOMING_LIVE_CLASSES(true),
        THIS_WEEK_ATTENDANCE(true), MY_MENTORS(true), GET_APP(true), GAMIFICATION(true), RAISE_QUERY(false),
        EXPLORE_BUTTONS(false);

        /** The Fun skin's home leaves this widget out (FUN_HOME_LEAVES_OUT in the learner app). */
        public final boolean hiddenInFunSkin;

        BuiltinWidget(boolean hiddenInFunSkin) {
            this.hiddenInFunSkin = hiddenInFunSkin;
        }
    }

    /** Curated shortcut icons (phosphor component names). The two apps keep a copy of this list. */
    public enum ShortcutIcon {
        Books, BookOpen, Notebook, Megaphone, VideoCamera, PlayCircle, Broadcast, Exam, ClipboardText, Trophy,
        Medal, Certificate, Calendar, CalendarCheck, ChatCircle, ChatsCircle, Question, Download, Folder, Users,
        UserCircle, Student, ChalkboardTeacher, Gift, ShoppingCart, Storefront, Star, Bell, MapPin, Phone,
        WhatsappLogo, TelegramLogo, YoutubeLogo, InstagramLogo, Globe, Lightning, Target, ChartBar, Robot,
        GraduationCap
    }

    public enum ShelfSource { TAG, HAND_PICKED, NEWEST, FREE }

    public enum Tone { NEUTRAL, INFO, SUCCESS, WARNING }

    public enum EventSource { CUSTOM, LIVE_SESSION }

    public enum ConditionKind { PACKAGE_SESSION, ENROLLED_IN_COURSE, NOT_ENROLLED_IN_COURSE, USER_TAG }

    public enum PhoneSpacing { COMPACT, COMFORTABLE }

    public enum StatsCard { COURSES, LIVE_CLASSES, EVALUATIONS }

    /** Paths the learner app blocks in iOS / Mac App Store reader mode (commerce). */
    public static final List<String> READER_BLOCKED_PREFIXES = List.of("/courses", "/product-pages",
            "/admission/payment", "/pay", "/payment-result", "/sub-org-registration", "/parent/payment");

    public static boolean isReaderBlockedPath(String path) {
        if (path == null) return false;
        String p = path;
        int cut = indexOfAny(p, '?', '#');
        if (cut >= 0) p = p.substring(0, cut);
        for (String prefix : READER_BLOCKED_PREFIXES) {
            if (p.equals(prefix) || p.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    private static int indexOfAny(String s, char a, char b) {
        int i = s.indexOf(a);
        int j = s.indexOf(b);
        if (i < 0) return j;
        if (j < 0) return i;
        return Math.min(i, j);
    }

    // ── Value types ─────────────────────────────────────────────────────────

    public record ImageRef(String fileId, String alt, boolean decorative, String url, Integer width, Integer height,
                           Map<String, String> renditions) {

        public ImageRef withMedia(String newUrl, Integer newWidth, Integer newHeight, Map<String, String> newRenditions) {
            return new ImageRef(fileId, alt, decorative, newUrl, newWidth, newHeight, newRenditions);
        }
    }

    /** One link target. Only the fields of its kind are set. */
    public record LinkTarget(LinkKind kind, String packageId, String tag, String code, String sessionId,
                             String assessmentId, Feature feature, String url, Boolean sellsSomething, String path) {

        public static LinkTarget courseList(String tag) {
            return new LinkTarget(LinkKind.COURSE_LIST, null, tag, null, null, null, null, null, null, null);
        }

        public static LinkTarget course(String packageId) {
            return new LinkTarget(LinkKind.COURSE, packageId, null, null, null, null, null, null, null, null);
        }

        public static LinkTarget liveClass(String sessionId) {
            return new LinkTarget(LinkKind.LIVE_CLASS, null, null, null, sessionId, null, null, null, null, null);
        }
    }

    public record Cta(String label, LinkTarget link) {
    }

    public record Condition(ConditionKind kind, List<String> ids) {
    }

    /** {@code allOf} empty and {@code everyone} true = EVERYONE. */
    public record Audience(boolean everyone, List<Condition> allOf) {
        public static final Audience EVERYONE = new Audience(true, List.of());

        public boolean usesTags() {
            return !everyone && allOf.stream().anyMatch(c -> c.kind() == ConditionKind.USER_TAG);
        }
    }

    // ── Block configs ───────────────────────────────────────────────────────

    public sealed interface BlockConfig permits BannerConfig, ShortcutsConfig, ShelfConfig, NoticeConfig,
            EventConfig, BuiltinConfig {
    }

    public record Slide(String key, ImageRef image, ImageRef desktopImage, LinkTarget link, Instant startsAt,
                        Instant endsAt) {
    }

    public record BannerConfig(String title, boolean autoRotate, List<Slide> slides) implements BlockConfig {
    }

    /** {@code kind} ICON (name set) or IMAGE (image set). */
    public record TileIcon(String kind, ShortcutIcon name, ImageRef image) {
    }

    public record Tile(String key, String label, TileIcon icon, LinkTarget link) {
    }

    public record ShortcutsConfig(String title, List<Tile> tiles) implements BlockConfig {
    }

    public record ShelfConfig(String title, ShelfSource source, List<String> tags, List<String> packageIds, int limit,
                              boolean hideOwned, boolean showPrice, LinkTarget seeAll) implements BlockConfig {
    }

    public record NoticeConfig(String title, String body, ImageRef image, Cta button, Tone tone, boolean dismissible,
                               boolean requireAck, String ackLabel) implements BlockConfig {
    }

    public record EventConfig(String title, String subtitle, ImageRef image, EventSource source, String liveSessionId,
                              Instant startsAt, Instant endsAt, Cta registerCta, Cta joinCta, int joinOpensMinutes,
                              boolean showCountdown) implements BlockConfig {
    }

    /** Options already validated per widget; kept as plain JSON-compatible values. */
    public record BuiltinConfig(Map<String, Object> options) implements BlockConfig {
    }

    public record Block(String blockKey, BlockType type, BuiltinWidget builtinWidget, Placement placement,
                        Devices devices, boolean enabled, String adminLabel, Instant startsAt, Instant endsAt,
                        Audience audience, BlockConfig config) {

        public boolean inWindow(Instant now) {
            return (startsAt == null || !now.isBefore(startsAt)) && (endsAt == null || now.isBefore(endsAt));
        }

        public Block withConfig(BlockConfig newConfig) {
            return new Block(blockKey, type, builtinWidget, placement, devices, enabled, adminLabel, startsAt, endsAt,
                    audience, newConfig);
        }
    }

    public record Settings(PhoneSpacing phoneSpacing, boolean showHeader, boolean carouselAutoplayDefault) {
        public static final Settings DEFAULT = new Settings(PhoneSpacing.COMPACT, true, true);
    }

    /** A parsed layout body (draft save, create, inline preview). */
    public record LayoutBody(Settings settings, List<Block> blocks) {
    }

    /** Every link inside a block, with the JSON path it sits at. */
    public record LinkRef(String path, LinkTarget link) {
    }

    /** Every image inside a block, with the JSON path it sits at and its slot. */
    public record ImageSlotRef(String path, ImageRef image, String slot) {
    }

    public static final Set<String> TEMPLATE_KEYS = Set.of("COURSES_ONLY", "CLASSROOM", "STOREFRONT", "CURRENT", "BLANK");
}
