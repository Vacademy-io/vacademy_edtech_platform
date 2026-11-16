package vacademy.io.media_service.rendition;

import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ImageScalerTest {

    @Test
    void scalesToTheExactSizeInSrgb() throws Exception {
        BufferedImage decoded = ImageScaler.decode(TestImages.jpeg(2000, 2500), ImageProbe.Format.JPEG, 1);
        BufferedImage out = ImageScaler.render(decoded, 1, 640, 800);
        assertEquals(640, out.getWidth());
        assertEquals(800, out.getHeight());
        assertEquals(BufferedImage.TYPE_INT_RGB, out.getType());
        assertTrue(out.getColorModel().getColorSpace().isCS_sRGB());
    }

    @Test
    void transparencyIsKept() throws Exception {
        byte[] png = TestImages.write(TestImages.photoLike(400, 400, true), "png");
        BufferedImage out = ImageScaler.render(ImageScaler.decode(png, ImageProbe.Format.PNG, 1), 1, 320, 320);
        assertEquals(BufferedImage.TYPE_INT_ARGB, out.getType());
    }

    @Test
    void aTurnedPhotoComesOutUpright() {
        // Stored 4 x 2 with orientation 6: the top stored row is the right edge of the picture.
        BufferedImage stored = new BufferedImage(4, 2, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 4; x++) {
            stored.setRGB(x, 0, 0xFF0000);
            stored.setRGB(x, 1, 0x0000FF);
        }
        stored.setRGB(0, 0, 0x00FF00);
        BufferedImage out = ImageScaler.render(stored, 6, 2, 4);
        assertEquals(2, out.getWidth());
        assertEquals(4, out.getHeight());
        assertEquals(0x00FF00, out.getRGB(1, 0) & 0xFFFFFF, "stored top-left is shown top-right");
        assertEquals(0xFF0000, out.getRGB(1, 3) & 0xFFFFFF);
        assertEquals(0x0000FF, out.getRGB(0, 0) & 0xFFFFFF);
    }

    @Test
    void everyOrientationKeepsAllPixels() {
        BufferedImage stored = new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB);
        int n = 1;
        for (int y = 0; y < 2; y++) {
            for (int x = 0; x < 3; x++) {
                stored.setRGB(x, y, n++);
            }
        }
        for (int orientation = 1; orientation <= 8; orientation++) {
            BufferedImage out = ImageScaler.orient(stored, orientation);
            assertEquals(orientation >= 5 ? 2 : 3, out.getWidth());
            long sum = 0;
            for (int y = 0; y < out.getHeight(); y++) {
                for (int x = 0; x < out.getWidth(); x++) {
                    sum += out.getRGB(x, y) & 0xFFFFFF;
                }
            }
            assertEquals(21, sum, "orientation " + orientation);
        }
        // 3 is a half turn, 8 a quarter turn to the left of 6.
        assertEquals(6, ImageScaler.orient(stored, 3).getRGB(0, 0) & 0xFFFFFF);
        assertEquals(3, ImageScaler.orient(stored, 8).getRGB(0, 0) & 0xFFFFFF);
        assertEquals(4, ImageScaler.orient(stored, 6).getRGB(0, 0) & 0xFFFFFF);
    }

    @Test
    void hugeSourcesAreDecodedSmaller() throws Exception {
        assertEquals(1, ImageScaler.subsampling(2000, 1600));
        assertEquals(1, ImageScaler.subsampling(4799, 1600));
        assertEquals(2, ImageScaler.subsampling(4800, 1600));
        assertEquals(5, ImageScaler.subsampling(12000, 1600));
        BufferedImage decoded = ImageScaler.decode(TestImages.jpeg(1200, 900), ImageProbe.Format.JPEG, 2);
        assertEquals(600, decoded.getWidth());
        assertEquals(450, decoded.getHeight());
    }
}
