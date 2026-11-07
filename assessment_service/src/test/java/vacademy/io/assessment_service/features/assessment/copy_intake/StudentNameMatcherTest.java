package vacademy.io.assessment_service.features.assessment.copy_intake;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Result;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Verdict;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The matcher decides whose record a scanned copy lands on. Wrong-but-confident
 * is the failure that matters, so every case that must NOT auto-match is here
 * next to the ones that must.
 */
class StudentNameMatcherTest {

    private static Candidate c(String id, String name) {
        return Candidate.builder().userId(id).name(name).build();
    }

    private static Candidate c(String id, String name, String roll) {
        return Candidate.builder().userId(id).name(name).rollNumber(roll).build();
    }

    private final List<Candidate> classX = List.of(
            c("u1", "Najam Ismail"), c("u2", "Aman Sharma"), c("u3", "Aman Verma"),
            c("u4", "Priya Singh"), c("u5", "Anushka Soni"), c("u6", "Rohit Kumar Yadav"));

    @Test
    void exactNameMatches() {
        Result r = StudentNameMatcher.match("Anushka Soni", null, classX);
        assertEquals(Verdict.MATCHED, r.getVerdict());
        assertEquals("u5", r.getBest().getCandidate().getUserId());
    }

    @Test
    void caseSpacingAndOrderDoNotMatter() {
        assertEquals("u1", StudentNameMatcher.match("ISMAIL  najam", null, classX).getBest().getCandidate().getUserId());
        assertEquals(Verdict.MATCHED, StudentNameMatcher.match("ISMAIL  najam", null, classX).getVerdict());
    }

    @Test
    void aHandwrittenMisspellingStillMatches() {
        Result r = StudentNameMatcher.match("Anuska Sony", null, classX);
        assertEquals("u5", r.getBest().getCandidate().getUserId());
        assertTrue(r.getVerdict() == Verdict.MATCHED || r.getVerdict() == Verdict.AMBIGUOUS,
                "a near spelling is matched or offered, never dropped: " + r.getVerdict());
    }

    @Test
    void twoStudentsWithTheSameFirstNameIsAmbiguousNotAGuess() {
        // Only "Aman" was written: Sharma and Verma both fit.
        Result r = StudentNameMatcher.match("Aman", null, classX);
        assertEquals(Verdict.AMBIGUOUS, r.getVerdict());
        assertEquals(2, r.getShortlist().stream().filter(s -> s.getScore() >= 0.8).count());
    }

    @Test
    void twoIdenticalNamesOnTheRosterAreAmbiguous() {
        List<Candidate> twins = List.of(c("a", "Aman Sharma"), c("b", "Aman Sharma"), c("c", "Priya Singh"));
        Result r = StudentNameMatcher.match("Aman Sharma", null, twins);
        assertEquals(Verdict.AMBIGUOUS, r.getVerdict());
        assertTrue(r.getReason().contains("equally"));
    }

    @Test
    void aFullNameDistinguishesTheTwoAmans() {
        assertEquals("u3", StudentNameMatcher.match("Aman Verma", null, classX).getBest().getCandidate().getUserId());
        assertEquals(Verdict.MATCHED, StudentNameMatcher.match("Aman Verma", null, classX).getVerdict());
    }

    @Test
    void initialsMatchTheSurname() {
        Result r = StudentNameMatcher.match("P. Singh", null, classX);
        assertEquals("u4", r.getBest().getCandidate().getUserId());
    }

    @Test
    void aNameNotOnTheRosterIsUnmatched() {
        Result r = StudentNameMatcher.match("Newton", null, classX);
        assertEquals(Verdict.UNMATCHED, r.getVerdict());
    }

    @Test
    void noNameReadIsUnmatchedWithAReason() {
        Result r = StudentNameMatcher.match(null, null, classX);
        assertEquals(Verdict.UNMATCHED, r.getVerdict());
        assertNotNull(r.getReason());
        assertEquals(Verdict.UNMATCHED, StudentNameMatcher.match("   ", "", classX).getVerdict());
    }

    @Test
    void emptyRosterIsUnmatched() {
        assertEquals(Verdict.UNMATCHED, StudentNameMatcher.match("Anushka Soni", null, List.of()).getVerdict());
    }

    @Test
    void rollNumberBeatsTheName() {
        List<Candidate> withRolls = List.of(c("a", "Aman Sharma", "23"), c("b", "Aman Sharma", "024"));
        Result r = StudentNameMatcher.match("Aman Sharma", "24", withRolls);
        assertEquals(Verdict.MATCHED, r.getVerdict());
        assertEquals("b", r.getBest().getCandidate().getUserId());
        assertTrue(r.getReason().contains("roll number"));
    }

    @Test
    void anUnknownRollNumberFallsBackToTheName() {
        List<Candidate> withRolls = List.of(c("a", "Priya Singh", "23"), c("b", "Aman Sharma", "24"));
        Result r = StudentNameMatcher.match("Priya Singh", "99", withRolls);
        assertEquals(Verdict.MATCHED, r.getVerdict());
        assertEquals("a", r.getBest().getCandidate().getUserId());
    }

    @Test
    void honorificsAndDotsAreIgnored() {
        assertEquals(Verdict.MATCHED, StudentNameMatcher.match("Miss. Priya Singh", null, classX).getVerdict());
        assertEquals(Verdict.MATCHED, StudentNameMatcher.match("Kumari Priya Singh", null, classX).getVerdict());
    }

    @Test
    void aLongerNameOnTheCopyThanOnTheRosterIsNotForcedOntoAShortOne() {
        // "Rohit Kumar Yadav Verma" vs roster "Rohit Kumar Yadav": still him.
        Result r = StudentNameMatcher.match("Rohit Kumar Yadav", null, classX);
        assertEquals("u6", r.getBest().getCandidate().getUserId());
        assertEquals(Verdict.MATCHED, r.getVerdict());
    }

    @Test
    void shortlistIsRankedBestFirstAndCapped() {
        List<Candidate> many = new java.util.ArrayList<>();
        for (int i = 0; i < 20; i++) many.add(c("u" + i, "Aman Kumar " + (char) ('A' + i)));
        Result r = StudentNameMatcher.match("Aman Kumar", null, many);
        assertTrue(r.getShortlist().size() <= StudentNameMatcher.MAX_CANDIDATES);
        for (int i = 1; i < r.getShortlist().size(); i++) {
            assertTrue(r.getShortlist().get(i - 1).getScore() >= r.getShortlist().get(i).getScore());
        }
        assertEquals(Verdict.AMBIGUOUS, r.getVerdict());
    }
}
