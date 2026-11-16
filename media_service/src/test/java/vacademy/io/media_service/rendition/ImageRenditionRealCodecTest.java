package vacademy.io.media_service.rendition;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.S3Object;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.media_service.service.CdnUrlService;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The whole rendition flow with the real {@code cwebp} encoder and an in-memory bucket: the
 * files that would be stored are real WebP files, read back and measured. Skipped where
 * {@code cwebp} is not installed, so the default build needs no native tool.
 *
 * <p>With {@code COMMERCE_IT_EVIDENCE_MEDIA} set, the sizes are appended to that file.
 */
class ImageRenditionRealCodecTest {

    private static final String PUBLIC = "public";

    private final Map<String, byte[]> objects = new HashMap<>();
    private RenditionSourceReader repository;
    private ImageRenditionService service;

    private static boolean installed(String tool) {
        try {
            return new ProcessBuilder(tool, "-version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    @BeforeEach
    void setUp() {
        AmazonS3 s3 = mock(AmazonS3.class);
        repository = mock(RenditionSourceReader.class);
        CdnUrlService cdn = mock(CdnUrlService.class);
        when(cdn.publicUrl(anyString())).thenAnswer(call -> "https://cdn.test/" + call.getArgument(0));
        when(s3.getObjectMetadata(anyString(), anyString())).thenAnswer(call -> {
            byte[] bytes = objects.get(call.getArgument(0) + "/" + call.getArgument(1));
            if (bytes == null) {
                AmazonS3Exception missing = new AmazonS3Exception("Not Found");
                missing.setStatusCode(404);
                throw missing;
            }
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(bytes.length);
            return metadata;
        });
        when(s3.getObject(anyString(), anyString())).thenAnswer(call -> {
            S3Object object = new S3Object();
            object.setObjectContent(new ByteArrayInputStream(
                    objects.get(call.getArgument(0) + "/" + call.getArgument(1))));
            return object;
        });
        when(s3.putObject(anyString(), anyString(), any(InputStream.class), any(ObjectMetadata.class)))
                .thenAnswer(call -> {
                    objects.put(call.getArgument(0) + "/" + call.getArgument(1),
                            ((InputStream) call.getArgument(2)).readAllBytes());
                    return null;
                });
        service = new ImageRenditionService(s3, repository, cdn, new CwebpProcessCodec("cwebp", "dwebp", 120),
                "main", PUBLIC, 25L * 1024 * 1024, 24_000_000L, 16_000_000L, 12_000_000L, 1, 5);
    }

    private ImageRenditionResult render(String fileId, int width, int height) throws Exception {
        String key = "inst-1/COMMERCE_PRODUCT_MEDIA/" + fileId + ".jpg";
        when(repository.find(fileId)).thenReturn(Optional.of(
                new RenditionSourceReader.Source(key, "COMMERCE_PRODUCT_MEDIA", "inst-1")));
        byte[] source = TestImages.jpeg(width, height);
        objects.put(PUBLIC + "/" + key, source);
        ImageRenditionResult result = service.generate(fileId, List.of("inst-1"));
        note("source " + width + " x " + height + " JPEG, " + source.length + " bytes -> "
                + result.getRenditions().size() + " WebP files");
        return result;
    }

    /** Every listed rendition is a stored WebP file of the listed width, within its byte budget. */
    private void filesAreRealWebp(String fileId, ImageRenditionResult result) throws Exception {
        for (ImageRenditionResult.Rendition rendition : result.getRenditions()) {
            byte[] webp = objects.get(PUBLIC + "/" + RenditionKeys.key(fileId, rendition.getWidth()));
            assertTrue(webp != null && webp.length > 12, "stored file for width " + rendition.getWidth());
            assertEquals("RIFF", new String(webp, 0, 4, StandardCharsets.US_ASCII));
            assertEquals("WEBP", new String(webp, 8, 4, StandardCharsets.US_ASCII));
            ImageProbe.Info info = ImageProbe.probe(webp);
            assertEquals(rendition.getWidth().intValue(), info.storedWidth());
            assertEquals(rendition.getHeight().intValue(), info.storedHeight());
            assertEquals(webp.length, rendition.getBytes().longValue());
            assertTrue(webp.length <= ImageRenditionService.byteBudget(rendition.getWidth()),
                    rendition.getWidth() + " px is " + webp.length + " bytes");
            note("   w" + rendition.getWidth() + " x " + rendition.getHeight() + ": " + webp.length + " bytes, "
                    + rendition.getUrl());
        }
    }

    @Test
    void a2000PixelPhotoBecomesFourWebpFiles() throws Exception {
        assumeTrue(installed("cwebp"), "cwebp is not installed");
        String fileId = "proof-2000";

        ImageRenditionResult result = render(fileId, 2000, 2500);

        assertEquals(List.of(320, 640, 960, 1600),
                result.getRenditions().stream().map(ImageRenditionResult.Rendition::getWidth).toList());
        filesAreRealWebp(fileId, result);
        byte[] at640 = objects.get(PUBLIC + "/" + RenditionKeys.key(fileId, 640));
        assertTrue(at640.length < 150_000, "640 px rendition is " + at640.length + " bytes");

        // A second call makes nothing again.
        ImageRenditionResult again = service.generate(fileId, List.of("inst-1"));
        assertTrue(again.getRenditions().stream().noneMatch(ImageRenditionResult.Rendition::getCreated));
    }

    @Test
    void an800PixelPhotoBecomesThreeWebpFiles() throws Exception {
        assumeTrue(installed("cwebp"), "cwebp is not installed");
        String fileId = "proof-800";

        ImageRenditionResult result = render(fileId, 800, 1000);

        assertEquals(List.of(320, 640, 800),
                result.getRenditions().stream().map(ImageRenditionResult.Rendition::getWidth).toList());
        filesAreRealWebp(fileId, result);
        byte[] at640 = objects.get(PUBLIC + "/" + RenditionKeys.key(fileId, 640));
        assertTrue(at640.length < 150_000, "640 px rendition is " + at640.length + " bytes");
    }

    private static void note(String line) {
        String path = System.getenv("COMMERCE_IT_EVIDENCE_MEDIA");
        if (path == null || path.isBlank()) {
            return;
        }
        try {
            Files.writeString(Path.of(path), line + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
