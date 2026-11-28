package vacademy.io.notification_service.features.email_sending_controls;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.notification_service.features.email_sending_controls.repository.EmailUnsubscribeRepository;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;
import vacademy.io.notification_service.features.email_sending_controls.service.SenderPolicy;
import vacademy.io.notification_service.features.email_sending_controls.service.UnsubscribeMailer;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SendingControlsTest {

    private final ObjectMapper om = new ObjectMapper();

    @Test
    void policyDefaultsAreInert() throws Exception {
        SenderPolicy p = SenderPolicy.from(om.readTree("{\"from\":\"a@b.com\"}"));
        assertFalse(p.capped());
        assertFalse(p.unsubscribeApplies("UTILITY_EMAIL"));
        assertTrue(p.unsubscribeApplies("PROMOTIONAL_EMAIL"), "promotional mail always carries unsubscribe");
        assertTrue(p.unsubscribeApplies("MARKETING_EMAIL"), "Settings saves a marketing sender under this code");
        assertTrue(p.unsubscribeApplies("marketing_email"), "code comparison is case-insensitive");
        assertFalse(p.unsubscribeApplies("TRANSACTIONAL_EMAIL"));
        assertNull(SenderPolicy.from(null).postalAddress());
    }

    @Test
    void policyReadsControlsAndToleratesBadZone() throws Exception {
        SenderPolicy p = SenderPolicy.from(om.readTree(
                "{\"max_per_day\":40,\"timezone\":\"America/New_York\",\"send_after_hour\":9,\"postal_address\":\"1 Main St\",\"list_unsubscribe\":true}"));
        assertEquals(40, p.maxPerDay());
        assertEquals(ZoneId.of("America/New_York"), p.zone());
        assertEquals(9, p.sendAfterHour());
        assertTrue(p.unsubscribeApplies("UTILITY_EMAIL"));
        assertTrue(p.nextWindow().isAfter(java.time.LocalDateTime.now()));
        assertEquals(ZoneId.of("UTC"), SenderPolicy.from(om.readTree("{\"timezone\":\"Mars/Olympus\"}")).zone());
        assertEquals("inst|promotional_email|a@b.com", SenderPolicy.senderKey("inst", "PROMOTIONAL_EMAIL", "A@B.com"));
    }

    @Test
    void rampWidensTheCapOnScheduleAndStopsAtTheCeiling() {
        LocalDate day0 = LocalDate.of(2026, 9, 14);
        SenderPolicy.RampPlan ramp = new SenderPolicy.RampPlan(20, 20, 7, 150, day0);

        assertEquals(20, ramp.capOn(day0), "opening volume");
        assertEquals(20, ramp.capOn(day0.plusDays(6)), "no increase inside the first week");
        assertEquals(40, ramp.capOn(day0.plusDays(7)), "first increase");
        assertEquals(60, ramp.capOn(day0.plusDays(14)));
        assertEquals(150, ramp.capOn(day0.plusDays(70)), "never exceeds the ceiling");
        assertEquals(20, ramp.capOn(day0.minusDays(3)), "a date before day 0 is still the opening volume");

        assertEquals(day0.plusDays(7), ramp.nextIncreaseAfter(day0));
        assertEquals(day0.plusDays(14), ramp.nextIncreaseAfter(day0.plusDays(7)));
        assertNull(ramp.nextIncreaseAfter(day0.plusDays(70)), "no further increase at the ceiling");
    }

    @Test
    void rampIsDrivenByElapsedDaysNotBySendVolume() {
        // Skipping days must not bank extra volume: a schedule resumed after a pause is at
        // the stage its calendar says, which is what mailbox providers actually judge.
        LocalDate day0 = LocalDate.of(2026, 9, 14);
        SenderPolicy.RampPlan ramp = new SenderPolicy.RampPlan(10, 10, 3, 0, day0);
        assertEquals(40, ramp.capOn(day0.plusDays(9)));
        assertEquals(40, ramp.capOn(day0.plusDays(11)), "still stage 3 until the next boundary");
    }

    @Test
    void rampOverridesTheFlatCapAndWeekendPauseIsNotUnlimited() throws Exception {
        SenderPolicy flat = SenderPolicy.from(om.readTree("{\"max_per_day\":500}"));
        assertEquals(500, flat.maxPerDay());
        assertNull(flat.ramp());

        SenderPolicy ramped = SenderPolicy.from(om.readTree(
                "{\"max_per_day\":500,\"ramp_enabled\":true,\"ramp_start_per_day\":20,\"ramp_step\":20,"
                        + "\"ramp_every_days\":7,\"ramp_ceiling\":150,\"ramp_started_on\":\"2026-09-14\"}"));
        assertNotNull(ramped.ramp());
        assertTrue(ramped.maxPerDay() >= 20 && ramped.maxPerDay() <= 150,
                "the flat 500 is ignored while a ramp is running");

        // pausedToday must never be expressed as maxPerDay=0 — that means "unlimited".
        SenderPolicy weekend = SenderPolicy.from(om.readTree("{\"skip_weekends\":true}"));
        assertTrue(weekend.skipWeekends());
        if (weekend.pausedToday()) assertTrue(weekend.capped(), "a paused day is still a limit");
    }

    @Test
    void nextWindowNeverLandsOnAWeekendWhenSkippingIsOn() throws Exception {
        SenderPolicy p = SenderPolicy.from(om.readTree(
                "{\"skip_weekends\":true,\"timezone\":\"America/New_York\",\"send_after_hour\":9}"));
        java.time.DayOfWeek d = p.nextWindow().getDayOfWeek();
        assertNotEquals(java.time.DayOfWeek.SATURDAY, d);
        assertNotEquals(java.time.DayOfWeek.SUNDAY, d);
        assertTrue(p.nextWindow().isAfter(LocalDateTime.now()));
    }

    @Test
    void tokenVerifiesOnlyForSameInstituteAndEmail() throws Exception {
        EmailUnsubscribeService svc = new EmailUnsubscribeService(mock(EmailUnsubscribeRepository.class), "s3cret", "", "https://api.example.com/");
        ReflectionTestUtils.invokeMethod(svc, "init");
        String t = svc.token("inst-1", "Lead@Example.com");
        assertTrue(svc.verify("inst-1", "lead@example.com", t), "case-insensitive email");
        assertFalse(svc.verify("inst-2", "lead@example.com", t));
        assertFalse(svc.verify("inst-1", "other@example.com", t));
        assertFalse(svc.verify("inst-1", "lead@example.com", t.substring(1) + "x"));
        String url = svc.unsubscribeUrl("inst-1", "lead@example.com");
        assertTrue(url.startsWith("https://api.example.com/notification-service/public/v1/email/unsubscribe?i=inst-1&e=lead%40example.com&t="));
    }

    @Test
    void blankBaseUrlFallsBackToGateway() throws Exception {
        // kubectl set env with an unset secret yields "", not an absent variable.
        EmailUnsubscribeService svc = new EmailUnsubscribeService(mock(EmailUnsubscribeRepository.class), "k", "", "");
        ReflectionTestUtils.invokeMethod(svc, "init");
        assertTrue(svc.unsubscribeUrl("i", "x@y.com").startsWith("https://backend-stage.vacademy.io/notification-service/public/v1/email/unsubscribe?"));
    }

    @Test
    void mailerAddsHeadersAndFooter() throws Exception {
        EmailUnsubscribeRepository repo = mock(EmailUnsubscribeRepository.class);
        when(repo.existsByEmailAndInstituteIdAndIsActiveTrue("x@y.com", "i")).thenReturn(false);
        EmailUnsubscribeService svc = new EmailUnsubscribeService(repo, "k", "", "https://api");
        ReflectionTestUtils.invokeMethod(svc, "init");
        UnsubscribeMailer mailer = new UnsubscribeMailer(svc);
        ReflectionTestUtils.setField(mailer, "mailto", "");
        ReflectionTestUtils.setField(mailer, "defaultPostalAddress", "Vacademy, Indore, India");

        MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
        mailer.addHeaders(m, "i", "x@y.com");
        assertTrue(m.getHeader("List-Unsubscribe")[0].startsWith("<https://api/notification-service/public/v1/email/unsubscribe?"));
        assertEquals("List-Unsubscribe=One-Click", m.getHeader("List-Unsubscribe-Post")[0]);

        SenderPolicy p = SenderPolicy.from(om.readTree("{\"postal_address\":\"12 Elm St, Austin TX\"}"));
        String out = mailer.withFooter("<html><body><p>Hi</p></body></html>", "i", "x@y.com", p, "Riya from Tutezy");
        assertTrue(out.contains("Unsubscribe</a>"));
        assertTrue(out.contains("12 Elm St, Austin TX"), "sender's own address wins over the platform default");
        assertTrue(out.indexOf("Unsubscribe") < out.indexOf("</body>"), "footer goes inside the body");

        String placeholder = mailer.withFooter("<p>Bye <a href=\"{{unsubscribeUrl}}\">opt out</a></p>", "i", "x@y.com", SenderPolicy.NONE, null);
        assertFalse(placeholder.contains("{{unsubscribeUrl}}"));
        assertFalse(placeholder.contains("You received this email"), "template with its own link gets no appended footer");
    }
}
