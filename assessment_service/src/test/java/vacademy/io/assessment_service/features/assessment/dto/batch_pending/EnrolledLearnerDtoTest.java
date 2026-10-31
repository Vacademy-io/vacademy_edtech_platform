package vacademy.io.assessment_service.features.assessment.dto.batch_pending;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The wire contract with admin_core's enrolled-learner endpoint.
 *
 * <p>A naming mismatch here fails silently — Jackson would leave every field null and the
 * Pending tab would render nameless rows rather than erroring — so both spellings are
 * pinned by a test instead of trusted.
 */
class EnrolledLearnerDtoTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void readsTheSnakeCaseFormAdminCoreActuallySends() throws Exception {
        EnrolledLearnerDto dto = mapper.readValue(
                "{\"user_id\":\"u1\",\"full_name\":\"Aadya Saxena\",\"package_session_id\":\"b1\"}",
                EnrolledLearnerDto.class);

        assertThat(dto.getUserId()).isEqualTo("u1");
        assertThat(dto.getFullName()).isEqualTo("Aadya Saxena");
        assertThat(dto.getPackageSessionId()).isEqualTo("b1");
    }

    @Test
    void alsoReadsCamelCaseSoANamingStrategyChangeCannotSilentlyBlankTheTab() throws Exception {
        EnrolledLearnerDto dto = mapper.readValue(
                "{\"userId\":\"u1\",\"fullName\":\"Aadya Saxena\",\"packageSessionId\":\"b1\"}",
                EnrolledLearnerDto.class);

        assertThat(dto.getUserId()).isEqualTo("u1");
        assertThat(dto.getFullName()).isEqualTo("Aadya Saxena");
        assertThat(dto.getPackageSessionId()).isEqualTo("b1");
    }

    @Test
    void ignoresUnknownFieldsSoAdminCoreCanAddColumnsWithoutBreakingThis() throws Exception {
        EnrolledLearnerDto dto = mapper.readValue(
                "{\"user_id\":\"u1\",\"full_name\":\"A\",\"package_session_id\":\"b1\",\"email\":\"a@b.c\"}",
                EnrolledLearnerDto.class);

        assertThat(dto.getUserId()).isEqualTo("u1");
    }
}
