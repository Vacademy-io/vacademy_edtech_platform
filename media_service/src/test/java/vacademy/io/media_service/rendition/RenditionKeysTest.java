package vacademy.io.media_service.rendition;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RenditionKeysTest {

    private static final String FILE_ID = "3f2c1a9e-7b1d-4c58-9a44-0d6f0e3b2a11";

    @Test
    void theKeyDependsOnlyOnFileVersionAndWidth() {
        assertEquals("COMMERCE_RENDITION/v1/" + FILE_ID + "/w640.webp", RenditionKeys.key(FILE_ID, 640));
        assertEquals(RenditionKeys.key(FILE_ID, 640), RenditionKeys.key(FILE_ID, 640));
    }

    @Test
    void aFileIdCannotLeaveItsFolder() {
        assertTrue(RenditionKeys.isValidFileId(FILE_ID));
        assertFalse(RenditionKeys.isValidFileId("../other"));
        assertFalse(RenditionKeys.isValidFileId("a/b"));
        assertFalse(RenditionKeys.isValidFileId("https://example.com/a.jpg"));
        assertFalse(RenditionKeys.isValidFileId(""));
        assertFalse(RenditionKeys.isValidFileId(null));
        assertThrows(IllegalArgumentException.class, () -> RenditionKeys.key("../other", 640));
        assertThrows(IllegalArgumentException.class, () -> RenditionKeys.key(FILE_ID, 0));
    }
}
