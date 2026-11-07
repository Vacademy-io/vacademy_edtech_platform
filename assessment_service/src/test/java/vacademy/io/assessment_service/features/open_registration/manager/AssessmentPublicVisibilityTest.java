package vacademy.io.assessment_service.features.open_registration.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Whether a share link works is decided by assessment_visibility — the field the
 * admin builder edits — not by the registration window.
 *
 * <p>This used to be the other way round: the page keyed off
 * registration_open_date/close_date alone, so an assessment an admin switched
 * from PRIVATE to PUBLIC kept answering "Assessment is Private" forever, because
 * the PRIVATE->PUBLIC edit leaves both dates NULL and
 * AssessmentParticipantsManager.handleOpenRegistration is the only writer of
 * them in the whole service. 216 prod rows were stranded that way — 73 of them
 * holding a circulated share code.
 */
class AssessmentPublicVisibilityTest {

    private Assessment withVisibility(String visibility) {
        Assessment a = new Assessment();
        a.setAssessmentVisibility(visibility);
        return a;
    }

    @Test
    void publicAssessmentIsVisibleEvenWithNoRegistrationWindow() {
        Assessment a = withVisibility("PUBLIC");
        assertThat(a.getRegistrationOpenDate()).isNull();
        assertThat(a.getRegistrationCloseDate()).isNull();

        assertThat(AssessmentPublicPageManager.isPubliclyVisible(a)).isTrue();
    }

    @Test
    void privateAssessmentStaysPrivateEvenWithAnOpenWindow() {
        // The inverse drift: 96 prod rows are PRIVATE but carry a window. Under
        // the old date-only rule those were registerable by anyone with the link.
        assertThat(AssessmentPublicPageManager.isPubliclyVisible(withVisibility("PRIVATE"))).isFalse();
    }

    @Test
    void visibilityMatchIsCaseInsensitive() {
        assertThat(AssessmentPublicPageManager.isPubliclyVisible(withVisibility("public"))).isTrue();
    }

    @Test
    void anUnrecognisedVisibilityFailsClosed() {
        assertThat(AssessmentPublicPageManager.isPubliclyVisible(withVisibility("SOMETHING_ELSE"))).isFalse();
        assertThat(AssessmentPublicPageManager.isPubliclyVisible(withVisibility(""))).isFalse();
    }

    @Test
    void aNullVisibilityFailsClosed() {
        // NOT NULL in the schema, but never let a blank open registration.
        assertThat(AssessmentPublicPageManager.isPubliclyVisible(withVisibility(null))).isFalse();
    }
}
