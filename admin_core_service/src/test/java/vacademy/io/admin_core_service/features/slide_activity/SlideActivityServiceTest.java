package vacademy.io.admin_core_service.features.slide_activity;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SlideActivityServiceTest {

    @Test
    void pollParsesOptionsAndSettings() {
        SlideActivityService.PollSpec spec = SlideActivityService.parsePoll(
                "{\"question\":\"Q\",\"options\":[{\"id\":\"a\",\"text\":\"Yes\"},{\"id\":\"b\",\"text\":\" \"},"
                        + "{\"id\":\"\",\"text\":\"No id\"},{\"id\":\"c\",\"text\":\"No\"}],"
                        + "\"settings\":{\"results\":\"ALWAYS\",\"allowChange\":true}}");
        assertEquals(2, spec.options().size());
        assertTrue(spec.has("a"));
        assertFalse(spec.has("b"));
        assertEquals("ALWAYS", spec.results());
        assertTrue(spec.allowChange());
    }

    @Test
    void pollDefaultsAreAfterVoteAndOneVote() {
        SlideActivityService.PollSpec spec = SlideActivityService.parsePoll(
                "{\"options\":[{\"id\":\"a\",\"text\":\"Yes\"}],\"settings\":{\"results\":\"WHATEVER\"}}");
        assertEquals("AFTER_VOTE", spec.results());
        assertFalse(spec.allowChange());
    }

    @Test
    void unreadablePollTakesNoVotesAndShowsNothing() {
        SlideActivityService.PollSpec spec = SlideActivityService.parsePoll("{not json");
        assertTrue(spec.options().isEmpty());
        assertEquals("TEACHER_ONLY", spec.results());
    }

    @Test
    void gameMaxComesFromTheSlideAndIsCapped() {
        assertEquals(10.0, SlideActivityService.parseGameMax("{\"maxScore\":10}"));
        assertEquals(1000.0, SlideActivityService.parseGameMax("{\"maxScore\":99999}"));
        assertNull(SlideActivityService.parseGameMax("{\"maxScore\":0}"));
        assertNull(SlideActivityService.parseGameMax("{\"html\":\"x\"}"));
        assertNull(SlideActivityService.parseGameMax(null));
    }

    @Test
    void scoresAreClampedToTheSlidesMaxNotThePagesClaim() {
        assertArrayEquals(new double[] {10, 10}, SlideActivityService.clampScore(50.0, 50.0, 10.0));
        assertArrayEquals(new double[] {0, 10}, SlideActivityService.clampScore(-3.0, null, 10.0));
        assertArrayEquals(new double[] {7, 20}, SlideActivityService.clampScore(7.0, 20.0, null));
        assertArrayEquals(new double[] {1000, 1000}, SlideActivityService.clampScore(5000.0, 1e9, null));
        assertArrayEquals(new double[] {0, 1000}, SlideActivityService.clampScore(Double.NaN, null, null));
    }
}
