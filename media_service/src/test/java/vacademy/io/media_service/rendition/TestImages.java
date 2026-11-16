package vacademy.io.media_service.rendition;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Random;

/** Images made in memory, so the tests need no files and no network. */
final class TestImages {

    private TestImages() {
    }

    /** A picture with gradients, shapes and some grain, closer to a photo than a flat fill. */
    static BufferedImage photoLike(int width, int height, boolean alpha) {
        BufferedImage image = new BufferedImage(width, height,
                alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setPaint(new GradientPaint(0, 0, new Color(214, 188, 150), width, height, new Color(92, 60, 40)));
        g.fillRect(0, 0, width, height);
        Random random = new Random(7);
        for (int i = 0; i < 60; i++) {
            g.setColor(new Color(random.nextInt(256), random.nextInt(256), random.nextInt(256), 160));
            g.fillOval(random.nextInt(width), random.nextInt(height), 20 + random.nextInt(Math.max(1, width / 4)),
                    20 + random.nextInt(Math.max(1, height / 4)));
        }
        g.dispose();
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int rgb = image.getRGB(x, y);
                int noise = random.nextInt(13) - 6;
                int r = clamp(((rgb >> 16) & 0xFF) + noise);
                int gr = clamp(((rgb >> 8) & 0xFF) + noise);
                int b = clamp((rgb & 0xFF) + noise);
                image.setRGB(x, y, (rgb & 0xFF000000) | r << 16 | gr << 8 | b);
            }
        }
        return image;
    }

    static byte[] jpeg(int width, int height) {
        return write(photoLike(width, height, false), "jpeg");
    }

    static byte[] png(int width, int height) {
        return write(photoLike(width, height, false), "png");
    }

    static byte[] write(BufferedImage image, String format) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(image, format, out)) {
                throw new IllegalStateException("no writer for " + format);
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Inserts an EXIF segment with the given orientation right after the JPEG start marker. */
    static byte[] withExifOrientation(byte[] jpeg, int orientation) {
        byte[] exif = {
                (byte) 0xFF, (byte) 0xE1, 0x00, 0x22,
                'E', 'x', 'i', 'f', 0, 0,
                'M', 'M', 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
                0x00, 0x01,
                0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, (byte) orientation, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00};
        byte[] out = new byte[jpeg.length + exif.length];
        System.arraycopy(jpeg, 0, out, 0, 2);
        System.arraycopy(exif, 0, out, 2, exif.length);
        System.arraycopy(jpeg, 2, out, 2 + exif.length, jpeg.length - 2);
        return out;
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(255, value));
    }
}
