package vacademy.io.assessment_service.features.client;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class AdminCoreUtf8Test {

    @Test
    void repairsUtf8ThatWasDecodedAsLatin1AndLeavesGoodTextAlone() {
        String original = "Result is ready 🔓 — it’s here";
        String mangled = new String(original.getBytes(StandardCharsets.UTF_8), StandardCharsets.ISO_8859_1);
        assertThat(AdminCoreServiceClient.utf8(mangled)).isEqualTo(original);
        assertThat(AdminCoreServiceClient.utf8(original)).isEqualTo(original);
        assertThat(AdminCoreServiceClient.utf8("café")).isEqualTo("café"); // genuine Latin-1, not valid UTF-8 bytes
    }
}
