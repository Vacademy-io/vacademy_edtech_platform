package vacademy.io.assessment_service.features.assessment.service.creation;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Step-1 field rules per assessment type. Each type's list decides which
 * fields the dashboard shows and which the step needs before it counts as
 * complete, so a type quietly inheriting another's list is a product bug -
 * a Survey demanded a live window like a manual-upload exam for months.
 */
class AssessmentBasicDetailTest {

    private static Set<String> keysFor(String type) {
        return stepKeysFor(type).stream()
                .flatMap(m -> m.keySet().stream())
                .collect(Collectors.toSet());
    }

    private static List<Map<String, String>> stepKeysFor(String type) {
        AssessmentBasicDetail step = new AssessmentBasicDetail();
        step.fillStepKeysBasedOnAssessmentType(type, "inst-1");
        return step.getStepKeys();
    }

    /** "REQUIRED", "OPTIONAL", or null when the type does not declare the field at all. */
    private static String ruleFor(String type, String key) {
        return stepKeysFor(type).stream()
                .filter(m -> m.containsKey(key))
                .map(m -> m.get(key))
                .findFirst()
                .orElse(null);
    }

    @Test
    void aSurveyKeepsItsOwnFieldsAndIsNeverForcedIntoALiveWindow() {
        Set<String> survey = keysFor("SURVEY");
        assertThat(survey).contains("assessment_visibility", "expected_participants", "reattempt_count");
        assertThat(survey).doesNotContain("result_type", "reattempt_consent");
    }

    /**
     * A survey MAY be given a live window, so both dates are offered — but as
     * OPTIONAL, never REQUIRED. This used to assert the dates were absent
     * altogether, which hid the inputs while Step1BasicInfo.tsx still demanded
     * their values, leaving "Next" permanently disabled on every new survey.
     * The rule the original test cared about is preserved: a survey is never
     * *forced* to carry a live window.
     */
    @Test
    void aSurveyOffersItsLiveWindowDatesAsOptional() {
        assertThat(ruleFor("SURVEY", "boundation_start_date")).isEqualTo("OPTIONAL");
        assertThat(ruleFor("SURVEY", "boundation_end_date")).isEqualTo("OPTIONAL");
    }

    @Test
    void anExamStillDemandsItsLiveWindow() {
        assertThat(ruleFor("EXAM", "boundation_start_date")).isEqualTo("REQUIRED");
        assertThat(ruleFor("EXAM", "boundation_end_date")).isEqualTo("REQUIRED");
    }

    @Test
    void aManualUploadExamStillNeedsItsLiveWindowAndResultType() {
        Set<String> manual = keysFor("MANUAL_UPLOAD_EXAM");
        assertThat(manual).contains("boundation_start_date", "boundation_end_date", "result_type");
    }

    @Test
    void mockAndPracticeNeverAskForALiveWindow() {
        assertThat(keysFor("MOCK")).doesNotContain("boundation_start_date", "boundation_end_date");
        assertThat(keysFor("PRACTICE")).doesNotContain("boundation_start_date", "boundation_end_date");
        assertThat(keysFor("EXAM")).contains("boundation_start_date", "boundation_end_date");
    }
}
