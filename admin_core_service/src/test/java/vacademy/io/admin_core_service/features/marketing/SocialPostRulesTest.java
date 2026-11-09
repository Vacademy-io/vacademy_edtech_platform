package vacademy.io.admin_core_service.features.marketing;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostMediaDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostRequest;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostJson;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostRules;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostRules.ActionOutcome;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostRules.PostInput;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.marketing.MarketingConstants.*;

class SocialPostRulesTest {

    private static final String INSTITUTE = "inst-1";

    // ── helpers ──────────────────────────────────────────────────────────────

    private static SocialAccount account(String id, String platform) {
        return account(id, platform, STATUS_ACTIVE, INSTITUTE);
    }

    private static SocialAccount account(String id, String platform, String status, String instituteId) {
        return SocialAccount.builder().id(id).instituteId(instituteId).platform(platform)
                .externalId("ext-" + id).name("Acc " + id).status(status).build();
    }

    private static SocialPostMediaDTO image(String id) {
        return SocialPostMediaDTO.builder().fileId(id).type(MEDIA_TYPE_IMAGE).build();
    }

    private static SocialPostMediaDTO video(String id) {
        return SocialPostMediaDTO.builder().fileId(id).type(MEDIA_TYPE_VIDEO).build();
    }

    private static PostInput input(String title, String body, String link, List<SocialPostMediaDTO> media,
                                   Map<String, String> overrides) {
        return new PostInput(title, body, link, media, overrides == null ? Map.of() : overrides, List.of(),
                null, SocialPostRequest.ACTION_SUBMIT, POST_SOURCE_MANUAL);
    }

    private static void assertBadRequest(Runnable r, String messagePart) {
        VacademyException e = assertThrows(VacademyException.class, r::run);
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().contains(messagePart),
                () -> "expected message to contain [" + messagePart + "] but was [" + e.getMessage() + "]");
    }

    // ── roll-up ──────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("post status roll-up from targets")
    class RollUp {

        @Test
        void allPostedIsPosted() {
            assertEquals(POST_STATUS_POSTED,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_POSTED, TARGET_STATUS_POSTED)));
        }

        @Test
        void somePostedSomeFailedIsPartial() {
            assertEquals(POST_STATUS_PARTIAL,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_POSTED, TARGET_STATUS_FAILED)));
        }

        @Test
        void noneDoneAllFailedIsFailed() {
            assertEquals(POST_STATUS_FAILED,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_FAILED, TARGET_STATUS_FAILED)));
        }

        @Test
        void anyPendingOrPublishingKeepsPublishing() {
            assertEquals(POST_STATUS_PUBLISHING,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_POSTED, TARGET_STATUS_PENDING)));
            assertEquals(POST_STATUS_PUBLISHING,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_FAILED, TARGET_STATUS_PUBLISHING)));
            assertFalse(SocialPostRules.isFinal(POST_STATUS_PUBLISHING));
            assertTrue(SocialPostRules.isFinal(POST_STATUS_PARTIAL));
        }

        @Test
        void skippedTargetsAreIgnored() {
            assertEquals(POST_STATUS_POSTED,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_POSTED, TARGET_STATUS_SKIPPED)));
            assertEquals(POST_STATUS_FAILED,
                    SocialPostRules.rollUpStatus(List.of(TARGET_STATUS_SKIPPED)));
        }

        @Test
        void noTargetsIsFailed() {
            assertEquals(POST_STATUS_FAILED, SocialPostRules.rollUpStatus(List.of()));
            assertEquals(POST_STATUS_FAILED, SocialPostRules.rollUpStatus(null));
        }

        @Test
        void retryBackoffDoublesAndCaps() {
            assertTrue(SocialPostRules.shouldRetry(1));
            assertTrue(SocialPostRules.shouldRetry(2));
            assertFalse(SocialPostRules.shouldRetry(3));
            assertEquals(Duration.ofMinutes(2), SocialPostRules.retryDelay(1));
            assertEquals(Duration.ofMinutes(4), SocialPostRules.retryDelay(2));
            assertEquals(Duration.ofMinutes(60), SocialPostRules.retryDelay(20));
        }
    }

    // ── text resolution ──────────────────────────────────────────────────────

    @Nested
    @DisplayName("caption and override resolution")
    class Text {

        @Test
        void overrideWinsWhenNotBlank() {
            Map<String, String> overrides = Map.of(PLATFORM_INSTAGRAM, "  IG text  ", PLATFORM_FACEBOOK, "   ");
            assertEquals("IG text", SocialPostRules.resolveText("Main", overrides, PLATFORM_INSTAGRAM));
            assertEquals("Main", SocialPostRules.resolveText("Main", overrides, PLATFORM_FACEBOOK));
            assertEquals("Main", SocialPostRules.resolveText(" Main ", overrides, PLATFORM_GOOGLE_BUSINESS));
            assertEquals("", SocialPostRules.resolveText(null, null, PLATFORM_FACEBOOK));
        }

        @Test
        void linkIsAppendedAfterABlankLine() {
            assertEquals("Hello\n\nhttps://x.io", SocialPostRules.instagramCaption("Hello", "https://x.io"));
            assertEquals("Hello", SocialPostRules.withLink("Hello", null));
            assertEquals("https://x.io", SocialPostRules.withLink("", "https://x.io"));
            assertEquals("", SocialPostRules.withLink(null, "  "));
        }

        @Test
        void youtubeTitleFallsBackToTextAndIsCapped() {
            assertEquals("My title", SocialPostRules.youtubeTitle("  My title ", "body"));
            String longText = "word ".repeat(40);
            String title = SocialPostRules.youtubeTitle(null, longText);
            assertTrue(title.length() <= SocialPostRules.YOUTUBE_TITLE_FROM_TEXT);
            assertTrue(title.startsWith("word word"));
            assertEquals("Line one line two", SocialPostRules.youtubeTitle("", "Line one\n\nline two"));
            assertEquals("a b", SocialPostRules.youtubeTitle("<a> b", null));
            assertEquals(100, SocialPostRules.youtubeTitle("x".repeat(150), null).length());
        }

        @Test
        void countsEmojiAsOneCharacterAndHashtags() {
            assertEquals(1, SocialPostRules.length("🎉"));
            assertEquals(3, SocialPostRules.countHashtags("#one two #three, #four_5 and a#notone"));
        }
    }

    // ── normalisation ────────────────────────────────────────────────────────

    @Nested
    @DisplayName("request normalisation")
    class Normalize {

        @Test
        void trimsUppercasesAndDeduplicates() {
            Map<String, String> overrides = new LinkedHashMap<>();
            overrides.put("instagram", " IG ");
            overrides.put("FACEBOOK", "  ");
            SocialPostRequest req = SocialPostRequest.builder()
                    .title("  ").body(" Hi ").linkUrl(" https://a.b ")
                    .media(List.of(SocialPostMediaDTO.builder().fileId(" f1 ").type("image").url("ignored").build()))
                    .overrides(overrides)
                    .accountIds(List.of("a", " a ", "b", ""))
                    .action("schedule").source("agent").build();
            PostInput in = SocialPostRules.normalize(req);
            assertNull(in.title());
            assertEquals("Hi", in.body());
            assertEquals("https://a.b", in.linkUrl());
            assertEquals("f1", in.media().get(0).getFileId());
            assertEquals(MEDIA_TYPE_IMAGE, in.media().get(0).getType());
            assertNull(in.media().get(0).getUrl());
            assertEquals(Map.of(PLATFORM_INSTAGRAM, "IG"), in.overrides());
            assertEquals(List.of("a", "b"), in.accountIds());
            assertEquals(SocialPostRequest.ACTION_SCHEDULE, in.action());
            assertEquals(POST_SOURCE_AGENT, in.source());
        }

        @Test
        void defaultsToDraftAndManual() {
            PostInput in = SocialPostRules.normalize(new SocialPostRequest());
            assertEquals(SocialPostRequest.ACTION_DRAFT, in.action());
            assertEquals(POST_SOURCE_MANUAL, in.source());
        }

        @Test
        void rejectsUnknownActionSourceAndPlatform() {
            assertBadRequest(() -> SocialPostRules.normalize(SocialPostRequest.builder().action("PUBLISH").build()),
                    "Unknown action");
            assertBadRequest(() -> SocialPostRules.normalize(SocialPostRequest.builder().source("BOT").build()),
                    "Unknown source");
            assertBadRequest(() -> SocialPostRules.normalize(SocialPostRequest.builder()
                    .overrides(Map.of("LINKEDIN", "x")).build()), "Unknown platform");
        }
    }

    // ── validation ───────────────────────────────────────────────────────────

    @Nested
    @DisplayName("request validation")
    class Validation {

        @Test
        void needsAtLeastOneAccount() {
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hello", null, List.of(), null), List.of()), "at least one account");
        }

        @Test
        void accountsMustBelongToInstituteAndBeActive() {
            SocialAccount other = account("x", PLATFORM_FACEBOOK, STATUS_ACTIVE, "other-inst");
            assertBadRequest(() -> SocialPostRules.resolveAccounts(List.of("x"), List.of(other), INSTITUTE, true),
                    "not found");
            assertBadRequest(() -> SocialPostRules.resolveAccounts(List.of("missing"), List.of(), INSTITUTE, true),
                    "not found");
            SocialAccount reconnect = account("r", PLATFORM_FACEBOOK, STATUS_RECONNECT_NEEDED, INSTITUTE);
            assertBadRequest(() -> SocialPostRules.resolveAccounts(List.of("r"), List.of(reconnect), INSTITUTE, true),
                    "reconnected");
            // Drafts may keep an account that needs reconnecting, but never a disconnected one.
            assertEquals(1, SocialPostRules.resolveAccounts(List.of("r"), List.of(reconnect), INSTITUTE, false).size());
            SocialAccount gone = account("d", PLATFORM_FACEBOOK, STATUS_DISCONNECTED, INSTITUTE);
            assertBadRequest(() -> SocialPostRules.resolveAccounts(List.of("d"), List.of(gone), INSTITUTE, false),
                    "disconnected");
        }

        @Test
        void resolveAccountsKeepsRequestOrder() {
            SocialAccount a = account("a", PLATFORM_FACEBOOK);
            SocialAccount b = account("b", PLATFORM_INSTAGRAM);
            List<SocialAccount> out = SocialPostRules.resolveAccounts(List.of("b", "a"), List.of(a, b), INSTITUTE, true);
            assertEquals("b", out.get(0).getId());
            assertEquals("a", out.get(1).getId());
        }

        @Test
        void instagramNeedsMedia() {
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hello", null, List.of(), null), List.of(account("i", PLATFORM_INSTAGRAM))),
                    "Instagram needs at least one");
            SocialPostRules.validateForPublishing(input(null, "Hello", null, List.of(image("f")), null),
                    List.of(account("i", PLATFORM_INSTAGRAM)));
        }

        @Test
        void instagramCaptionLimitIncludesTheLinkAndUsesTheOverride() {
            String link = "https://example.com/admissions";
            String text = "x".repeat(SocialPostRules.INSTAGRAM_CAPTION_MAX - 5);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, text, link, List.of(image("f")), null),
                    List.of(account("i", PLATFORM_INSTAGRAM))), "2200");
            // A short Instagram override makes the same post valid.
            SocialPostRules.validateForPublishing(
                    input(null, text, link, List.of(image("f")), Map.of(PLATFORM_INSTAGRAM, "Short")),
                    List.of(account("i", PLATFORM_INSTAGRAM)));
        }

        @Test
        void instagramHashtagLimit() {
            String text = "#tag ".repeat(31);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, text, null, List.of(image("f")), null),
                    List.of(account("i", PLATFORM_INSTAGRAM))), "hashtags");
        }

        @Test
        void youtubeNeedsExactlyOneVideo() {
            SocialAccount yt = account("y", SOCIAL_PLATFORM_YOUTUBE);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input("T", "Hello", null, List.of(image("f")), null), List.of(yt)), "exactly one video");
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input("T", "Hello", null, List.of(), null), List.of(yt)), "exactly one video");
            SocialPostRules.validateForPublishing(input("T", "Hello", null, List.of(video("v")), null), List.of(yt));
        }

        @Test
        void youtubeNeedsATitleOrText() {
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, null, null, List.of(video("v")), null),
                    List.of(account("y", SOCIAL_PLATFORM_YOUTUBE))), "title");
        }

        @Test
        void googleBusinessTakesNoVideoAndAtMost1500Characters() {
            SocialAccount gbp = account("g", PLATFORM_GOOGLE_BUSINESS);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hello", null, List.of(video("v")), null), List.of(gbp)), "not video");
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "x".repeat(1501), null, List.of(), null), List.of(gbp)), "1500");
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, null, "https://a.b", List.of(image("f")), null), List.of(gbp)), "needs some text");
            SocialPostRules.validateForPublishing(input(null, "x".repeat(1500), null, List.of(image("f")), null),
                    List.of(gbp));
        }

        @Test
        void facebookNeedsSomething() {
            SocialAccount fb = account("f", PLATFORM_FACEBOOK);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, null, null, List.of(), null), List.of(fb)), "Facebook needs");
            SocialPostRules.validateForPublishing(input(null, null, "https://a.b", List.of(), null), List.of(fb));
        }

        @Test
        void mediaShapeRules() {
            List<SocialPostMediaDTO> eleven = new ArrayList<>();
            for (int i = 0; i < 11; i++) eleven.add(image("f" + i));
            assertBadRequest(() -> SocialPostRules.validateStructure(input(null, "x", null, eleven, null)),
                    "at most 10");
            assertBadRequest(() -> SocialPostRules.validateStructure(
                    input(null, "x", null, List.of(image("a"), video("b")), null)), "cannot be mixed");
            assertBadRequest(() -> SocialPostRules.validateStructure(
                    input(null, "x", null, List.of(video("a"), video("b")), null)), "cannot be mixed");
            assertBadRequest(() -> SocialPostRules.validateStructure(input(null, "x", null,
                    List.of(SocialPostMediaDTO.builder().fileId("a").type("GIF").build()), null)), "IMAGE or VIDEO");
            assertBadRequest(() -> SocialPostRules.validateStructure(input(null, "x", null,
                    List.of(SocialPostMediaDTO.builder().type(MEDIA_TYPE_IMAGE).build()), null)), "missing its file");
        }

        @Test
        void linkMustBeHttp() {
            assertBadRequest(() -> SocialPostRules.validateStructure(
                    input(null, "x", "javascript:alert(1)", List.of(), null)), "http");
            assertBadRequest(() -> SocialPostRules.validateStructure(
                    input(null, "x", "https://a b", List.of(), null)), "spaces");
            SocialPostRules.validateStructure(input(null, "x", "HTTPS://a.b/c", List.of(), null));
        }
    }

    // ── action -> status ─────────────────────────────────────────────────────

    @Nested
    @DisplayName("action outcome")
    class Outcome {

        private final Instant now = Instant.parse("2026-11-09T10:00:00Z");

        @Test
        void draftAndSubmit() {
            ActionOutcome d = SocialPostRules.outcomeFor(SocialPostRequest.ACTION_DRAFT, true, null, now);
            assertEquals(POST_STATUS_DRAFT, d.status());
            assertFalse(d.approved());
            ActionOutcome s = SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SUBMIT, true, now.plusSeconds(60), now);
            assertEquals(POST_STATUS_NEEDS_APPROVAL, s.status());
            assertEquals(now.plusSeconds(60), s.scheduledAt());
        }

        @Test
        void scheduleByAdminNeedsAFutureTime() {
            Instant later = now.plusSeconds(3600);
            ActionOutcome o = SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SCHEDULE, true, later, now);
            assertEquals(POST_STATUS_SCHEDULED, o.status());
            assertTrue(o.approved());
            assertFalse(o.publishNow());
            assertBadRequest(() -> SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SCHEDULE, true, null, now),
                    "Pick a date");
            assertBadRequest(() -> SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SCHEDULE, true,
                    now.minusSeconds(120), now), "in the past");
            // Inside the one-minute grace it is accepted.
            assertEquals(POST_STATUS_SCHEDULED, SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SCHEDULE, true,
                    now.minusSeconds(30), now).status());
        }

        @Test
        void scheduleByStaffNeedsApproval() {
            ActionOutcome o = SocialPostRules.outcomeFor(SocialPostRequest.ACTION_SCHEDULE, false, null, now);
            assertEquals(POST_STATUS_NEEDS_APPROVAL, o.status());
            assertFalse(o.approved());
        }

        @Test
        void postNowIsAdminOnly() {
            ActionOutcome o = SocialPostRules.outcomeFor(SocialPostRequest.ACTION_POST_NOW, true, null, now);
            assertEquals(POST_STATUS_SCHEDULED, o.status());
            assertEquals(now, o.scheduledAt());
            assertTrue(o.publishNow());
            assertThrows(ForbiddenException.class,
                    () -> SocialPostRules.outcomeFor(SocialPostRequest.ACTION_POST_NOW, false, null, now));
        }
    }

    // ── JSON columns ─────────────────────────────────────────────────────────

    @Test
    void mediaAndOverridesRoundTripWithoutUrls() {
        String media = SocialPostJson.writeMedia(List.of(
                SocialPostMediaDTO.builder().fileId("f1").type(MEDIA_TYPE_IMAGE).name("a.png").url("https://x").build()));
        assertFalse(media.contains("https://x"));
        List<SocialPostMediaDTO> back = SocialPostJson.readMedia(media);
        assertEquals("f1", back.get(0).getFileId());
        assertEquals("a.png", back.get(0).getName());
        assertNull(SocialPostJson.writeMedia(List.of()));
        assertTrue(SocialPostJson.readMedia("not json").isEmpty());

        String overrides = SocialPostJson.writeOverrides(Map.of(PLATFORM_INSTAGRAM, "IG"));
        assertEquals(Map.of(PLATFORM_INSTAGRAM, "IG"), SocialPostJson.readOverrides(overrides));
        assertTrue(SocialPostJson.readOverrides(null).isEmpty());
    }

    // ── formats and YouTube description bytes ────────────────────────────────

    @Nested
    @DisplayName("photo formats and YouTube description")
    class FormatsAndYoutubeDescription {

        private SocialPostMediaDTO named(String id, String name) {
            return SocialPostMediaDTO.builder().fileId(id).type(MEDIA_TYPE_IMAGE).name(name).build();
        }

        @Test
        @DisplayName("Instagram refuses PNG / WebP photos at save time; JPEG and unnamed files pass")
        void instagramNeedsJpeg() {
            List<SocialAccount> ig = List.of(account("a1", PLATFORM_INSTAGRAM));
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hi", null, List.of(named("f1", "poster.png")), null), ig), "Instagram needs JPEG");
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hi", null, List.of(named("f1", "a.jpg"), named("f2", "b.WEBP")), null), ig),
                    "b.WEBP");
            SocialPostRules.validateForPublishing(
                    input(null, "Hi", null, List.of(named("f1", "a.JPG"), named("f2", "b.jpeg"), image("f3")), null), ig);
            // Facebook takes PNG.
            SocialPostRules.validateForPublishing(input(null, "Hi", null, List.of(named("f1", "poster.png")), null),
                    List.of(account("a2", PLATFORM_FACEBOOK)));
        }

        @Test
        @DisplayName("Google Business Profile takes JPG or PNG, not WebP")
        void googleBusinessFormats() {
            List<SocialAccount> gbp = List.of(account("a1", PLATFORM_GOOGLE_BUSINESS));
            SocialPostRules.validateForPublishing(input(null, "Hi", null, List.of(named("f1", "a.png")), null), gbp);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input(null, "Hi", null, List.of(named("f1", "a.webp")), null), gbp), "JPG or PNG");
        }

        @Test
        @DisplayName("YouTube description drops angle brackets and is limited in UTF-8 bytes")
        void youtubeDescriptionBytes() {
            assertEquals("Marks  40% need retest", SocialPostRules.youtubeDescription("Marks < 40% need retest", null));
            assertEquals("a3\n\nhttps://x.io", SocialPostRules.youtubeDescription("a<3", "https://x.io"));
            List<SocialAccount> yt = List.of(account("a1", SOCIAL_PLATFORM_YOUTUBE));
            // 1,700 Devanagari characters = 5,100 bytes: under 5,000 characters but over 5,000 bytes.
            String hindi = "\u0915".repeat(1700);
            assertBadRequest(() -> SocialPostRules.validateForPublishing(
                    input("Title", hindi, null, List.of(video("v1")), null), yt), "5000 bytes");
            SocialPostRules.validateForPublishing(input("Title", "\u0915".repeat(1600), null, List.of(video("v1")), null), yt);
        }
    }
}
