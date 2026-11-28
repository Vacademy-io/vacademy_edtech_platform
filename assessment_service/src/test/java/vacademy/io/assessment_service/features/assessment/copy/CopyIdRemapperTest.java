package vacademy.io.assessment_service.features.assessment.copy;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CopyIdRemapperTest {

    private final CopyIdRemapper remap = new CopyIdRemapper(Map.of(
            "opt-a", "new-a",
            "opt-b", "new-b",
            "q-1", "new-q-1",
            "sec-1", "new-sec-1"));

    @Test
    void answerKeyPointsAtTheCopiedOptions() {
        String key = "{\"type\":\"MCQM\",\"data\":{\"correctOptionIds\":[\"opt-a\",\"opt-b\"]}}";
        assertEquals("{\"type\":\"MCQM\",\"data\":{\"correctOptionIds\":[\"new-a\",\"new-b\"]}}", remap.json(key));
    }

    @Test
    void idsUsedAsObjectKeysAndNestedValuesAreRewritten() {
        String set = "{\"sections\":[{\"sectionId\":\"sec-1\",\"questions\":{\"q-1\":{\"order\":2}}}]}";
        String out = remap.json(set);
        assertTrue(out.contains("\"sectionId\":\"new-sec-1\""), out);
        assertTrue(out.contains("\"new-q-1\":{\"order\":2}"), out);
        assertFalse(out.contains("\"q-1\""), out);
    }

    @Test
    void textThatOnlyContainsAnIdIsLeftAlone() {
        String json = "{\"note\":\"see opt-a for details\",\"value\":\"opt-a-2\"}";
        assertSame(json, remap.json(json));
    }

    @Test
    void untouchedJsonKeepsItsExactText() {
        String json = "{ \"type\" : \"NUMERIC\", \"data\": {\"validAnswers\": [3.10, 1E+2]} }";
        assertSame(json, remap.json(json));
    }

    @Test
    void notJsonAndNullAreReturnedAsIs() {
        assertEquals("plain text", remap.json("plain text"));
        assertNull(remap.json(null));
        assertEquals("", remap.json(""));
    }

    @Test
    void questionIdListIsRemapped() {
        assertEquals("[\"new-q-1\",\"q-9\"]", remap.json("[\"q-1\",\"q-9\"]"));
    }

    @Test
    void idFallsBackToTheOriginalWhenNotCopied() {
        assertEquals("new-q-1", remap.id("q-1"));
        assertEquals("q-9", remap.id("q-9"));
        assertNull(remap.id(null));
    }

    @Test
    void defaultMarkingIsOneMarkNoPenaltyAndKeepsTypeAndPartialShare() {
        String marking = "{\"type\":\"MCQM\",\"data\":{\"totalMark\":\"4\",\"negativeMark\":\"1\","
                + "\"negativeMarkingPercentage\":25,\"partialMarking\":0.5,\"partialMarkingPercentage\":50}}";
        assertEquals("{\"type\":\"MCQM\",\"data\":{\"totalMark\":\"1\",\"negativeMark\":\"0\","
                + "\"negativeMarkingPercentage\":0,\"partialMarking\":0.5,\"partialMarkingPercentage\":50}}",
                CopyIdRemapper.defaultMarking(marking));
    }

    @Test
    void unreadableMarkingIsKept() {
        assertEquals("not json", CopyIdRemapper.defaultMarking("not json"));
        assertEquals("{\"type\":\"MCQS\"}", CopyIdRemapper.defaultMarking("{\"type\":\"MCQS\"}"));
        assertNull(CopyIdRemapper.defaultMarking(null));
    }

    @Test
    void omrLockIsDroppedAndTheRestOfTheConfigKept() {
        assertEquals("{\"set_count\":3,\"shuffle_questions\":true,\"density\":\"LARGE\"}",
                CopyIdRemapper.withoutKey("{\"set_count\":3,\"shuffle_questions\":true,\"density\":\"LARGE\","
                        + "\"locked_at\":1764000000000}", "locked_at"));
        String unlocked = "{ \"set_count\": 2 }";
        assertSame(unlocked, CopyIdRemapper.withoutKey(unlocked, "locked_at"));
        assertEquals("not json", CopyIdRemapper.withoutKey("not json", "locked_at"));
        assertNull(CopyIdRemapper.withoutKey(null, "locked_at"));
    }

    @Test
    void sentMarkersAreRecognised() {
        assertTrue(AssessmentCopyService.isSentMarker("participant_reminder_sent_for"));
        assertTrue(AssessmentCopyService.isSentMarker("participant_live_sent_for"));
        assertTrue(AssessmentCopyService.isSentMarker("confirmation_email_sent_at"));
        assertFalse(AssessmentCopyService.isSentMarker("participant_when_assessment_live"));
        assertFalse(AssessmentCopyService.isSentMarker("participant_before_assessment_goes_live"));
        assertFalse(AssessmentCopyService.isSentMarker("registration_time"));
    }
}
