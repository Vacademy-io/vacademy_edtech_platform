package vacademy.io.admin_core_service.features.usage_metering.service;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

class UsageKeyClassifierTest {

    private static final String SN = "35675130-7c65-41d6-a869-0811d2e1753e";
    private static final String ZOE = "b41a7f71-0000-0000-0000-000000000000";

    private final UsageKeyClassifier classifier = new UsageKeyClassifier(
            Set.of(SN, ZOE),
            Map.of("0009e37d-f539-44f7-97f7-30dde0426a39", SN, "zoom-schedule-1", ZOE));

    @Test
    void instituteFromAnyOfTheFirstThreeSegments() {
        assertEquals(SN, classifier.instituteFor(SN + "/COURSES/abc-cover.jpg"));
        assertEquals(SN, classifier.instituteFor("PDF_DOCUMENTS/" + SN + "/abc-notes.pdf"));
        assertEquals(ZOE, classifier.instituteFor("CATALOGUE/x/" + ZOE + "/y.png"));
    }

    @Test
    void recordingsResolveThroughTheirMeeting() {
        assertEquals(SN, classifier.instituteFor(
                "BBB_RECORDING/0009e37d-f539-44f7-97f7-30dde0426a39/19b8-recording-content.mp4"));
        assertEquals(ZOE, classifier.instituteFor("ZOOM_RECORDING/zoom-schedule-1/a.mp4"));
    }

    @Test
    void everythingElseIsUnassigned() {
        assertEquals(UsageKeyClassifier.UNASSIGNED, classifier.instituteFor("BBB_RECORDING/unknown-meeting/a.mp4"));
        assertEquals(UsageKeyClassifier.UNASSIGNED, classifier.instituteFor("your-institute-id/ADMIN/lecture.mp4"));
        assertEquals(UsageKeyClassifier.UNASSIGNED, classifier.instituteFor("SERVICE_UPLOAD/x.png"));
        assertEquals(UsageKeyClassifier.UNASSIGNED, classifier.instituteFor("a/b/c/" + SN + "/deep.png"));
        assertEquals(UsageKeyClassifier.UNASSIGNED, classifier.instituteFor(""));
    }

    @Test
    void categories() {
        assertEquals(UsageKeyClassifier.RECORDING, UsageKeyClassifier.categoryFor("BBB_RECORDING/m/a.mp4"));
        assertEquals(UsageKeyClassifier.RECORDING, UsageKeyClassifier.categoryFor("AI_CALL_RECORDING/x/call.mp3"));
        assertEquals(UsageKeyClassifier.VIDEO, UsageKeyClassifier.categoryFor("VIDEO_DOCUMENTS/STUDENTS/lecture_5.MP4"));
        assertEquals(UsageKeyClassifier.AUDIO, UsageKeyClassifier.categoryFor(SN + "/a/voice.m4a"));
        assertEquals(UsageKeyClassifier.DOCUMENT, UsageKeyClassifier.categoryFor(SN + "/PDF_DOCUMENTS/notes.pdf"));
        assertEquals(UsageKeyClassifier.IMAGE, UsageKeyClassifier.categoryFor(SN + "/COURSES/cover.jpeg"));
        assertEquals(UsageKeyClassifier.OTHER, UsageKeyClassifier.categoryFor("scorm/pkg.v1/imsmanifest"));
        assertEquals(UsageKeyClassifier.OTHER, UsageKeyClassifier.categoryFor("folder.name/file"));
    }
}
