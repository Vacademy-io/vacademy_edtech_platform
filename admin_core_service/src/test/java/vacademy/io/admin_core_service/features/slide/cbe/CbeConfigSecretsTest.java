package vacademy.io.admin_core_service.features.slide.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CbeConfigSecretsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static final String FULL_CONFIG = """
            {"type":"CBE_RESPONSE","data":{"version":1,"gradingNotes":"Own-figure rule. Accept +-1.",
              "parts":[
                {"id":"p_a","label":"(a)","kind":"SPREADSHEET","marks":16,
                 "template":{"sheet":{"sheets":[{"name":"Sheet1","cells":{"A1":{"v":"Goodwill"}}}]}},
                 "solution":{"sheet":{"sheets":[{"name":"Sheet1","cells":{"B7":{"v":3200}}}]}},
                 "markingScheme":[{"id":"m1","label":"Goodwill","marks":2,"expected":"3,200"}],
                 "solutionFileId":"file-1"},
                {"id":"p_b","label":"(b)","kind":"DOCUMENT","marks":4,"template":null,
                 "solution":{"html":"<p>IAS 38 prohibits</p>"},"markingScheme":[]}
              ]}}
            """;

    private static JsonNode json(String s) throws Exception {
        return MAPPER.readTree(s);
    }

    @Test
    @DisplayName("split removes exactly the secret keys and nothing else")
    void splitRemovesSecretKeys() throws Exception {
        CbeConfigSecrets.Split split = CbeConfigSecrets.split(FULL_CONFIG, null);

        JsonNode redacted = json(split.redactedConfig());
        assertThat(split.redactedConfig()).doesNotContain("3200", "IAS 38", "markingScheme", "solutionFileId",
                "gradingNotes", "Own-figure");
        JsonNode partA = redacted.at("/data/parts/0");
        assertThat(partA.path("id").asText()).isEqualTo("p_a");
        assertThat(partA.path("marks").asInt()).isEqualTo(16);
        assertThat(partA.path("template").isObject()).isTrue();
        assertThat(partA.has("solution")).isFalse();
        assertThat(redacted.at("/data/version").asInt()).isEqualTo(1);

        assertThat(split.explicit()).isFalse();
        JsonNode secret = json(split.secret());
        assertThat(secret.path("gradingNotes").asText()).startsWith("Own-figure");
        assertThat(secret.at("/parts/0/id").asText()).isEqualTo("p_a");
        assertThat(secret.at("/parts/0/solutionFileId").asText()).isEqualTo("file-1");
        assertThat(secret.at("/parts/0/markingScheme/0/expected").asText()).isEqualTo("3,200");
        assertThat(secret.at("/parts/1/solution/html").asText()).contains("IAS 38");
    }

    @Test
    @DisplayName("merge puts the secret back so ai_service sees the full config")
    void mergeRoundTrips() throws Exception {
        CbeConfigSecrets.Split split = CbeConfigSecrets.split(FULL_CONFIG, null);
        String merged = CbeConfigSecrets.merge(split.redactedConfig(), split.secret());
        assertThat(json(merged)).isEqualTo(json(FULL_CONFIG));
    }

    @Test
    @DisplayName("a redacted config carries no secret, so the stored one is kept")
    void redactedConfigCarriesNoSecret() {
        String redacted = CbeConfigSecrets.split(FULL_CONFIG, null).redactedConfig();
        CbeConfigSecrets.Split again = CbeConfigSecrets.split(redacted, null);
        assertThat(again.secret()).isNull();
        assertThat(again.resolve("{\"parts\":[{\"id\":\"p_a\"}]}")).isNull();
    }

    @Test
    @DisplayName("blank, null and {} explicit secrets never replace what is stored")
    void blankExplicitSecretIsIgnored() {
        String redacted = CbeConfigSecrets.split(FULL_CONFIG, null).redactedConfig();
        for (String blank : new String[] {null, "", "   ", "null", "{}", " { } "}) {
            CbeConfigSecrets.Split split = CbeConfigSecrets.split(redacted, blank);
            assertThat(split.secret()).as("secret for %s", blank).isNull();
            assertThat(split.resolve("{\"gradingNotes\":\"kept\"}")).isNull();
        }
    }

    @Test
    @DisplayName("an explicit secret wins over secret keys in the config and replaces outright")
    void explicitSecretWins() throws Exception {
        String explicit = "{\"parts\":[{\"id\":\"p_a\",\"markingScheme\":[]}],\"gradingNotes\":\"explicit\"}";
        CbeConfigSecrets.Split split = CbeConfigSecrets.split(FULL_CONFIG, explicit);
        assertThat(split.explicit()).isTrue();
        assertThat(split.redactedConfig()).doesNotContain("3200", "gradingNotes");
        String stored = "{\"parts\":[{\"id\":\"p_b\",\"solution\":{\"html\":\"old\"}}],\"gradingNotes\":\"old\"}";
        assertThat(json(split.resolve(stored))).isEqualTo(json(explicit));
    }

    @Test
    @DisplayName("a secret pulled from the config is laid over the stored one part by part")
    void extractedSecretOverlaysStored() throws Exception {
        String config = """
                {"type":"CBE_RESPONSE","data":{"parts":[
                  {"id":"p_a","marks":16,"solution":{"html":"new a"}},
                  {"id":"p_b","marks":4}]}}
                """;
        String stored = """
                {"parts":[{"id":"p_a","solution":{"html":"old a"},"markingScheme":[{"id":"m1"}]},
                          {"id":"p_b","solution":{"html":"old b"}}],
                 "gradingNotes":"keep me"}
                """;
        JsonNode resolved = json(CbeConfigSecrets.split(config, null).resolve(stored));
        assertThat(resolved.at("/parts/0/solution/html").asText()).isEqualTo("new a");
        // the client stated p_a's secret without a scheme: that is its new secret
        assertThat(resolved.at("/parts/0").has("markingScheme")).isFalse();
        assertThat(resolved.at("/parts/1/solution/html").asText()).isEqualTo("old b");
        assertThat(resolved.path("gradingNotes").asText()).isEqualTo("keep me");
    }

    @Test
    @DisplayName("the learner gets solution and scheme per part, never the file id or grading notes")
    void solutionForLearner() {
        String secret = CbeConfigSecrets.split(FULL_CONFIG, null).secret();
        JsonNode solution = CbeConfigSecrets.solutionForLearner(secret);
        assertThat(solution.at("/parts/0/id").asText()).isEqualTo("p_a");
        assertThat(solution.at("/parts/0/markingScheme/0/label").asText()).isEqualTo("Goodwill");
        assertThat(solution.toString()).doesNotContain("file-1", "Own-figure", "gradingNotes", "solutionFileId");
        assertThat(CbeConfigSecrets.solutionForLearner(null)).isNull();
    }

    @Test
    void totalPartMarksAndTypeDetection() {
        assertThat(CbeConfigSecrets.totalPartMarks(FULL_CONFIG)).isEqualTo(20.0);
        assertThat(CbeConfigSecrets.totalPartMarks("{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[]}}")).isNull();
        assertThat(CbeConfigSecrets.isCbe("CBE_RESPONSE")).isTrue();
        assertThat(CbeConfigSecrets.isCbe(null, FULL_CONFIG)).isTrue();
        assertThat(CbeConfigSecrets.isCbe("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"a\"]}}"))
                .isFalse();
        assertThat(CbeConfigSecrets.isCbe(null, "not json")).isFalse();
    }
}
