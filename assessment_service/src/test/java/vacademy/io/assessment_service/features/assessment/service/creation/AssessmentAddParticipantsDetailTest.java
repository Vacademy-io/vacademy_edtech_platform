package vacademy.io.assessment_service.features.assessment.service.creation;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Step 3 renders each control only when its key is declared REQUIRED, so a type
 * that declares nothing gets a blank Add Participants step.
 *
 * <p>SURVEY used to return the questions step's single PROBLEM_RANDOMIZATION
 * entry, which left an admin with no Open/Closed choice, no batch or learner
 * picker, no share link and no registration form — a survey could not be given
 * participants at all.
 */
class AssessmentAddParticipantsDetailTest {

    private static Set<String> keysFor(String type) {
        AssessmentAddParticipantsDetail step = new AssessmentAddParticipantsDetail();
        step.fillStepKeysBasedOnAssessmentType(type, "inst-1");
        List<Map<String, String>> keys = step.getStepKeys();
        return keys.stream().flatMap(m -> m.keySet().stream()).collect(Collectors.toSet());
    }

    @Test
    void aSurveyCanChooseBetweenAnOpenAndAClosedAudience() {
        assertThat(keysFor("SURVEY"))
                .contains("public_registrations", "private_registrations", "open_link", "closed_link");
    }

    @Test
    void aSurveyCanPickBatchesLearnersAndItsRegistrationForm() {
        assertThat(keysFor("SURVEY"))
                .contains("closed_select_batch", "closed_select_student", "open_select_batch",
                        "open_select_student", "registration_form_fields");
    }

    @Test
    void aSurveyCanStillNotifyParticipantsAndParents() {
        assertThat(keysFor("SURVEY")).contains("notify_participants", "notify_parents");
    }

    @Test
    void aSurveyIsNotForcedIntoARegistrationWindow() {
        // Unset means "no limit on that side" — see AssessmentPublicPageManager.
        assertThat(keysFor("SURVEY"))
                .doesNotContain("registration_open_date", "registration_close_date");
    }

    @Test
    void aSurveyNoLongerCarriesTheQuestionStepsKey() {
        assertThat(keysFor("SURVEY")).doesNotContain("problem_randomization");
    }

    @Test
    void anExamKeepsItsFullParticipantStepIncludingTheWindow() {
        assertThat(keysFor("EXAM"))
                .contains("public_registrations", "open_link", "closed_link",
                        "registration_open_date", "registration_close_date",
                        "registration_form_fields");
    }
}
