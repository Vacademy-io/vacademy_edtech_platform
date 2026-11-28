package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeEventRateLimiter;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeEventService;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeViewAggregator;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.BlockState;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.EventRow;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.PublishedLayout;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;

import java.time.Instant;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.*;

/** The beacon (validation, rate limit, view aggregation, click rows) and dismiss / acknowledge. */
class LearnerHomeEventsTest {

    static final String INST = "inst-1";

    LearnerHomeGate gate;
    LearnerHomeLayoutCache cache;
    LearnerHomeJdbc jdbc;
    LearnerHomeViewAggregator aggregator;
    long[] nanos = {0};
    LearnerHomeEventService service;

    @BeforeEach
    void setUp() throws Exception {
        gate = mock(LearnerHomeGate.class);
        cache = mock(LearnerHomeLayoutCache.class);
        jdbc = mock(LearnerHomeJdbc.class);
        when(gate.moduleEnabled(INST)).thenReturn(true);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone(INST)).thenReturn(ZoneId.of("Asia/Kolkata"));
        aggregator = new LearnerHomeViewAggregator(jdbc, tz);
        var ctor = LearnerHomeEventRateLimiter.class.getDeclaredConstructor(java.util.function.LongSupplier.class);
        ctor.setAccessible(true);
        LearnerHomeEventRateLimiter limiter = ctor.newInstance((java.util.function.LongSupplier) () -> nanos[0]);
        service = new LearnerHomeEventService(gate, cache, limiter, aggregator, jdbc);

        Block notice = block("{'block_key':'n1','type':'NOTICE','config':{'title':'t'}}");
        Block ack = block("{'block_key':'n2','type':'NOTICE','config':{'title':'t','require_ack':true}}");
        Block fixed = block("{'block_key':'n3','type':'NOTICE','config':{'title':'t','dismissible':false}}");
        Block off = block("{'block_key':'off','type':'NOTICE','enabled':false,'config':{'title':'t'}}");
        Block ended = block("{'block_key':'ended','type':'NOTICE','ends_at':'2020-01-01T00:00:00Z','config':{'title':'t'}}");
        Block later = block("{'block_key':'later','type':'NOTICE','starts_at':'2099-01-01T00:00:00Z','config':{'title':'t'}}");
        Block batch = block("{'block_key':'batch','type':'NOTICE','config':{'title':'t'},"
                + "'audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps-1']}]}}");
        Block tagged = block("{'block_key':'tagged','type':'NOTICE','config':{'title':'t','require_ack':true},"
                + "'audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','tag_ids':['t-1']}]}}");
        Block hero = block(HERO);
        Map<String, Block> byKey = new LinkedHashMap<>();
        for (Block b : List.of(hero, notice, ack, fixed, off, ended, later, batch, tagged)) byKey.put(b.blockKey(), b);
        Set<String> eventKeys = Set.of("hero", "n1", "n2", "n3", "old-key-from-v6");
        when(cache.get(INST)).thenReturn(Optional.of(new PublishedLayout("l", 7, Settings.DEFAULT,
                List.copyOf(byKey.values()), byKey, eventKeys)));
    }

    static String event(String key, String type) {
        return "{'block_key':'" + key + "','type':'" + type + "','device':'PHONE','platform':'ANDROID','layout_version':7}";
    }

    static String body(String... events) {
        return "{'events':[" + String.join(",", events) + "]}";
    }

    @Test
    void viewsAreAggregatedAndClicksWrittenAsRows() {
        LearnerHomeEventService.Recorded r = service.record(INST, "u1", json(body(
                event("hero", "VIEW"), event("hero", "VIEW"), event("old-key-from-v6", "VIEW"),
                event("n1", "CLICK"))));
        assertEquals(3, r.views());
        assertEquals(1, r.clicks());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<EventRow>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).insertEvents(rows.capture());
        EventRow click = rows.getValue().get(0);
        assertEquals("CLICK", click.eventType());
        assertEquals("u1", click.userId());
        assertEquals(7, click.layoutVersion());
        assertEquals("ANDROID", click.platform());

        aggregator.flush();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LearnerHomeJdbc.ViewRow>> views = ArgumentCaptor.forClass(List.class);
        verify(jdbc).upsertViews(views.capture());
        long heroViews = views.getValue().stream().filter(v -> v.blockKey().equals("hero")).mapToLong(LearnerHomeJdbc.ViewRow::views).sum();
        assertEquals(2, heroViews);
    }

    @Test
    void unknownOrMalformedEventsAreDropped() {
        LearnerHomeEventService.Recorded r = service.record(INST, "u1", json(body(
                event("not-a-block", "CLICK"),
                event("n1", "HOVER"),
                "{'block_key':'n1','type':'CLICK','device':'WATCH'}",
                "{'block_key':'n1','type':'CLICK','device':'PHONE','item_key':'bad key with spaces'}",
                "'just a string'")));
        assertEquals(0, r.views() + r.clicks());
        verify(jdbc, never()).insertEvents(any());
        assertEquals(0, service.record(INST, "u1", json("{'nope':1}")).views());
        assertEquals(0, service.record(INST, "u1", null).views());
    }

    @Test
    void moreThanFiftyEventsAreCut() {
        String[] many = new String[60];
        for (int i = 0; i < 60; i++) many[i] = event("hero", "VIEW");
        assertEquals(50, service.record(INST, "u1", json(body(many))).views());
    }

    @Test
    void rateLimitDropsTheExcessAndRefills() {
        String[] fifty = new String[50];
        for (int i = 0; i < 50; i++) fifty[i] = event("hero", "VIEW");
        int total = 0;
        for (int i = 0; i < 7; i++) total += service.record(INST, "u1", json(body(fifty))).views();
        assertEquals(300, total, "300 events per learner per minute");
        assertEquals(50, service.record(INST, "u2", json(body(fifty))).views(), "other learners are not affected");
        nanos[0] += 30_000_000_000L; // half a minute refills half the bucket
        assertEquals(50, service.record(INST, "u1", json(body(fifty))).views());
    }

    @Test
    void moduleOffOrNoLayoutKeepsNothing() {
        when(gate.moduleEnabled(INST)).thenReturn(false);
        assertEquals(0, service.record(INST, "u1", json(body(event("hero", "VIEW")))).views());
        when(gate.moduleEnabled(INST)).thenReturn(true);
        when(cache.get(INST)).thenReturn(Optional.empty());
        assertEquals(0, service.record(INST, "u1", json(body(event("hero", "VIEW")))).views());
    }

    @Test
    void clientTimestampIsClampedToTheLastTenMinutes() {
        Instant now = Instant.parse("2026-11-16T10:00:00Z");
        assertEquals(now, LearnerHomeEventServiceAccess.clamp(Instant.parse("2026-11-16T11:00:00Z"), now));
        assertEquals(Instant.parse("2026-11-16T09:50:00Z"),
                LearnerHomeEventServiceAccess.clamp(Instant.parse("2026-11-15T00:00:00Z"), now));
        assertEquals(Instant.parse("2026-11-16T09:55:00Z"),
                LearnerHomeEventServiceAccess.clamp(Instant.parse("2026-11-16T09:55:00Z"), now));
        assertEquals(now, LearnerHomeEventServiceAccess.clamp(null, now));
    }

    // ── Dismiss / ack ───────────────────────────────────────────────────────

    @Test
    void aRepeatedOrConcurrentDismissWritesOneEvent() {
        // The state write answers true only for the call that set the time (INSERT ... ON CONFLICT ... RETURNING).
        when(jdbc.dismiss(INST, "u1", "n1")).thenReturn(true, false);
        service.dismiss(INST, "u1", "n1");
        service.dismiss(INST, "u1", "n1");
        verify(jdbc, times(2)).dismiss(INST, "u1", "n1");
        verify(jdbc, times(1)).insertEvents(argThat(l -> l.size() == 1 && l.get(0).eventType().equals("DISMISS")));
    }

    @Test
    void dismissNeedsAckFirstWhenRequiredAndRespectsDismissible() {
        assertEquals("ACK_REQUIRED", assertThrows(LearnerHomeException.class, () -> service.dismiss(INST, "u1", "n2")).getCode());
        assertEquals("NOT_DISMISSIBLE", assertThrows(LearnerHomeException.class, () -> service.dismiss(INST, "u1", "n3")).getCode());
        when(jdbc.acknowledge(INST, "u1", "n2")).thenReturn(true, false);
        service.acknowledge(INST, "u1", "n2");
        service.acknowledge(INST, "u1", "n2");
        verify(jdbc, times(1)).insertEvents(argThat(l -> l.size() == 1 && l.get(0).eventType().equals("ACK")));
        when(jdbc.state(INST, "u1", "n2")).thenReturn(new BlockState("n2", null, Instant.now()));
        service.dismiss(INST, "u1", "n2");
        verify(jdbc).dismiss(INST, "u1", "n2");
    }

    @Test
    void onlyANoticeServedToThisLearnerCanBeDismissedOrAcknowledged() {
        for (String key : List.of("off", "ended", "later")) {
            assertEquals("BLOCK_NOT_FOUND", assertThrows(LearnerHomeException.class,
                    () -> service.dismiss(INST, "u1", key)).getCode(), key);
        }
        // Audience: u1 is not in ps-1, u2 is.
        when(jdbc.enrolments(INST, "u1")).thenReturn(List.of());
        when(jdbc.enrolments(INST, "u2")).thenReturn(List.of(new LearnerHomeJdbc.Enrolment("ps-1", "p-1")));
        assertEquals("BLOCK_NOT_FOUND", assertThrows(LearnerHomeException.class,
                () -> service.dismiss(INST, "u1", "batch")).getCode());
        when(jdbc.dismiss(INST, "u2", "batch")).thenReturn(true);
        service.dismiss(INST, "u2", "batch");
        verify(jdbc, never()).dismiss(INST, "u1", "batch");
        verify(jdbc, never()).tagIds(any(), any());
        // Tags are read only for a tag audience.
        when(jdbc.tagIds(INST, "u1")).thenReturn(List.of("t-1"));
        when(jdbc.acknowledge(INST, "u1", "tagged")).thenReturn(true);
        service.acknowledge(INST, "u1", "tagged");
        assertEquals("BLOCK_NOT_FOUND", assertThrows(LearnerHomeException.class,
                () -> service.acknowledge(INST, "u2", "tagged")).getCode());
        verify(jdbc, never()).acknowledge(INST, "u2", "tagged");
        // An open notice for everyone needs no facts at all.
        when(jdbc.dismiss(INST, "u3", "n1")).thenReturn(true);
        service.dismiss(INST, "u3", "n1");
        verify(jdbc, never()).enrolments(INST, "u3");
    }

    @Test
    void onlyNoticesOfThePublishedVersion() {
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.dismiss(INST, "u1", "hero"));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("BLOCK_NOT_FOUND", assertThrows(LearnerHomeException.class, () -> service.acknowledge(INST, "u1", "nope")).getCode());
        assertEquals("ACK_NOT_REQUIRED", assertThrows(LearnerHomeException.class, () -> service.acknowledge(INST, "u1", "n1")).getCode());
        when(gate.moduleEnabled(INST)).thenReturn(false);
        assertEquals("BLOCK_NOT_FOUND", assertThrows(LearnerHomeException.class, () -> service.dismiss(INST, "u1", "n1")).getCode());
    }
}
