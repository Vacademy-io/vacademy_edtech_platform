package vacademy.io.media_service.rendition;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * WebP through the libwebp command line tools ({@code cwebp}, {@code dwebp}), which the image
 * installs from the distribution package {@code libwebp-tools}. The JVM has no WebP encoder,
 * and the JNI libraries that bundle one ship glibc binaries that do not load on the Alpine
 * image this service runs on.
 *
 * <p>The command line is fixed; the only variable parts are the quality number and the names
 * of two files this class creates itself in a fresh temporary folder.
 */
@Slf4j
@Component
public class CwebpProcessCodec implements WebpCodec {

    private final String cwebpPath;
    private final String dwebpPath;
    private final long timeoutSeconds;
    /** 0 switches the lowered priority off. */
    private final int niceLevel;
    private volatile boolean niceAvailable = true;

    @Autowired
    public CwebpProcessCodec(@Value("${image.rendition.cwebp-path:cwebp}") String cwebpPath,
                             @Value("${image.rendition.dwebp-path:dwebp}") String dwebpPath,
                             @Value("${image.rendition.encode-timeout-seconds:60}") long timeoutSeconds,
                             @Value("${image.rendition.nice-level:19}") int niceLevel) {
        this.cwebpPath = cwebpPath;
        this.dwebpPath = dwebpPath;
        this.timeoutSeconds = timeoutSeconds;
        this.niceLevel = Math.max(0, Math.min(19, niceLevel));
    }

    public CwebpProcessCodec(String cwebpPath, String dwebpPath, long timeoutSeconds) {
        this(cwebpPath, dwebpPath, timeoutSeconds, 19);
    }

    /**
     * The tools run at the lowest priority: uploads and URL lookups of every institute are
     * served by the JVM beside them.
     */
    List<String> withLowPriority(List<String> command) {
        if (niceLevel < 1 || !niceAvailable) {
            return command;
        }
        List<String> wrapped = new ArrayList<>(List.of("nice", "-n", String.valueOf(niceLevel)));
        wrapped.addAll(command);
        return wrapped;
    }

    /** The fixed encoder options. Method 4 (the default) costs about half the CPU of method 5. */
    static List<String> encodeOptions(int quality, boolean alpha) {
        List<String> options = new ArrayList<>(List.of("-quiet", "-q", String.valueOf(quality),
                "-m", "4", "-sharp_yuv", "-metadata", "none"));
        if (alpha) {
            options.addAll(List.of("-alpha_q", "90"));
        }
        return options;
    }

    @Override
    public byte[] encode(BufferedImage image, int quality) throws RenditionException {
        int q = Math.max(1, Math.min(100, quality));
        Path folder = null;
        try {
            folder = Files.createTempDirectory("rendition-");
            Path in = folder.resolve("in.png");
            Path out = folder.resolve("out.webp");
            if (!ImageIO.write(image, "png", in.toFile())) {
                throw new RenditionException(RenditionError.ENCODE_FAILED, "could not write the intermediate image");
            }
            List<String> command = new ArrayList<>(List.of(cwebpPath));
            command.addAll(encodeOptions(q, image.getColorModel().hasAlpha()));
            command.addAll(List.of(in.toString(), "-o", out.toString()));
            run(command);
            byte[] bytes = Files.readAllBytes(out);
            if (bytes.length == 0) {
                throw new RenditionException(RenditionError.ENCODE_FAILED, "the encoder wrote nothing");
            }
            return bytes;
        } catch (IOException e) {
            throw new RenditionException(RenditionError.ENCODE_FAILED, "encoding failed: " + e.getMessage(), e);
        } finally {
            deleteQuietly(folder);
        }
    }

    @Override
    public BufferedImage decode(byte[] webp) throws RenditionException {
        Path folder = null;
        try {
            folder = Files.createTempDirectory("rendition-");
            Path in = folder.resolve("in.webp");
            Path out = folder.resolve("out.png");
            Files.write(in, webp);
            run(List.of(dwebpPath, "-quiet", in.toString(), "-o", out.toString()));
            // Read from the file: the PNG of a large image must not sit on the heap as bytes too.
            BufferedImage image = ImageIO.read(out.toFile());
            if (image == null) {
                throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE, "the WebP file could not be decoded");
            }
            return image;
        } catch (IOException e) {
            throw new RenditionException(RenditionError.UNSUPPORTED_IMAGE,
                    "the WebP file could not be decoded: " + e.getMessage(), e);
        } finally {
            deleteQuietly(folder);
        }
    }

    private void run(List<String> command) throws RenditionException {
        Process process;
        try {
            process = start(command);
        } catch (IOException e) {
            log.error("WebP tool {} could not be started; is libwebp-tools installed in the image?",
                    command.get(0), e);
            throw new RenditionException(RenditionError.ENCODER_UNAVAILABLE, "the WebP tool is not installed", e);
        }
        try {
            if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new RenditionException(RenditionError.ENCODE_FAILED, "the WebP tool timed out");
            }
        } catch (InterruptedException e) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new RenditionException(RenditionError.ENCODE_FAILED, "interrupted while encoding", e);
        }
        if (process.exitValue() == 126 || process.exitValue() == 127) {
            // What nice (or a shell) answers when the tool behind it cannot be run.
            log.error("WebP tool {} could not be run; is libwebp-tools installed in the image?", command.get(0));
            throw new RenditionException(RenditionError.ENCODER_UNAVAILABLE, "the WebP tool is not installed");
        }
        if (process.exitValue() != 0) {
            throw new RenditionException(RenditionError.ENCODE_FAILED,
                    "the WebP tool ended with code " + process.exitValue());
        }
    }

    private Process start(List<String> command) throws IOException {
        List<String> wrapped = withLowPriority(command);
        if (wrapped != command) {
            try {
                return new ProcessBuilder(wrapped).redirectErrorStream(true)
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            } catch (IOException e) {
                niceAvailable = false;
                log.warn("nice is not available; the WebP tools run at normal priority: {}", e.getMessage());
            }
        }
        return new ProcessBuilder(command).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
    }

    private static void deleteQuietly(Path folder) {
        if (folder == null) {
            return;
        }
        File[] files = folder.toFile().listFiles();
        if (files != null) {
            for (File file : files) {
                if (!file.delete()) {
                    log.warn("Could not delete temporary file {}", file);
                }
            }
        }
        if (!folder.toFile().delete()) {
            log.warn("Could not delete temporary folder {}", folder);
        }
    }
}
