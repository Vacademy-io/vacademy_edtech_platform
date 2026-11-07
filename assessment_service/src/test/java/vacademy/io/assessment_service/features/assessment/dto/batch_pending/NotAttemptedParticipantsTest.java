package vacademy.io.assessment_service.features.assessment.dto.batch_pending;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import vacademy.io.assessment_service.features.assessment.dto.ParticipantsDetailsDto;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The set arithmetic behind the Pending tab for batch-enrolled learners.
 *
 * <p>This decides who a teacher chases for a missing submission, so the two ways it can be
 * wrong both matter: showing a learner who did submit (teacher chases someone who already
 * sat the test) and hiding one who did not (submission silently never gets collected).
 */
class NotAttemptedParticipantsTest {

    private static final String BATCH = "batch-1";
    private static final Pageable FIRST_PAGE = PageRequest.of(0, 10);

    private static EnrolledLearnerDto learner(String userId, String name) {
        return new EnrolledLearnerDto(userId, name, BATCH);
    }

    private static List<String> namesOf(Page<ParticipantsDetailsDto> page) {
        return page.getContent().stream().map(ParticipantsDetailsDto::getStudentName).toList();
    }

    @Test
    void keepsOnlyTheEnrolledLearnersWithNoAttempt() {
        List<EnrolledLearnerDto> enrolled = List.of(
                learner("u1", "Aadya Saxena"),
                learner("u2", "Akshat Sharma"),
                learner("u3", "Amaan Saifi"));

        Page<ParticipantsDetailsDto> page =
                NotAttemptedParticipants.page(enrolled, Set.of("u2"), null, FIRST_PAGE);

        assertThat(namesOf(page)).containsExactly("Aadya Saxena", "Amaan Saifi");
        assertThat(page.getTotalElements()).isEqualTo(2);
    }

    @Test
    void anAttemptedLearnerWhoIsNoLongerEnrolledDoesNotResurface() {
        // Subtraction is one-directional on purpose: the enrolled set is the universe, so
        // an attempted user id that is not enrolled any more simply has nothing to remove.
        Page<ParticipantsDetailsDto> page = NotAttemptedParticipants.page(
                List.of(learner("u1", "Aadya Saxena")), Set.of("ghost-user"), null, FIRST_PAGE);

        assertThat(namesOf(page)).containsExactly("Aadya Saxena");
    }

    @Test
    void ordersByNameThenUserIdSoPagingIsStableAcrossNamesakes() {
        // Two learners really can share a name; without the id tie-breaker a page boundary
        // between them can repeat one and skip the other.
        List<EnrolledLearnerDto> enrolled = List.of(
                learner("u9", "Amar"),
                learner("u3", "Amar"),
                learner("u1", "Aadya Saxena"));

        Page<ParticipantsDetailsDto> page =
                NotAttemptedParticipants.page(enrolled, Set.of(), null, FIRST_PAGE);

        assertThat(page.getContent().stream().map(ParticipantsDetailsDto::getUserId))
                .containsExactly("u1", "u3", "u9");
    }

    @Test
    void sortsCaseInsensitivelyToMatchThePostgresCollation() {
        // The DB is en_US.UTF-8, so the attempted list reads "archa, MIDHUN, Rahana".
        // A case-sensitive sort here would make this tab disagree with every other tab.
        List<EnrolledLearnerDto> enrolled = List.of(
                learner("u1", "MIDHUN TK"),
                learner("u2", "archa d p"),
                learner("u3", "Rahana"));

        Page<ParticipantsDetailsDto> page =
                NotAttemptedParticipants.page(enrolled, Set.of(), null, FIRST_PAGE);

        assertThat(namesOf(page)).containsExactly("archa d p", "MIDHUN TK", "Rahana");
    }

    @Test
    void nameSearchIsACaseInsensitiveSubstringMatch() {
        List<EnrolledLearnerDto> enrolled = List.of(
                learner("u1", "Aadya Saxena"),
                learner("u2", "Akshat Sharma"),
                learner("u3", "Amaan Saifi"));

        assertThat(namesOf(NotAttemptedParticipants.page(enrolled, Set.of(), "sha", FIRST_PAGE)))
                .containsExactly("Akshat Sharma");
        assertThat(namesOf(NotAttemptedParticipants.page(enrolled, Set.of(), "  AADYA  ", FIRST_PAGE)))
                .containsExactly("Aadya Saxena");
        assertThat(namesOf(NotAttemptedParticipants.page(enrolled, Set.of(), "   ", FIRST_PAGE)))
                .hasSize(3);
    }

    @Test
    void pagesWithoutRunningOffTheEndOfTheList() {
        List<EnrolledLearnerDto> enrolled = List.of(
                learner("u1", "A"), learner("u2", "B"), learner("u3", "C"));

        Page<ParticipantsDetailsDto> second =
                NotAttemptedParticipants.page(enrolled, Set.of(), null, PageRequest.of(1, 2));
        assertThat(namesOf(second)).containsExactly("C");
        assertThat(second.getTotalElements()).isEqualTo(3);
        assertThat(second.getTotalPages()).isEqualTo(2);

        // A teacher sitting on a page that no longer exists (learners submitted while they
        // were looking) must get an empty page, not an IndexOutOfBounds.
        Page<ParticipantsDetailsDto> past =
                NotAttemptedParticipants.page(enrolled, Set.of(), null, PageRequest.of(9, 10));
        assertThat(past.getContent()).isEmpty();
        assertThat(past.getTotalElements()).isEqualTo(3);
    }

    @Test
    void toleratesMissingNamesAndNullRowsRatherThanFailingThePage() {
        List<EnrolledLearnerDto> enrolled = java.util.Arrays.asList(
                learner("u1", null),
                null,
                new EnrolledLearnerDto(null, "No user id", BATCH),
                learner("u2", "Zoya"));

        Page<ParticipantsDetailsDto> page =
                NotAttemptedParticipants.page(enrolled, Set.of(), null, FIRST_PAGE);

        assertThat(page.getContent()).hasSize(2);
        assertThat(page.getContent().get(0).getUserId()).isEqualTo("u1");
        assertThat(page.getContent().get(1).getStudentName()).isEqualTo("Zoya");
    }

    @Test
    void everyAttemptDerivedFieldIsNullBecauseTheseLearnersNeverStarted() {
        // The Pending row mapping and both sidebars must read these as "never started",
        // so the contract is explicit rather than incidental.
        ParticipantsDetailsDto row = NotAttemptedParticipants
                .page(List.of(learner("u1", "Aadya Saxena")), Set.of(), null, FIRST_PAGE)
                .getContent()
                .get(0);

        assertThat(row.getUserId()).isEqualTo("u1");
        assertThat(row.getStudentName()).isEqualTo("Aadya Saxena");
        assertThat(row.getBatchId()).isEqualTo(BATCH);
        assertThat(row.getRegistrationId()).isNull();
        assertThat(row.getAttemptId()).isNull();
        assertThat(row.getScore()).isNull();
        assertThat(row.getAttemptDate()).isNull();
        assertThat(row.getEndTime()).isNull();
        assertThat(row.getDuration()).isNull();
        assertThat(row.getEvaluationStatus()).isNull();
        assertThat(row.getReportReleaseResultStatus()).isNull();
        assertThat(row.getLastReportReleaseDate()).isNull();
    }

    // --- contact details: what the tab needs to actually chase these learners ---

    @Test
    void contactDetailsReachTheRowSoTheTabCanShowWhatItsOwnCsvShows() {
        // The Pending tab and its "not attempted" export answer the same question; a
        // learner the tab can only name, while the CSV gives an email and a phone number,
        // sends the teacher to the export for every follow-up.
        EnrolledLearnerDto learner = new EnrolledLearnerDto(
                "u1", "Aadya Saxena", BATCH, "aadya@example.com", "9876543210", "aadya123");

        ParticipantsDetailsDto row = NotAttemptedParticipants
                .page(List.of(learner), Set.of(), null, FIRST_PAGE)
                .getContent()
                .get(0);

        assertThat(row.getUserEmail()).isEqualTo("aadya@example.com");
        assertThat(row.getPhoneNumber()).isEqualTo("9876543210");
        assertThat(row.getUsername()).isEqualTo("aadya123");
    }

    @Test
    void aLearnerImportedWithoutContactDetailsStillAppearsWithBlanksRatherThanBeingDropped() {
        ParticipantsDetailsDto row = NotAttemptedParticipants
                .page(List.of(learner("u1", "Aadya Saxena")), Set.of(), null, FIRST_PAGE)
                .getContent()
                .get(0);

        assertThat(row.getStudentName()).isEqualTo("Aadya Saxena");
        assertThat(row.getUserEmail()).isNull();
        assertThat(row.getPhoneNumber()).isNull();
        assertThat(row.getUsername()).isNull();
    }

    // --- resolveBatchIds: which batches we are even allowed to look at ---

    @Test
    void aFilterChipForABatchThisAssessmentWasNeverAssignedToIsIgnored() {
        // The admin batch filter is built from every batch in the INSTITUTE, so a teacher
        // can select one this assessment was never given to. Without the intersection its
        // learners would all be listed as "has not attempted" and chased for an exam they
        // were never set.
        List<String> assigned = List.of("assigned-a", "assigned-b");

        assertThat(NotAttemptedParticipants.resolveBatchIds(assigned, List.of("foreign-batch")))
                .isEmpty();
        assertThat(NotAttemptedParticipants.resolveBatchIds(assigned, List.of("assigned-b", "foreign-batch")))
                .containsExactly("assigned-b");
    }

    @Test
    void noFilterChipsMeansEveryAssignedBatch() {
        List<String> assigned = List.of("assigned-b", "assigned-a");

        assertThat(NotAttemptedParticipants.resolveBatchIds(assigned, null))
                .containsExactly("assigned-a", "assigned-b");
        assertThat(NotAttemptedParticipants.resolveBatchIds(assigned, List.of()))
                .containsExactly("assigned-a", "assigned-b");
    }

    @Test
    void anAssessmentWithNoAssignedBatchesResolvesToNothing() {
        // No batch registrations means nobody was set this test, so there is nobody to
        // chase — and the caller must not make a cross-service call.
        assertThat(NotAttemptedParticipants.resolveBatchIds(List.of(), List.of("anything"))).isEmpty();
        assertThat(NotAttemptedParticipants.resolveBatchIds(null, null)).isEmpty();
    }

    @Test
    void resolvedBatchIdsAreDedupedAndSortedSoCallersShareACacheEntry() {
        assertThat(NotAttemptedParticipants.resolveBatchIds(
                java.util.Arrays.asList("b", "a", "b", null), null))
                .containsExactly("a", "b");
        // Same set, different chip order -> identical key.
        assertThat(NotAttemptedParticipants.resolveBatchIds(List.of("a", "b"), List.of("b", "a")))
                .isEqualTo(NotAttemptedParticipants.resolveBatchIds(List.of("a", "b"), List.of("a", "b")));
    }

    @Test
    void emptyEnrollmentYieldsAnEmptyPageNotAnError() {
        assertThat(NotAttemptedParticipants.page(List.of(), Set.of("u1"), null, FIRST_PAGE).getContent()).isEmpty();
        assertThat(NotAttemptedParticipants.page(null, null, null, FIRST_PAGE).getContent()).isEmpty();
    }
}
