package vacademy.io.assessment_service.features.assessment.service.creation;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * pre_user_registrations stays the total the Submissions tab reads; open_user_registrations
 * says how many of those came through the public link, so the Participants tab can split
 * Internal from External.
 */
class AssessmentAddParticipantsDetailCountsTest {

    private static AssessmentUserRegistration reg(String id, String source) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId(id);
        r.setSource(source);
        return r;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> savedData(AssessmentUserRegistration... regs) {
        Assessment a = new Assessment();
        a.setAssessmentType("ASSESSMENT");
        for (AssessmentUserRegistration r : regs) a.getUserRegistrations().add(r);
        AssessmentAddParticipantsDetail step = new AssessmentAddParticipantsDetail();
        step.checkStatusAndFetchData(Optional.of(a));
        return (Map<String, Object>) step.getSavedData();
    }

    @Test
    void openRegistrationsAreCountedSeparatelyAndTheTotalIsUnchanged() {
        Map<String, Object> data = savedData(
                reg("1", "OPEN_REGISTRATION"),
                reg("2", "OPEN_REGISTRATION"),
                reg("3", "ADMIN_PRE_REGISTRATION"),
                reg("4", "BATCH_PREVIEW_REGISTRATION"),
                reg("5", "COPY_CHECK_ONLY"));

        assertThat(data.get("pre_user_registrations")).isEqualTo(4);
        assertThat(data.get("open_user_registrations")).isEqualTo(2);
    }

    @Test
    void noOpenRegistrationsIsZero() {
        Map<String, Object> data = savedData(reg("1", "ADMIN_PRE_REGISTRATION"));
        assertThat(data.get("pre_user_registrations")).isEqualTo(1);
        assertThat(data.get("open_user_registrations")).isEqualTo(0);
    }
}
