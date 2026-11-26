package vacademy.io.assessment_service.features.assessment.dto;

/**
 * One answer a learner gave on an earlier registration form, keyed by the
 * field key ("phone_number", "student_roll_number"). The register page uses
 * these to fill the same fields when the learner registers for another test.
 */
public interface EarlierRegistrationAnswerDto {
    String getFieldKey();

    String getAnswer();
}
