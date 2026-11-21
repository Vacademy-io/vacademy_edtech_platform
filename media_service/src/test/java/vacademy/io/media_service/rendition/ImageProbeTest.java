package vacademy.io.media_service.rendition;

import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ImageProbeTest {

    @Test
    void readsJpegSize() throws Exception {
        ImageProbe.Info info = ImageProbe.probe(TestImages.jpeg(800, 1000));
        assertEquals(ImageProbe.Format.JPEG, info.format());
        assertEquals(800, info.storedWidth());
        assertEquals(1000, info.storedHeight());
        assertEquals(1, info.orientation());
        assertEquals(800, info.displayWidth());
    }

    @Test
    void readsPngSize() throws Exception {
        ImageProbe.Info info = ImageProbe.probe(TestImages.png(321, 123));
        assertEquals(ImageProbe.Format.PNG, info.format());
        assertEquals(321, info.storedWidth());
        assertEquals(123, info.storedHeight());
    }

    @Test
    void aTurnedPhotoReportsItsDisplaySize() throws Exception {
        ImageProbe.Info info = ImageProbe.probe(TestImages.withExifOrientation(TestImages.jpeg(1000, 800), 6));
        assertEquals(6, info.orientation());
        assertEquals(1000, info.storedWidth());
        assertEquals(800, info.displayWidth());
        assertEquals(1000, info.displayHeight());
    }

    @Test
    void readsTheThreeWebpLayouts() throws Exception {
        byte[] lossy = webp("VP8 ", new int[] {0, 0, 0, 0, 0, 0, 0, 0x9D, 0x01, 0x2A, 0x20, 0x03, 0xE8, 0x03});
        ImageProbe.Info a = ImageProbe.probe(lossy);
        assertEquals(ImageProbe.Format.WEBP, a.format());
        assertEquals(800, a.storedWidth());
        assertEquals(1000, a.storedHeight());

        // 14 bits of width - 1 (799) then 14 bits of height - 1 (999), little endian.
        long bits = 799L | 999L << 14;
        byte[] lossless = webp("VP8L", new int[] {0, 0, 0, 0, 0x2F, (int) (bits & 0xFF), (int) (bits >> 8 & 0xFF),
                (int) (bits >> 16 & 0xFF), (int) (bits >> 24 & 0xFF), 0, 0, 0, 0, 0});
        ImageProbe.Info b = ImageProbe.probe(lossless);
        assertEquals(800, b.storedWidth());
        assertEquals(1000, b.storedHeight());

        byte[] extended = webp("VP8X", new int[] {0, 0, 0, 0, 0x00, 0, 0, 0, 0x1F, 0x03, 0x00, 0xE7, 0x03, 0x00});
        ImageProbe.Info c = ImageProbe.probe(extended);
        assertEquals(800, c.storedWidth());
        assertEquals(1000, c.storedHeight());
    }

    @Test
    void anAnimatedWebpIsRefused() {
        byte[] animated = webp("VP8X", new int[] {0, 0, 0, 0, 0x02, 0, 0, 0, 0x1F, 0x03, 0x00, 0xE7, 0x03, 0x00});
        assertEquals(RenditionError.UNSUPPORTED_IMAGE, errorOf(animated));
    }

    @Test
    void filesThatAreNotImagesAreRefusedByContent() {
        assertEquals(RenditionError.NOT_AN_IMAGE, errorOf("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
                .getBytes(StandardCharsets.UTF_8)));
        assertEquals(RenditionError.NOT_AN_IMAGE, errorOf("%PDF-1.7 not an image at all".getBytes(StandardCharsets.UTF_8)));
        assertEquals(RenditionError.NOT_AN_IMAGE,
                errorOf(TestImages.write(new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB), "gif")));
        assertEquals(RenditionError.NOT_AN_IMAGE, errorOf(new byte[0]));
        assertEquals(RenditionError.NOT_AN_IMAGE, errorOf(null));
    }

    @Test
    void aCutJpegIsRefused() {
        byte[] start = new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0};
        assertEquals(RenditionError.UNSUPPORTED_IMAGE, errorOf(start));
    }

    private static RenditionError errorOf(byte[] bytes) {
        return assertThrows(RenditionException.class, () -> ImageProbe.probe(bytes)).getError();
    }

    /** RIFF header, WEBP, the chunk name, then the bytes from offset 16 on. */
    private static byte[] webp(String chunk, int[] fromOffset16) {
        byte[] out = new byte[16 + fromOffset16.length];
        System.arraycopy("RIFF".getBytes(StandardCharsets.US_ASCII), 0, out, 0, 4);
        System.arraycopy("WEBP".getBytes(StandardCharsets.US_ASCII), 0, out, 8, 4);
        System.arraycopy(chunk.getBytes(StandardCharsets.US_ASCII), 0, out, 12, 4);
        for (int i = 0; i < fromOffset16.length; i++) {
            out[16 + i] = (byte) fromOffset16[i];
        }
        return out;
    }

    @Test
    void aProgressiveJpegAndADeepPngAreToldApartBecauseTheirDecodeCostsMore() throws Exception {
        byte[] jpeg = TestImages.jpeg(64, 48);
        assertEquals(false, ImageProbe.probe(jpeg).progressive());
        for (int i = 2; i + 1 < jpeg.length; i++) {
            if ((jpeg[i] & 0xFF) == 0xFF && (jpeg[i + 1] & 0xFF) == 0xC0) {
                jpeg[i + 1] = (byte) 0xC2;
                break;
            }
        }
        ImageProbe.Info progressive = ImageProbe.probe(jpeg);
        assertEquals(true, progressive.progressive());
        assertEquals(64, progressive.storedWidth());

        byte[] png = TestImages.png(32, 16);
        assertEquals(8, ImageProbe.probe(png).bitDepth());
        png[24] = 16;
        assertEquals(16, ImageProbe.probe(png).bitDepth());
    }
}
