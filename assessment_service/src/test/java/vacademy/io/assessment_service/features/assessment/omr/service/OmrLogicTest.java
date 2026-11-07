package vacademy.io.assessment_service.features.assessment.omr.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineResponseSubmitRequest;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrSetJson;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrPaperLoader.PaperQuestion;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The pure rules of OMR: how a set orders the paper, what a bubble means, and whose
 * sheet a roll number is. Every one of them decides a learner's marks.
 */
class OmrLogicTest {

    private static PaperQuestion q(String id, String section, String... options) {
        return new PaperQuestion(id, section, "MCQS", new ArrayList<>(List.of(options)), List.of(options[0]));
    }

    private static List<PaperQuestion> paper() {
        List<PaperQuestion> p = new ArrayList<>();
        for (int i = 1; i <= 6; i++) p.add(q("s1q" + i, "S1", "s1q" + i + "a", "s1q" + i + "b", "s1q" + i + "c", "s1q" + i + "d"));
        for (int i = 1; i <= 4; i++) p.add(q("s2q" + i, "S2", "s2q" + i + "a", "s2q" + i + "b"));
        return p;
    }

    // ---------------------------------------------------------------- set order

    @Test
    void setAKeepsTheAuthoredOrder() {
        List<OmrSetJson.Item> items = OmrSetService.order(paper(), null, true, true);
        assertEquals(10, items.size());
        for (int i = 0; i < 10; i++) {
            assertEquals(i + 1, items.get(i).getNo());
            assertEquals(paper().get(i).questionId(), items.get(i).getQuestionId());
            assertEquals(paper().get(i).optionIds(), items.get(i).getOptionIds());
        }
    }

    @Test
    void sameSeedSameSetAndSectionsStayTogether() {
        List<OmrSetJson.Item> a = OmrSetService.order(paper(), new Random(42), true, true);
        List<OmrSetJson.Item> b = OmrSetService.order(paper(), new Random(42), true, true);
        assertEquals(a, b);
        // section 1 occupies 1..6 and section 2 7..10, in any order inside
        for (int i = 0; i < 6; i++) assertEquals("S1", a.get(i).getSectionId());
        for (int i = 6; i < 10; i++) assertEquals("S2", a.get(i).getSectionId());
        // every question and every option is still there exactly once
        Set<String> ids = new HashSet<>();
        a.forEach(it -> ids.add(it.getQuestionId()));
        assertEquals(10, ids.size());
        for (OmrSetJson.Item it : a) {
            PaperQuestion original = paper().stream().filter(p -> p.questionId().equals(it.getQuestionId())).findFirst().orElseThrow();
            assertEquals(new HashSet<>(original.optionIds()), new HashSet<>(it.getOptionIds()));
        }
    }

    @Test
    void optionsStayPutWhenOnlyQuestionsShuffle() {
        for (OmrSetJson.Item it : OmrSetService.order(paper(), new Random(7), true, false)) {
            PaperQuestion original = paper().stream().filter(p -> p.questionId().equals(it.getQuestionId())).findFirst().orElseThrow();
            assertEquals(original.optionIds(), it.getOptionIds());
        }
    }

    @Test
    void paperIssuesNameTheQuestions() {
        List<PaperQuestion> p = paper();
        p.set(1, new PaperQuestion("x", "S1", "MCQM", List.of("a", "b"), List.of("a", "b")));
        p.set(2, new PaperQuestion("y", "S1", "MCQS", List.of("a"), List.of("a")));
        p.set(3, new PaperQuestion("z", "S1", "MCQS", List.of("a", "b", "c"), List.of()));
        List<String> issues = OmrSetService.paperIssues(p);
        assertEquals(3, issues.size());
        assertTrue(issues.get(0).contains("2"), issues.get(0));
        assertTrue(issues.get(1).contains("3"), issues.get(1));
        assertTrue(issues.get(2).contains("4"), issues.get(2));
        assertTrue(OmrSetService.paperIssues(paper()).isEmpty());
        assertFalse(OmrSetService.paperIssues(List.of()).isEmpty());
    }

    // ------------------------------------------------------------ bubble -> option

    private static OmrSetJson set() {
        return OmrSetJson.builder().kind(OmrSetJson.KIND).v(1).setCode("B").rollDigits(4)
                .items(List.of(
                        OmrSetJson.Item.builder().no(1).questionId("q1").sectionId("S1").optionIds(List.of("o1c", "o1a", "o1d", "o1b")).build(),
                        OmrSetJson.Item.builder().no(2).questionId("q2").sectionId("S1").optionIds(List.of("o2a", "o2b")).build(),
                        OmrSetJson.Item.builder().no(3).questionId("q3").sectionId("S2").optionIds(List.of("o3a", "o3b", "o3c")).build(),
                        OmrSetJson.Item.builder().no(4).questionId("q4").sectionId("S2").optionIds(List.of("o4a", "o4b", "o4c")).build()))
                .build();
    }

    private static Map<String, List<String>> chosen(OfflineResponseSubmitRequest r) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        r.getSections().forEach(s -> s.getQuestions().forEach(q -> out.put(q.getQuestionId(), q.getOptionIds())));
        return out;
    }

    @Test
    void lettersMapThroughTheSetsOwnOptionOrder() {
        OfflineResponseSubmitRequest r = OmrScanService.responses(set(),
                Map.of("1", "B", "2", "A", "3", "", "4", "AC"), Map.of());
        Map<String, List<String>> c = chosen(r);
        assertEquals(List.of("o1a"), c.get("q1"));   // B on set B's sheet is the authored option a
        assertEquals(List.of("o2a"), c.get("q2"));
        assertEquals(List.of(), c.get("q3"));        // blank = not attempted
        assertEquals(List.of(), c.get("q4"));        // two bubbles = not attempted, never negative
        assertEquals(2, r.getSections().size());
        r.getSections().forEach(s -> s.getQuestions().forEach(q -> assertEquals("MCQS", q.getType())));
    }

    @Test
    void anAdminFixReplacesWhatWasRead() {
        OfflineResponseSubmitRequest r = OmrScanService.responses(set(),
                Map.of("1", "B", "2", "A", "3", "", "4", "AC"), Map.of("4", "C", "1", ""));
        Map<String, List<String>> c = chosen(r);
        assertEquals(List.of("o4c"), c.get("q4"));
        assertEquals(List.of(), c.get("q1"));
    }

    @Test
    void aLetterBeyondTheQuestionsOptionsIsIgnored() {
        Map<String, List<String>> c = chosen(OmrScanService.responses(set(), Map.of("2", "D"), Map.of()));
        assertEquals(List.of(), c.get("q2"));
    }

    // --------------------------------------------------------------- roll numbers

    @Test
    void rollIsPaddedAndMayStartLeftOrRight() {
        assertEquals("000427", OmrRollService.normalizeRead(List.of("", "", "4", "2", "7", ""), 6).key());
        assertEquals("000427", OmrRollService.normalizeRead(List.of("4", "2", "7", "", "", ""), 6).key());
        assertEquals("000427", OmrRollService.normalizeRead(List.of("0", "0", "0", "4", "2", "7"), 6).key());
        assertEquals("120034", OmrRollService.normalizeRead(List.of("1", "2", "0", "0", "3", "4"), 6).key());
    }

    @Test
    void doubtfulRollsAreNotMatched() {
        assertEquals("ROLL_BLANK", OmrRollService.normalizeRead(List.of("", "", "", ""), 4).problem());
        assertEquals("ROLL_BLANK", OmrRollService.normalizeRead(List.of("1", "", "3", "4"), 4).problem());
        assertEquals("ROLL_MULTI", OmrRollService.normalizeRead(List.of("1", "27", "3", "4"), 4).problem());
        assertNull(OmrRollService.normalizeRead(List.of("1", "27", "3", "4"), 4).key());
        assertEquals("1*3?", OmrRollService.display(List.of("1", "27", "3", "")));
    }

    @Test
    void fileKindFromName() {
        assertEquals("image", OmrScanService.kind("IMG_2001.JPG"));
        assertEquals("image", OmrScanService.kind("scan.png"));
        assertEquals("pdf", OmrScanService.kind("class-10A.pdf"));
        assertEquals("pdf", OmrScanService.kind(null));
    }
}
