package vacademy.io.assessment_service.features.question_core.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** A learner never receives a CBE solution, marking scheme, solution file or grading notes. */
public class CbeConfigRedactorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String CBE = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"version\":1,\"parts\":["
            + "{\"id\":\"p1\",\"label\":\"(a)\",\"promptHtml\":\"<p>Prepare the SFP</p>\",\"kind\":\"SPREADSHEET\",\"marks\":16,"
            + "\"template\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"A1\":{\"v\":\"Goodwill\"}}}]}},"
            + "\"solution\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"B1\":{\"v\":3200}}}]}},"
            + "\"markingScheme\":[{\"id\":\"m1\",\"label\":\"Goodwill\",\"marks\":2,\"expected\":\"3,200\"}],"
            + "\"solutionFileId\":\"media-1\"},"
            + "{\"id\":\"p2\",\"label\":\"(b)\",\"kind\":\"DOCUMENT\",\"marks\":4,\"template\":null,"
            + "\"solution\":{\"html\":\"<p>IAS 38 prohibits</p>\"},\"markingScheme\":[],\"solutionFileId\":null}],"
            + "\"gradingNotes\":\"Apply the own-figure rule.\"}}";

    static final String CODING = "{\"type\":\"CODING\",\"data\":{\"testCases\":[{\"id\":\"t1\",\"expectedStdout\":\"42\",\"visible\":false}],"
            + "\"solution\":\"keep me\",\"gradingNotes\":\"not a CBE key\"}}";

    @Test
    void removesExactlyTheSecretKeys() throws Exception {
        JsonNode out = MAPPER.readTree(CbeConfigRedactor.redact(CBE));
        JsonNode data = out.path("data");
        assertThat(out.path("type").asText()).isEqualTo("CBE_RESPONSE");
        assertThat(data.has("gradingNotes")).isFalse();
        assertThat(data.path("version").asInt()).isEqualTo(1);
        for (JsonNode part : data.path("parts")) {
            assertThat(part.has("solution")).isFalse();
            assertThat(part.has("markingScheme")).isFalse();
            assertThat(part.has("solutionFileId")).isFalse();
        }
        // Everything else stays, untouched.
        JsonNode p1 = data.path("parts").get(0);
        assertThat(fieldNames(p1)).containsExactly("id", "label", "promptHtml", "kind", "marks", "template");
        assertThat(p1.path("template").path("sheet").path("sheets").get(0).path("cells").path("A1").path("v").asText())
                .isEqualTo("Goodwill");
        assertThat(fieldNames(data.path("parts").get(1))).containsExactly("id", "label", "kind", "marks", "template");
        assertThat(CbeConfigRedactor.redact(CBE)).doesNotContain("3200", "IAS 38", "own-figure", "media-1", "expected");
    }

    @Test
    void aCodingConfigPassesThroughUntouched() {
        assertThat(CbeConfigRedactor.redact(CODING)).isSameAs(CODING);
        assertThat(CbeConfigRedactor.redact(CODING, "CODING")).isSameAs(CODING);
        String mcq = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}";
        assertThat(CbeConfigRedactor.redact(mcq, "MCQS")).isSameAs(mcq);
        // Mentions the word but is not a CBE config: still untouched.
        String longAnswer = "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":\"CBE_RESPONSE\"}}}";
        assertThat(CbeConfigRedactor.redact(longAnswer, "LONG_ANSWER")).isSameAs(longAnswer);
    }

    @Test
    void nullBlankAndUnreadable() {
        assertThat(CbeConfigRedactor.redact(null)).isNull();
        assertThat(CbeConfigRedactor.redact("")).isEmpty();
        assertThat(CbeConfigRedactor.redact("not json")).isEqualTo("not json");
        // A CBE question whose config cannot be read is withheld, not leaked.
        assertThat(CbeConfigRedactor.redact("{\"type\":\"CBE_RESPONSE\", broken", null)).isNull();
        assertThat(CbeConfigRedactor.redact("garbage", "CBE_RESPONSE")).isNull();
    }

    @Test
    void aCbeQuestionIsRedactedEvenWhenItsJsonLostTheTypeField() throws Exception {
        String untyped = "{\"data\":{\"parts\":[{\"id\":\"p1\",\"solution\":{\"html\":\"x\"},\"markingScheme\":[]}],\"gradingNotes\":\"n\"}}";
        JsonNode out = MAPPER.readTree(CbeConfigRedactor.redact(untyped, "CBE_RESPONSE"));
        assertThat(out.path("data").has("gradingNotes")).isFalse();
        assertThat(fieldNames(out.path("data").path("parts").get(0))).containsExactly("id");
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
