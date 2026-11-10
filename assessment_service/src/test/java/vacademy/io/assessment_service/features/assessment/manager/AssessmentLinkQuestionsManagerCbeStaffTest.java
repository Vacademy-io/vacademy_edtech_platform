package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

/** questions-of-sections is called by the learner app: only staff get a CBE solution. */
class AssessmentLinkQuestionsManagerCbeStaffTest {

    private static CustomUserDetails user(boolean root, String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn(Arrays.stream(authorities).map(SimpleGrantedAuthority::new).collect(Collectors.toList()))
                .when(user).getAuthorities();
        doReturn(root).when(user).isRootUser();
        return user;
    }

    @Test
    void learnersAreNotStaffEvenAsRootUsers() {
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(true, "STUDENT"))).isFalse();
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(true))).isFalse();
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(null)).isFalse();
    }

    @Test
    void staffAndCustomStaffRolesAreStaff() {
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(false, "ADMIN"))).isTrue();
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(false, "teacher"))).isTrue();
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(false, "STUDENT", "EVALUATOR"))).isTrue();
        assertThat(AssessmentLinkQuestionsManager.hasStaffAuthority(user(false, "ASSESSMENT MANAGER"))).isTrue();
    }
}
