package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.ClassLearner;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardDetailService.FeedbackQuestion;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardDetailService.ParsedFeedback;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardDetailService.ScheduleTime;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LiveClassDashboardDetailServiceTest {

    private static final String CONFIG = """
            {"enabled":true,"questions":[
              {"id":"rating","type":"star_rating","label":"How was the session?"},
              {"id":"learnings","type":"free_text","label":"What did you learn?"},
              {"id":"doubts","type":"free_text","label":"Any doubts?"}]}
            """;

    @Test
    @DisplayName("feedback: first star rating, written answers in form order, unknown keys kept")
    void parseFeedback() {
        List<FeedbackQuestion> questions = LiveClassDashboardDetailService.parseQuestions(CONFIG);
        ParsedFeedback fb = LiveClassDashboardDetailService.parseFeedback(questions,
                "{\"doubts\":\"perimeter please\",\"rating\":4.5,\"learnings\":\"  \",\"feedback\":\"network was bad\"}");
        assertEquals(4.5, fb.rating());
        assertEquals(2, fb.answers().size());
        assertEquals("Any doubts?", fb.answers().get(0).getLabel());
        assertEquals("perimeter please", fb.answers().get(0).getText());
        // Blank answers are dropped; keys missing from the config keep their key as label.
        assertEquals("feedback", fb.answers().get(1).getLabel());
    }

    @Test
    @DisplayName("feedback: malformed or empty JSON is simply no feedback")
    void parseFeedbackMalformed() {
        List<FeedbackQuestion> questions = LiveClassDashboardDetailService.parseQuestions(CONFIG);
        assertNull(LiveClassDashboardDetailService.parseFeedback(questions, "{not json").rating());
        assertTrue(LiveClassDashboardDetailService.parseFeedback(questions, null).answers().isEmpty());
        assertTrue(LiveClassDashboardDetailService.parseQuestions("[]").isEmpty());
        // A rating stored as text is not a rating.
        assertNull(LiveClassDashboardDetailService.parseFeedback(questions, "{\"rating\":\"5\"}").rating());
    }

    @Test
    @DisplayName("engagement counters come from BBB's keys, null when absent")
    void parseEngagement() {
        var eng = LiveClassDashboardDetailService.parseEngagement(
                "{\"chats\":2,\"talks\":7,\"talkTime\":13,\"raisehand\":1,\"emojis\":0,\"pollVotes\":3}");
        assertEquals(7, eng.talks());
        assertEquals(2, eng.chats());
        assertEquals(1, eng.raiseHands());
        assertEquals(3, eng.pollVotes());
        assertNull(eng.activeness());
        assertNull(LiveClassDashboardDetailService.parseEngagement(null));
        assertNull(LiveClassDashboardDetailService.parseEngagement("oops"));
    }

    @Test
    @DisplayName("activeness keys are read when present; an activeness-only row has no BBB counters")
    void parseEngagementActiveness() {
        var both = LiveClassDashboardDetailService.parseEngagement(
                "{\"chats\":2,\"talks\":7,\"activeness\":82,\"activenessOnScreen\":90,\"activenessAttention\":75,"
                        + "\"activenessSeconds\":1800,\"activenessAwayCount\":3,\"activenessAwaySeconds\":40}");
        assertEquals(7, both.talks());
        assertEquals(82, both.activeness());
        assertEquals(90, both.activenessOnScreen());
        assertEquals(75, both.activenessAttention());
        assertEquals(1800, both.activenessSeconds());
        assertEquals(3, both.activenessAwayCount());

        // Plugin report landed before the end-of-class analytics callback.
        var onlyScore = LiveClassDashboardDetailService.parseEngagement(
                "{\"activeness\":60,\"activenessSeconds\":300,\"activenessAwayCount\":0,\"activenessAwaySeconds\":0}");
        assertNull(onlyScore.talks());
        assertNull(onlyScore.chats());
        assertNull(onlyScore.activenessOnScreen());
        assertEquals(60, onlyScore.activeness());
        assertNull(onlyScore.activenessState());

        // A phone: the plugin only reports why there is no score.
        var phone = LiveClassDashboardDetailService.parseEngagement("{\"activenessState\":3}");
        assertNull(phone.activeness());
        assertNull(phone.talks());
        assertEquals(3, phone.activenessState());
    }

    @Test
    @DisplayName("no attendance row = not joined; a non-PRESENT row = below the attendance rule")
    void learnerStatus() {
        assertEquals("NOT_JOINED", LiveClassDashboardDetailService.learnerStatus(null));
        assertEquals("PRESENT", LiveClassDashboardDetailService.learnerStatus("PRESENT"));
        assertEquals("BELOW_RULE", LiveClassDashboardDetailService.learnerStatus("ABSENT"));
    }

    @Test
    @DisplayName("learners list: present first by time stayed, then below the rule, then not joined")
    void learnerOrder() {
        List<ClassLearner> list = new ArrayList<>(List.of(
                ClassLearner.builder().name("zed").status("NOT_JOINED").build(),
                ClassLearner.builder().name("amy").status("PRESENT").secondsInClass(600).build(),
                ClassLearner.builder().name("bob").status("BELOW_RULE").secondsInClass(60).build(),
                ClassLearner.builder().name("cat").status("PRESENT").secondsInClass(3000).build()));
        list.sort(LiveClassDashboardDetailService.LEARNER_ORDER);
        assertEquals(List.of("cat", "amy", "bob", "zed"), list.stream().map(ClassLearner::getName).toList());
    }

    @Test
    @DisplayName("at-risk view accepts DROPPED / NEVER in any case, everything else is ALL")
    void atRiskView() {
        assertEquals("DROPPED", LiveClassDashboardDetailService.atRiskView("dropped"));
        assertEquals("NEVER", LiveClassDashboardDetailService.atRiskView(" NEVER "));
        assertEquals("ALL", LiveClassDashboardDetailService.atRiskView(null));
        assertEquals("ALL", LiveClassDashboardDetailService.atRiskView("'; drop table x"));
    }

    @Test
    @DisplayName("at-risk counts finished classes only, and honours the teacher filter")
    void completedScheduleIds() {
        Instant now = Instant.parse("2026-09-27T10:30:00Z"); // 16:00 IST
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ScheduleTime> schedules = List.of(
                new ScheduleTime("done", "s1", today, LocalTime.of(9, 0), LocalTime.of(10, 0), "Asia/Kolkata", "t1"),
                new ScheduleTime("live", "s1", today, LocalTime.of(15, 30), LocalTime.of(16, 30), "Asia/Kolkata", "t1"),
                new ScheduleTime("later", "s1", today, LocalTime.of(18, 0), LocalTime.of(19, 0), "Asia/Kolkata", "t1"),
                new ScheduleTime("other", "s2", today, LocalTime.of(9, 0), LocalTime.of(10, 0), "Asia/Kolkata", "t2"));

        assertEquals(List.of("done", "other"),
                LiveClassDashboardDetailService.completedScheduleIds(schedules, Set.of(), Map.of(), now));
        assertEquals(List.of("other"), LiveClassDashboardDetailService.completedScheduleIds(schedules,
                Set.of("t2"), Map.of("s1", List.of("t1"), "s2", List.of("t2")), now));
    }
}
