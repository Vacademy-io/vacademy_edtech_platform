package vacademy.io.assessment_service.features.notification.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentEmailBody.Content;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentEmailBody.Details;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentEmailBody.Institute;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentEmailBody.Kind;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;

class LearnerAssessmentEmailBodyTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final Date START = Date.from(ZonedDateTime.of(2026, 11, 12, 21, 0, 0, 0, IST).toInstant());
    private static final Date END = Date.from(ZonedDateTime.of(2026, 11, 13, 21, 0, 0, 0, IST).toInstant());
    private static final Institute OGI = new Institute("Oriental Group", "primary", "https://cdn.example/logo.png");

    private static Details details(Integer minutesBefore, String link) {
        return new Details("Maths <Test>", START, END, 10, minutesBefore, link);
    }

    @Test
    void reminderSaysHowManyMinutesAreLeft() {
        Content content = LearnerAssessmentEmailBody.build(Kind.REMINDER, OGI, details(5, null), IST);

        assertThat(content.subject()).isEqualTo("Maths <Test> starts in 5 minutes");
        assertThat(content.html()).contains("starts in 5 minutes");
    }

    @Test
    void oneMinuteIsSingular() {
        Content content = LearnerAssessmentEmailBody.build(Kind.REMINDER, OGI, details(1, null), IST);
        assertThat(content.subject()).endsWith("starts in 1 minute");
    }

    @Test
    void datesAreShownInIndianTime() {
        Content content = LearnerAssessmentEmailBody.build(Kind.REGISTERED, OGI, details(null, null), IST);

        assertThat(content.html()).contains("12 Nov 2026, 9:00 pm IST").contains("13 Nov 2026, 9:00 pm IST");
        assertThat(content.html()).contains("10 minutes");
    }

    @Test
    void openEndedDatesAreLeftOut() {
        Date farFuture = Date.from(ZonedDateTime.of(9999, 12, 31, 0, 0, 0, 0, IST).toInstant());
        Content content = LearnerAssessmentEmailBody.build(Kind.ASSIGNED, OGI,
                new Details("Practice", START, farFuture, null, null, null), IST);

        assertThat(content.html()).contains("Starts").doesNotContain("Ends").doesNotContain("9999");
    }

    @Test
    void assessmentNameIsEscaped() {
        Content content = LearnerAssessmentEmailBody.build(Kind.LIVE, OGI, details(null, null), IST);
        assertThat(content.html()).contains("Maths &lt;Test&gt;").doesNotContain("Maths <Test>");
    }

    @Test
    void buttonOnlyWhenThereIsALink() {
        String withLink = LearnerAssessmentEmailBody.build(Kind.LIVE, OGI,
                details(null, "https://ogi.example.com/register?code=801545"), IST).html();
        String withoutLink = LearnerAssessmentEmailBody.build(Kind.LIVE, OGI, details(null, null), IST).html();

        assertThat(withLink).contains("href=\"https://ogi.example.com/register?code=801545\"").contains("Start assessment");
        assertThat(withoutLink).doesNotContain("href=").doesNotContain("Start assessment");
    }

    @Test
    void usesTheInstituteNameLogoAndLearnerPlaceholder() {
        String html = LearnerAssessmentEmailBody.build(Kind.REGISTERED, OGI, details(null, null), IST).html();

        assertThat(html).contains("Oriental Group").contains("https://cdn.example/logo.png")
                .contains("{{learner_name}}").contains("#ED7424");
    }

    @Test
    void worksWithoutAnyInstituteDetails() {
        String html = LearnerAssessmentEmailBody.build(Kind.REGISTERED, null, details(null, null), IST).html();

        assertThat(html).contains(LearnerAssessmentEmailBody.NEUTRAL).doesNotContain("Sent by").doesNotContain("<img");
    }

    @Test
    void themeCodesResolveLikeTheApps() {
        assertThat(LearnerAssessmentEmailBody.resolveColor("primary")).isEqualTo("#ED7424");
        assertThat(LearnerAssessmentEmailBody.resolveColor("#1e88e5")).isEqualTo("#1E88E5");
        assertThat(LearnerAssessmentEmailBody.resolveColor("abc")).isEqualTo("#AABBCC");
        assertThat(LearnerAssessmentEmailBody.resolveColor("not-a-colour")).isEqualTo(LearnerAssessmentEmailBody.NEUTRAL);
        assertThat(LearnerAssessmentEmailBody.resolveColor(null)).isEqualTo(LearnerAssessmentEmailBody.NEUTRAL);
    }

    @Test
    void lightThemesGetDarkButtonText() {
        assertThat(LearnerAssessmentEmailBody.isLight("#FFB300")).isTrue();  // amber
        assertThat(LearnerAssessmentEmailBody.isLight("#1A237E")).isFalse(); // navy
    }
}
