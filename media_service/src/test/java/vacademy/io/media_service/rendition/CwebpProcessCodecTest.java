package vacademy.io.media_service.rendition;

import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Runs the real encoder when {@code cwebp} is installed on this machine and skips otherwise,
 * so the default build stays offline and free of native tools.
 */
class CwebpProcessCodecTest {

    private final CwebpProcessCodec codec = new CwebpProcessCodec("cwebp", "dwebp", 60);

    private static boolean installed(String tool) {
        try {
            return new ProcessBuilder(tool, "-version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    @Test
    void a640PixelPictureIsWebpUnder150Kilobytes() throws Exception {
        assumeTrue(installed("cwebp"), "cwebp is not installed");
        BufferedImage picture = ImageScaler.render(TestImages.photoLike(1600, 2000, false), 1, 640, 800);

        byte[] webp = codec.encode(picture, ImageRenditionService.QUALITY_STEPS[0]);

        assertEquals("RIFF", new String(webp, 0, 4, StandardCharsets.US_ASCII));
        assertEquals("WEBP", new String(webp, 8, 4, StandardCharsets.US_ASCII));
        assertTrue(webp.length < 150_000, "640 px rendition is " + webp.length + " bytes");
        ImageProbe.Info info = ImageProbe.probe(webp);
        assertEquals(640, info.storedWidth());
        assertEquals(800, info.storedHeight());
        // A lossy file without the extended header carries no EXIF, ICC or XMP chunk.
        assertEquals("VP8 ", new String(webp, 12, 4, StandardCharsets.US_ASCII));
    }

    @Test
    void aWebpUploadCanBeReadBack() throws Exception {
        assumeTrue(installed("cwebp") && installed("dwebp"), "cwebp or dwebp is not installed");
        byte[] webp = codec.encode(TestImages.photoLike(300, 200, false), 80);

        BufferedImage decoded = codec.decode(webp);

        assertEquals(300, decoded.getWidth());
        assertEquals(200, decoded.getHeight());
    }

    @Test
    void aMissingToolIsReportedAsRetryable() {
        CwebpProcessCodec missing = new CwebpProcessCodec("/nonexistent/cwebp", "/nonexistent/dwebp", 5);

        RenditionException e = assertThrows(RenditionException.class,
                () -> missing.encode(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), 80));

        assertEquals(RenditionError.ENCODER_UNAVAILABLE, e.getError());
        assertTrue(e.getError().isRetryable());
    }

    @Test
    void theToolsRunAtTheLowestPriorityWithTheCheaperMethod() {
        assertEquals(java.util.List.of("nice", "-n", "19", "cwebp", "x"),
                codec.withLowPriority(java.util.List.of("cwebp", "x")));
        assertEquals(java.util.List.of("cwebp", "x"),
                new CwebpProcessCodec("cwebp", "dwebp", 60, 0).withLowPriority(java.util.List.of("cwebp", "x")));

        java.util.List<String> options = CwebpProcessCodec.encodeOptions(80, false);
        assertEquals("4", options.get(options.indexOf("-m") + 1));
    }
}
