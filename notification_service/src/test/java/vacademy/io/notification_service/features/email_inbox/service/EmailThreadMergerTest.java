package vacademy.io.notification_service.features.email_inbox.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.email_inbox.service.EmailThreadMerger.MergedRow;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EmailThreadMergerTest {

    private static final String TO = "shreyash@vidyayatan.com";
    private static final String FROM = "hello@vidyayatan.com";
    private static final String TITLE = "Welcome to the batch";
    private static final Instant T0 = Instant.parse("2026-09-14T07:34:00Z");

    static NotificationLog row(String id, String type, String source, String body, Instant at, String from) {
        NotificationLog nl = new NotificationLog();
        nl.setId(id);
        nl.setNotificationType(type);
        nl.setChannelId(TO);
        nl.setSource(source);
        nl.setBody(body);
        nl.setNotificationDate(at);
        nl.setSenderBusinessChannelId(from);
        return nl;
    }

    static NotificationLog announcement(String id, Instant at) {
        return row(id, "EMAIL", "announcement-service", TITLE, at, FROM);
    }

    static NotificationLog unified(String id, Instant at) {
        return row(id, "EMAIL", "unified-send", "<html><body>Hi</body></html>", at, FROM);
    }

    @Test
    @DisplayName("twin pair collapses to the HTML row carrying the campaign title as subject")
    void twinMerged() {
        // Repo order: newest first (the SMTP row lands ~1-2s after the announcement row).
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                unified("u1", T0.plusSeconds(2)),
                announcement("a1", T0)));

        assertThat(out).hasSize(1);
        assertThat(out.get(0).row().getId()).isEqualTo("u1");
        assertThat(out.get(0).derivedSubject()).isEqualTo(TITLE);
        assertThat(out.get(0).campaign()).isTrue();
    }

    @Test
    void noTwinKeepsAnnouncementRowAsCampaign() {
        List<MergedRow> out = EmailThreadMerger.merge(List.of(announcement("a1", T0)));

        assertThat(out).hasSize(1);
        assertThat(out.get(0).row().getId()).isEqualTo("a1");
        assertThat(out.get(0).derivedSubject()).isNull();
        assertThat(out.get(0).campaign()).isTrue();
    }

    @Test
    void differentInstituteSenderIsNotMerged() {
        NotificationLog other = unified("u1", T0.plusSeconds(1));
        other.setSenderBusinessChannelId("support@vidyayatan.com");
        List<MergedRow> out = EmailThreadMerger.merge(List.of(other, announcement("a1", T0)));

        assertThat(out).hasSize(2);
        assertThat(out.get(1).campaign()).isTrue();
        assertThat(out.get(0).campaign()).isFalse();
    }

    @Test
    void nullSenderOnBothSidesStillMerges() {
        NotificationLog a = announcement("a1", T0);
        a.setSenderBusinessChannelId(null);
        NotificationLog u = unified("u1", T0.plusSeconds(1));
        u.setSenderBusinessChannelId(null);

        assertThat(EmailThreadMerger.merge(List.of(u, a))).hasSize(1);
    }

    @Test
    void beyondTheWindowIsNotMerged() {
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                unified("u1", T0.plusSeconds(61)),
                announcement("a1", T0)));

        assertThat(out).hasSize(2);
    }

    @Test
    @DisplayName("a retried SMTP send (timeout + backoff, ~40 s late) still pairs with its announcement row")
    void retriedSendFortySecondsLaterStillMerges() {
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                unified("u1", T0.plusSeconds(40)),
                announcement("a1", T0)));

        assertThat(out).hasSize(1);
        assertThat(out.get(0).row().getId()).isEqualTo("u1");
        assertThat(out.get(0).derivedSubject()).isEqualTo(TITLE);
    }

    @Test
    void sixtySecondsApartStillMerges() {
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                unified("u1", T0.plusSeconds(60)),
                announcement("a1", T0)));

        assertThat(out).hasSize(1);
    }

    @Test
    void unifiedRowWithPayloadSubjectKeepsIt() {
        NotificationLog u = unified("u1", T0.plusSeconds(1));
        u.setMessagePayload("{\"subject\":\"Real subject line\"}");
        List<MergedRow> out = EmailThreadMerger.merge(List.of(u, announcement("a1", T0)));

        assertThat(out).hasSize(1);
        assertThat(out.get(0).row().getId()).isEqualTo("u1");
        // Merger leaves derivedSubject empty; the payload subject wins in toMessage.
        assertThat(out.get(0).derivedSubject()).isNull();
        assertThat(out.get(0).campaign()).isTrue();
    }

    @Test
    void orderIsPreserved() {
        NotificationLog inbound = row("i1", "INBOUND_EMAIL", "u2", "Re: hello", T0.plusSeconds(600), FROM);
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                inbound,
                unified("u2", T0.plusSeconds(300)),
                announcement("a2", T0.plusSeconds(299)),
                unified("u1", T0.plusSeconds(2)),
                announcement("a1", T0)));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("i1", "u2", "u1");
    }

    @Test
    void inboundRowsAreUntouched() {
        NotificationLog inbound = row("i1", "INBOUND_EMAIL", "F9E8AD65-A66F-4A53-A97B-E855B48ABD26",
                "Re: hello neeraj", T0.plusSeconds(1), FROM);
        List<MergedRow> out = EmailThreadMerger.merge(List.of(inbound, announcement("a1", T0)));

        assertThat(out).hasSize(2);
        assertThat(out.get(0).row()).isSameAs(inbound);
        assertThat(out.get(0).campaign()).isFalse();
        assertThat(out.get(0).derivedSubject()).isNull();
    }

    @Test
    void eachHtmlRowAbsorbsAtMostOneAnnouncement() {
        // Two campaigns fired within seconds: each announcement must pair with its own send.
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                unified("u2", T0.plusSeconds(6)),
                announcement("a2", T0.plusSeconds(5)),
                unified("u1", T0.plusSeconds(1)),
                announcement("a1", T0)));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("u2", "u1");
        assertThat(out).allMatch(MergedRow::campaign);
    }

    @Test
    @DisplayName("one HTML row absorbs at most one announcement: the second stays as its own campaign card")
    void secondAnnouncementDoesNotFoldIntoAnAlreadyTakenRow() {
        // Campaign B's SMTP send never produced a row (failed inside the async dispatcher), so only
        // Campaign A's HTML row is within reach of both announcement rows.
        NotificationLog aB = row("aB", "EMAIL", "announcement-service", "Campaign B", T0.plusSeconds(4), FROM);
        NotificationLog uA = unified("uA", T0.plusSeconds(3));
        NotificationLog aA = row("aA", "EMAIL", "announcement-service", "Campaign A", T0, FROM);

        List<MergedRow> out = EmailThreadMerger.merge(List.of(aB, uA, aA));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("uA", "aA");
        assertThat(out).allMatch(MergedRow::campaign);
        // uA was taken by the nearest announcement (aB, 1 s) and carries its title; aA stays lone.
        assertThat(out.get(0).derivedSubject()).isEqualTo("Campaign B");
        assertThat(out.get(1).derivedSubject()).isNull();
    }

    @Test
    @DisplayName("two campaigns back-to-back: each announcement gets its own HTML row, both titles survive")
    void twoCampaignsPairOneToOne() {
        // newest-first: a2(T+5 'Campaign B'), u2(T+3), a1(T+2 'Campaign A'), u1(T0)
        List<MergedRow> out = EmailThreadMerger.merge(List.of(
                row("a2", "EMAIL", "announcement-service", "Campaign B", T0.plusSeconds(5), FROM),
                unified("u2", T0.plusSeconds(3)),
                row("a1", "EMAIL", "announcement-service", "Campaign A", T0.plusSeconds(2), FROM),
                unified("u1", T0)));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("u2", "u1");
        assertThat(out).extracting(MergedRow::derivedSubject).containsExactly("Campaign B", "Campaign A");
        assertThat(out).allMatch(MergedRow::campaign);
    }

    @Test
    @DisplayName("only a 'unified-send' row can be a twin: an inbox reply / OTP / automation row in the window is never captured")
    void otherSourcesAreNeverTwins() {
        NotificationLog inboxReply = row("x1", "EMAIL", "EMAIL_INBOX", "<p>Sure, see you Monday</p>", T0, FROM);
        NotificationLog otp = row("o1", "EMAIL", "OTP_SERVICE", "<p>Your OTP is 123456</p>", T0.plusSeconds(1), FROM);
        NotificationLog engine = row("e1", "EMAIL", "ENGAGEMENT_ENGINE", "<p>Auto</p>", T0.plusSeconds(2), FROM);
        NotificationLog event = row("v1", "EMAIL", "event:LEARNER_BATCH_ENROLLMENT", "<p>Welcome</p>", T0.plusSeconds(4), FROM);
        NotificationLog ann = announcement("a1", T0.plusSeconds(3));

        List<MergedRow> out = EmailThreadMerger.merge(List.of(event, ann, engine, otp, inboxReply));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("v1", "a1", "e1", "o1", "x1");
        assertThat(out).filteredOn(m -> !m.row().getId().equals("a1")).allMatch(m -> !m.campaign());
        assertThat(out.get(1).campaign()).isTrue();
    }

    @Test
    @DisplayName("a FAILED announcement row (unsubscribed / missing address) never pairs — it had no SMTP send")
    void failedAnnouncementRowStaysLone() {
        NotificationLog failed = announcement("a1", T0.plusSeconds(3));
        failed.setDeliveryStatus("FAILED");
        failed.setDeliveryErrorMessage("User unsubscribed");
        NotificationLog someoneElsesSend = unified("u1", T0);

        List<MergedRow> out = EmailThreadMerger.merge(List.of(failed, someoneElsesSend));

        assertThat(out).extracting(m -> m.row().getId()).containsExactly("a1", "u1");
        assertThat(out.get(0).campaign()).isTrue();
        assertThat(out.get(1).campaign()).isFalse();
        assertThat(out.get(1).derivedSubject()).isNull();
    }

    @Test
    void emptyAndNullInputs() {
        assertThat(EmailThreadMerger.merge(null)).isEmpty();
        assertThat(EmailThreadMerger.merge(List.of())).isEmpty();
    }
}
