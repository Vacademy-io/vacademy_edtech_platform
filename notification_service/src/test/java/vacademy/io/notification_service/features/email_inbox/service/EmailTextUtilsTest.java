package vacademy.io.notification_service.features.email_inbox.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class EmailTextUtilsTest {

    // ---- toPlainText ------------------------------------------------------------------------

    @Test
    @DisplayName("the real prod preview: entity-encoded preheader padding becomes clean text")
    void realPreheaderPadding() {
        String raw = "96 shreyash@vidyayatan.com&#847; &#8199; &#65279; &#847;";
        assertThat(EmailTextUtils.toPlainText(raw)).isEqualTo("96 shreyash@vidyayatan.com");
    }

    @Test
    void decodesNumericHexAndNamedEntities() {
        assertThat(EmailTextUtils.toPlainText("a&#65;b&#x42;c&amp;&lt;&gt;&quot;&apos;d"))
                .isEqualTo("aAbBc&<>\"'d");
    }

    @Test
    void decodesNbspToPlainSpace() {
        assertThat(EmailTextUtils.toPlainText("hello&nbsp;world again")).isEqualTo("hello world again");
    }

    @Test
    void doesNotDoubleDecode() {
        // "&amp;lt;" is the literal text "&lt;" once decoded — must not become "<".
        assertThat(EmailTextUtils.toPlainText("&amp;lt;")).isEqualTo("&lt;");
    }

    @Test
    @DisplayName("display:none preheader div is removed with its content")
    void removesHiddenPreheader() {
        String html = "<body><div style=\"display:none;font-size:1px;color:#ffffff;max-height:0px;\">"
                + "Preview text&#847; &#8199; &#65279; </div><p>Hello <b>Neeraj</b></p></body>";
        assertThat(EmailTextUtils.toPlainText(html)).isEqualTo("Hello Neeraj");
    }

    @Test
    void removesVisibilityHiddenAndSpacedDisplayNone() {
        String html = "<span style='visibility:hidden'>x</span><div style=\"display : none\">y</div>Visible";
        assertThat(EmailTextUtils.toPlainText(html)).isEqualTo("Visible");
    }

    @Test
    void hiddenElementWithNestedSameTagIsRemovedWholly() {
        String html = "<div style=\"display:none\"><div>inner</div>outer</div>Shown";
        assertThat(EmailTextUtils.toPlainText(html)).isEqualTo("Shown");
    }

    @Test
    void hiddenElementWithoutClosingTagKeepsVisibleText() {
        String html = "<div style=\"display:none\">orphan Still here";
        assertThat(EmailTextUtils.toPlainText(html)).isEqualTo("orphan Still here");
    }

    @Test
    void removesStyleScriptHeadAndTitleBlocks() {
        String html = "<html><head><title>Ignored title</title><style>.a{color:red}</style></head>"
                + "<body><script>alert('x')</script><p>Body text</p></body></html>";
        assertThat(EmailTextUtils.toPlainText(html)).isEqualTo("Body text");
    }

    @Test
    void removesZeroWidthCharacters() {
        String raw = "a​b‌c‍d﻿e͏f⁠g؜h᠎i j";
        assertThat(EmailTextUtils.toPlainText(raw)).isEqualTo("abcdefghij");
    }

    @Test
    void turnsExoticSpacesIntoPlainSpaces() {
        assertThat(EmailTextUtils.toPlainText("a b c d")).isEqualTo("a b c d");
    }

    @Test
    void collapsesWhitespaceAndTrims() {
        assertThat(EmailTextUtils.toPlainText("  Hello \n\n  <br/>  world \t ")).isEqualTo("Hello world");
    }

    @Test
    void nullAndBlankSafe() {
        assertThat(EmailTextUtils.toPlainText(null)).isNull();
        assertThat(EmailTextUtils.toPlainText("")).isEmpty();
        assertThat(EmailTextUtils.toPlainText("   ")).isEmpty();
    }

    @Test
    void plainTextPassesThrough() {
        assertThat(EmailTextUtils.toPlainText("hello boss")).isEqualTo("hello boss");
    }

    // ---- truncate ---------------------------------------------------------------------------

    // ---- cleanText (already-plain input: subjects, inbound text bodies) ----------------------

    @Test
    @DisplayName("an inbound plain-text reply keeps its angle-bracketed words and URLs")
    void cleanTextKeepsAngleBrackets() {
        assertThat(EmailTextUtils.cleanText("Price is <500 but > 300, see <https://example.com/x>"))
                .isEqualTo("Price is <500 but > 300, see <https://example.com/x>");
        // toPlainText on the same input is what used to run — it eats the bracketed spans.
        assertThat(EmailTextUtils.toPlainText("Price is <500 but > 300, see <https://example.com/x>"))
                .isEqualTo("Price is 300, see");
    }

    @Test
    void cleanTextStillDecodesEntitiesAndDropsInvisibles() {
        // An inbound html-only body is tag-stripped at ingest but keeps its entities.
        assertThat(EmailTextUtils.cleanText("Hello&nbsp;there&#847; &#8199; &amp; friends\n\n  bye"))
                .isEqualTo("Hello there & friends bye");
        assertThat(EmailTextUtils.cleanText(null)).isNull();
        assertThat(EmailTextUtils.cleanText("   ")).isEmpty();
    }

    @Test
    void cleanTextKeepsSubjectWithBracketedToken() {
        assertThat(EmailTextUtils.cleanText("Reminder: <Batch A> starts Monday"))
                .isEqualTo("Reminder: <Batch A> starts Monday");
    }

    @Test
    void truncateAddsEllipsisOnlyWhenNeeded() {
        assertThat(EmailTextUtils.truncate("abc", 3)).isEqualTo("abc");
        assertThat(EmailTextUtils.truncate("abcd", 3)).isEqualTo("abc...");
        assertThat(EmailTextUtils.truncate(null, 3)).isNull();
    }

    // ---- isSystemSender ---------------------------------------------------------------------

    @Test
    void systemSendersByLocalPart() {
        assertThat(EmailTextUtils.isSystemSender("mailer-daemon@ap-south-1.amazonses.com", null)).isTrue();
        assertThat(EmailTextUtils.isSystemSender("MAILER-DAEMON@ap-south-1.amazonses.com", null)).isTrue();
        assertThat(EmailTextUtils.isSystemSender("no-reply-aws@amazon.com", null)).isTrue();
        assertThat(EmailTextUtils.isSystemSender("postmaster@x", null)).isTrue();
        assertThat(EmailTextUtils.isSystemSender("bounces@example.com", "Hi")).isTrue();
        assertThat(EmailTextUtils.isSystemSender("Mail Delivery <mailer-daemon@x.com>", null)).isTrue();
    }

    @Test
    void systemSendersBySubject() {
        assertThat(EmailTextUtils.isSystemSender("someone@example.com", "Delivery Status Notification (Failure)")).isTrue();
        assertThat(EmailTextUtils.isSystemSender("someone@example.com", "Undeliverable: hello")).isTrue();
        assertThat(EmailTextUtils.isSystemSender("someone@example.com", "Undelivered Mail Returned to Sender")).isTrue();
        assertThat(EmailTextUtils.isSystemSender("someone@example.com", "Mail delivery failed: returning message")).isTrue();
        assertThat(EmailTextUtils.isSystemSender("someone@example.com", "Amazon SES Setup Notification")).isTrue();
    }

    @Test
    @DisplayName("real people and real business senders are NOT system senders")
    void realSendersAreNotSystem() {
        assertThat(EmailTextUtils.isSystemSender("hariyaleneeraj31@gmail.com", "Re: testing")).isFalse();
        // 'noreply' alone is a business mailbox, not a mail-system daemon.
        assertThat(EmailTextUtils.isSystemSender("noreply@planetspark.info", "Your class is tomorrow")).isFalse();
        assertThat(EmailTextUtils.isSystemSender("no-reply@vacademy.io", null)).isFalse();
        assertThat(EmailTextUtils.isSystemSender(null, null)).isFalse();
        assertThat(EmailTextUtils.isSystemSender(null, "Re: Delivery schedule")).isFalse();
    }
}
