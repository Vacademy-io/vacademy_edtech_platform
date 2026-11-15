package vacademy.io.media_service.rendition;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.S3Object;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.media_service.service.CdnUrlService;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The whole flow against an in-memory bucket and a codec that only records what it was asked. */
class ImageRenditionServiceTest {

    private static final String FILE_ID = "3f2c1a9e-7b1d-4c58-9a44-0d6f0e3b2a11";
    private static final String SOURCE_KEY = "inst-1/PRODUCT/abc_saree.jpg";
    private static final String MAIN = "main";
    private static final String PUBLIC = "public";
    /** What admin_core sends: the institute and the product of the gallery row. */
    private static final List<String> OWNERS = List.of("inst-1", "product-1");

    private AmazonS3 s3;
    private RenditionSourceReader repository;
    private CdnUrlService cdn;
    private RecordingCodec codec;
    private ImageRenditionService service;
    /** bucket/key to bytes. */
    private final Map<String, byte[]> objects = new HashMap<>();

    @BeforeEach
    void setUp() {
        s3 = mock(AmazonS3.class);
        repository = mock(RenditionSourceReader.class);
        cdn = mock(CdnUrlService.class);
        codec = new RecordingCodec();
        when(cdn.publicUrl(anyString())).thenAnswer(call -> "https://cdn.test/" + call.getArgument(0));
        when(cdn.isRoutedToPrivateOrigin(anyString()))
                .thenAnswer(call -> ((String) call.getArgument(0)).startsWith("PRIVATE_UPLOAD/"));
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
        service = service(25L * 1024 * 1024, 40_000_000L);
    }

    private ImageRenditionService service(long maxBytes, long maxPixels) {
        return new ImageRenditionService(s3, repository, cdn, codec, MAIN, PUBLIC, maxBytes, maxPixels,
                16_000_000L, 12_000_000L, 1, 1);
    }

    private void file(String key, String source, String bucket, byte[] bytes) {
        file(key, source, "inst-1", bucket, bytes);
    }

    private void file(String key, String source, String sourceId, String bucket, byte[] bytes) {
        when(repository.find(FILE_ID)).thenReturn(Optional.of(new RenditionSourceReader.Source(key, source, sourceId)));
        if (bytes != null) {
            objects.put(bucket + "/" + key, bytes);
        }
    }

    @Test
    void an800PixelUploadYieldsThreeRenditionsUnderDeterministicPublicKeys() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));

        ImageRenditionResult result = service.generate(FILE_ID, OWNERS);

        assertEquals(800, result.getWidth());
        assertEquals(1000, result.getHeight());
        assertEquals(List.of(320, 640, 800),
                result.getRenditions().stream().map(ImageRenditionResult.Rendition::getWidth).toList());
        assertEquals(List.of(400, 800, 1000),
                result.getRenditions().stream().map(ImageRenditionResult.Rendition::getHeight).toList());
        assertEquals("https://cdn.test/COMMERCE_RENDITION/v1/" + FILE_ID + "/w640.webp",
                result.getRenditions().get(1).getUrl());
        assertEquals(List.of("320x400", "640x800", "800x1000"), codec.encodedSizes);

        ArgumentCaptor<String> bucket = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<ObjectMetadata> metadata = ArgumentCaptor.forClass(ObjectMetadata.class);
        verify(s3, times(3)).putObject(bucket.capture(), key.capture(), any(InputStream.class), metadata.capture());
        assertEquals(List.of(PUBLIC, PUBLIC, PUBLIC), bucket.getAllValues());
        assertEquals(List.of(RenditionKeys.key(FILE_ID, 320), RenditionKeys.key(FILE_ID, 640),
                RenditionKeys.key(FILE_ID, 800)), key.getAllValues());
        for (ObjectMetadata each : metadata.getAllValues()) {
            assertEquals("image/webp", each.getContentType());
            assertEquals("public, max-age=31536000, immutable", each.getCacheControl());
        }
    }

    @Test
    void a2000PixelUploadYieldsFourAndNoneIsWiderThan1600() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(2000, 2500));

        ImageRenditionResult result = service.generate(FILE_ID, OWNERS);

        assertEquals(List.of(320, 640, 960, 1600),
                result.getRenditions().stream().map(ImageRenditionResult.Rendition::getWidth).toList());
        assertEquals(List.of("320x400", "640x800", "960x1200", "1600x2000"), codec.encodedSizes);
    }

    @Test
    void aSmallImageIsNeverEnlarged() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.png(200, 100));

        ImageRenditionResult result = service.generate(FILE_ID, OWNERS);

        assertEquals(List.of("200x100"), codec.encodedSizes);
        assertEquals(1, result.getRenditions().size());
    }

    @Test
    void aSecondRunStoresAndEncodesNothing() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));
        ImageRenditionResult first = service.generate(FILE_ID, OWNERS);
        codec.encodedSizes.clear();

        ImageRenditionResult second = service.generate(FILE_ID, OWNERS);

        assertTrue(codec.encodedSizes.isEmpty());
        verify(s3, times(3)).putObject(anyString(), anyString(), any(InputStream.class), any(ObjectMetadata.class));
        assertEquals(first.getRenditions().stream().map(ImageRenditionResult.Rendition::getUrl).toList(),
                second.getRenditions().stream().map(ImageRenditionResult.Rendition::getUrl).toList());
        assertEquals(first.getRenditions().stream().map(ImageRenditionResult.Rendition::getBytes).toList(),
                second.getRenditions().stream().map(ImageRenditionResult.Rendition::getBytes).toList());
        assertTrue(first.getRenditions().stream().allMatch(ImageRenditionResult.Rendition::getCreated));
        assertTrue(second.getRenditions().stream().noneMatch(ImageRenditionResult.Rendition::getCreated));
    }

    @Test
    void aRunThatStoppedHalfwayOnlyMakesWhatIsMissing() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));
        objects.put(PUBLIC + "/" + RenditionKeys.key(FILE_ID, 320), new byte[] {1, 2, 3});

        service.generate(FILE_ID, OWNERS);

        assertEquals(List.of("640x800", "800x1000"), codec.encodedSizes);
    }

    @Test
    void aSourceOnlyInTheMainBucketIsReadFromThere() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, MAIN, TestImages.jpeg(640, 640));

        assertEquals(2, service.generate(FILE_ID, OWNERS).getRenditions().size());
        verify(s3).getObject(MAIN, SOURCE_KEY);
    }

    @Test
    void aTurnedPhotoIsMeasuredAsShown() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.withExifOrientation(TestImages.jpeg(1000, 800), 6));

        ImageRenditionResult result = service.generate(FILE_ID, OWNERS);

        assertEquals(800, result.getWidth());
        assertEquals(1000, result.getHeight());
        assertEquals(List.of("320x400", "640x800", "800x1000"), codec.encodedSizes);
    }

    @Test
    void qualityStepsDownUntilTheBudgetIsMet() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(640, 800));
        codec.bytesAtQuality.put(80, 400_000);
        codec.bytesAtQuality.put(70, 200_000);
        codec.bytesAtQuality.put(60, 90_000);

        ImageRenditionResult result = service.generate(FILE_ID, OWNERS);

        assertEquals(90_000L, result.getRenditions().get(1).getBytes());
        assertEquals(150_000L, ImageRenditionService.byteBudget(640));
    }

    @Test
    void filesThatAreNotImagesAreRefusedAndNothingIsStored() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, "%PDF-1.7 this is a document".getBytes());

        assertEquals(RenditionError.NOT_AN_IMAGE, errorOf(service));
        verify(s3, never()).putObject(anyString(), anyString(), any(InputStream.class), any(ObjectMetadata.class));
    }

    @Test
    void anOversizedFileIsRefusedWithoutBeingRead() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));

        assertEquals(RenditionError.TOO_LARGE, errorOf(service(1_000, 40_000_000L)));
        verify(s3, never()).getObject(anyString(), anyString());
    }

    @Test
    void anImageWithTooManyPixelsIsRefusedBeforeDecoding() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.png(800, 1000));

        assertEquals(RenditionError.TOO_MANY_PIXELS, errorOf(service(25L * 1024 * 1024, 500_000L)));
        assertTrue(codec.encodedSizes.isEmpty());
    }

    @Test
    void privateFilesNeverGetPublicRenditions() {
        file("PRIVATE_UPLOAD/inst-1/id-card.jpg", "PRIVATE_UPLOAD", MAIN, TestImages.jpeg(800, 1000));
        assertEquals(RenditionError.NOT_PUBLIC, errorOf(service));

        file("eval-api/inst-1/sheet.jpg", "AI_EVAL_API", MAIN, TestImages.jpeg(800, 1000));
        assertEquals(RenditionError.NOT_PUBLIC, errorOf(service));

        verify(s3, never()).getObject(anyString(), anyString());
        verify(s3, never()).putObject(anyString(), anyString(), any(InputStream.class), any(ObjectMetadata.class));
    }

    @Test
    void onlyAKnownFileIdIsTaken() {
        when(repository.find(anyString())).thenReturn(Optional.empty());

        assertEquals(RenditionError.FILE_NOT_FOUND, errorOf(service));
        for (String notAnId : new String[] {"https://example.com/a.jpg", "../../etc/passwd", "a/b", "", null}) {
            RenditionException e = assertThrows(RenditionException.class, () -> service.generate(notAnId, OWNERS));
            assertEquals(RenditionError.INVALID_FILE_ID, e.getError());
        }
        verify(s3, never()).getObject(anyString(), anyString());
    }

    @Test
    void aFileStillBeingUploadedCanBeRetried() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, null);

        RenditionError error = errorOf(service);
        assertEquals(RenditionError.SOURCE_MISSING, error);
        assertTrue(error.isRetryable());
        assertFalse(RenditionError.NOT_AN_IMAGE.isRetryable());
    }

    @Test
    void aStorageFailureIsReportedAsRetryable() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));
        AmazonS3Exception down = new AmazonS3Exception("Slow Down");
        down.setStatusCode(503);
        doThrow(down).when(s3).putObject(eq(PUBLIC), anyString(), any(InputStream.class), any(ObjectMetadata.class));

        assertEquals(RenditionError.STORAGE_ERROR, errorOf(service));
    }

    @Test
    void aFileOfAnotherInstituteOrAnotherKindOfUploadNeverGetsAPublicCopy() {
        // Uploaded as a product image, but for another institute.
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, "inst-2", MAIN, TestImages.jpeg(800, 1000));
        assertEquals(RenditionError.NOT_PUBLIC, errorOf(service));

        // A file of this institute that was not uploaded as a product image (an assignment, an ID photo).
        file("inst-1/ASSIGNMENT/answer.jpg", "ASSIGNMENT", "inst-1", MAIN, TestImages.jpeg(800, 1000));
        assertEquals(RenditionError.NOT_PUBLIC, errorOf(service));

        // A caller that names no owner gets nothing.
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, "inst-1", MAIN, TestImages.jpeg(800, 1000));
        assertEquals(RenditionError.NOT_PUBLIC,
                assertThrows(RenditionException.class, () -> service.generate(FILE_ID, List.of())).getError());
        assertEquals(RenditionError.NOT_PUBLIC,
                assertThrows(RenditionException.class, () -> service.generate(FILE_ID, null)).getError());

        assertFalse(RenditionError.NOT_PUBLIC.isRetryable());
        verify(s3, never()).getObject(anyString(), anyString());
        verify(s3, never()).putObject(anyString(), anyString(), any(InputStream.class), any(ObjectMetadata.class));
    }

    @Test
    void aFileUploadedForTheProductOfTheGalleryRowIsTaken() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, "product-1", PUBLIC, TestImages.jpeg(640, 640));

        assertEquals(2, service.generate(FILE_ID, OWNERS).getRenditions().size());
    }

    @Test
    void thePixelLimitDependsOnWhatTheDecodeCosts() {
        ImageRenditionService limits = new ImageRenditionService(s3, repository, cdn, codec, MAIN, PUBLIC,
                25L * 1024 * 1024, 24_000_000L, 16_000_000L, 12_000_000L, 1, 1);

        assertEquals(24_000_000L, limits.pixelLimit(new ImageProbe.Info(ImageProbe.Format.JPEG, 10, 10, 1)));
        assertEquals(24_000_000L, limits.pixelLimit(new ImageProbe.Info(ImageProbe.Format.PNG, 10, 10, 1)));
        assertEquals(16_000_000L, limits.pixelLimit(new ImageProbe.Info(ImageProbe.Format.WEBP, 10, 10, 1)));
        assertEquals(12_000_000L,
                limits.pixelLimit(new ImageProbe.Info(ImageProbe.Format.JPEG, 10, 10, 1, 8, true)));
        assertEquals(12_000_000L,
                limits.pixelLimit(new ImageProbe.Info(ImageProbe.Format.PNG, 10, 10, 1, 16, false)));
    }

    @Test
    void anImageThatExhaustsTheMemoryIsRefusedForGoodAndNotRetried() {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));
        codec.failWith = new OutOfMemoryError("Java heap space");

        RenditionError error = errorOf(service);

        assertEquals(RenditionError.TOO_MANY_PIXELS, error);
        assertFalse(error.isRetryable());
    }

    @Test
    void aRequestThatWaitsForTheSlotHasNotTouchedTheDatabase() throws Exception {
        file(SOURCE_KEY, ImageRenditionService.PRODUCT_MEDIA_SOURCE, PUBLIC, TestImages.jpeg(800, 1000));
        java.util.concurrent.CountDownLatch inside = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        codec.onEncode = () -> {
            inside.countDown();
            try {
                release.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        Thread first = new Thread(() -> {
            try {
                service.generate(FILE_ID, OWNERS);
            } catch (RenditionException e) {
                throw new IllegalStateException(e);
            }
        });
        first.start();
        try {
            assertTrue(inside.await(10, java.util.concurrent.TimeUnit.SECONDS));
            verify(repository, times(1)).find(FILE_ID);

            assertEquals(RenditionError.BUSY, errorOf(service));
            // The second request waited its second and gave up without a read of file_metadata.
            verify(repository, times(1)).find(FILE_ID);
        } finally {
            release.countDown();
            first.join(10_000);
        }
    }

    private RenditionError errorOf(ImageRenditionService target) {
        return assertThrows(RenditionException.class, () -> target.generate(FILE_ID, OWNERS)).getError();
    }

    private static final class RecordingCodec implements WebpCodec {
        final List<String> encodedSizes = new ArrayList<>();
        final Map<Integer, Integer> bytesAtQuality = new HashMap<>();
        Error failWith;
        Runnable onEncode;

        @Override
        public byte[] encode(BufferedImage image, int quality) {
            if (failWith != null) {
                throw failWith;
            }
            if (onEncode != null) {
                Runnable hook = onEncode;
                onEncode = null;
                hook.run();
            }
            if (quality == ImageRenditionService.QUALITY_STEPS[0]) {
                encodedSizes.add(image.getWidth() + "x" + image.getHeight());
            }
            return new byte[bytesAtQuality.getOrDefault(quality, 1_000 + image.getWidth())];
        }

        @Override
        public BufferedImage decode(byte[] webp) {
            throw new UnsupportedOperationException("not used");
        }
    }
}
