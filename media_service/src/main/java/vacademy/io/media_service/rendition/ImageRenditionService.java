package vacademy.io.media_service.rendition;

import com.amazonaws.AmazonServiceException;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.S3Object;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.media_service.service.CdnUrlService;
import vacademy.io.media_service.service.EvalApiFileService;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Makes the fixed WebP renditions of one uploaded commerce product image.
 *
 * <p>The caller names a file id and nothing else. The source is the object that file's own
 * metadata row points at, in one of this service's two buckets; no URL is ever taken from a
 * caller, and nothing is fetched from outside the buckets. Files that are private by source
 * or key prefix are refused, so no public copy of them comes into being here. More than that:
 * the file must have been uploaded as a product image ({@link #PRODUCT_MEDIA_SOURCE}) for one
 * of the owners the caller names (the institute, or the product the gallery row belongs to).
 * A file of another institute, or one uploaded for anything else, never gets a public copy.
 *
 * <p>A second call for the same file is cheap and changes nothing: a rendition whose object
 * is already in the public bucket is not made again, and the source is decoded only when at
 * least one rendition is missing.
 */
@Slf4j
@Service
public class ImageRenditionService {

    static final String WEBP_CONTENT_TYPE = "image/webp";
    /** The key carries the pipeline version, so the bytes under a key never change. */
    static final String CACHE_CONTROL = "public, max-age=31536000, immutable";
    static final int[] QUALITY_STEPS = {80, 70, 60};
    /** A 640 px product image stays under 150 KB. */
    private static final long BUDGET_AT_640 = 150_000L;
    private static final int MAX_SIDE = 30_000;
    /** The upload source of a product image; nothing else is ever copied to the public bucket. */
    public static final String PRODUCT_MEDIA_SOURCE = "COMMERCE_PRODUCT_MEDIA";

    private final AmazonS3 s3Client;
    private final RenditionSourceReader sourceReader;
    private final CdnUrlService cdnUrlService;
    private final WebpCodec codec;
    private final String mainBucket;
    private final String publicBucket;
    private final long maxSourceBytes;
    private final long maxPixels;
    private final long maxPixelsWebp;
    private final long maxPixelsProgressive;
    private final long busyWaitSeconds;
    private final Semaphore slots;

    @Autowired
    public ImageRenditionService(AmazonS3 s3Client,
                                 RenditionSourceReader sourceReader,
                                 CdnUrlService cdnUrlService,
                                 WebpCodec codec,
                                 @Value("${aws.bucket.name}") String mainBucket,
                                 @Value("${aws.s3.public-bucket}") String publicBucket,
                                 @Value("${image.rendition.max-source-bytes:26214400}") long maxSourceBytes,
                                 @Value("${image.rendition.max-pixels:24000000}") long maxPixels,
                                 @Value("${image.rendition.max-pixels-webp:16000000}") long maxPixelsWebp,
                                 @Value("${image.rendition.max-pixels-progressive-jpeg:12000000}")
                                 long maxPixelsProgressive,
                                 @Value("${image.rendition.max-concurrent:1}") int maxConcurrent,
                                 @Value("${image.rendition.busy-wait-seconds:15}") long busyWaitSeconds) {
        this.s3Client = s3Client;
        this.sourceReader = sourceReader;
        this.cdnUrlService = cdnUrlService;
        this.codec = codec;
        this.mainBucket = mainBucket;
        this.publicBucket = publicBucket;
        this.maxSourceBytes = maxSourceBytes;
        this.maxPixels = maxPixels;
        this.maxPixelsWebp = Math.min(maxPixels, maxPixelsWebp);
        this.maxPixelsProgressive = Math.min(maxPixels, maxPixelsProgressive);
        this.busyWaitSeconds = busyWaitSeconds;
        this.slots = new Semaphore(Math.max(1, maxConcurrent));
    }

    /** Byte budget of one rendition; over it, the next lower quality step is tried. */
    static long byteBudget(int width) {
        return Math.max(40_000L, BUDGET_AT_640 * width * width / (640L * 640L));
    }

    /**
     * @param owners the ids the file may have been uploaded for: the institute of the gallery
     *               row and its product. Without a match nothing is read and nothing is made.
     */
    public ImageRenditionResult generate(String fileId, Collection<String> owners) throws RenditionException {
        if (!RenditionKeys.isValidFileId(fileId)) {
            throw new RenditionException(RenditionError.INVALID_FILE_ID, "not a file id");
        }
        // The slot first: a request that waits must not hold a database connection meanwhile.
        boolean acquired;
        try {
            acquired = slots.tryAcquire(busyWaitSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RenditionException(RenditionError.BUSY, "interrupted while waiting", e);
        }
        if (!acquired) {
            throw new RenditionException(RenditionError.BUSY, "other images are being processed");
        }
        try {
            RenditionSourceReader.Source file = sourceReader.find(fileId)
                    .orElseThrow(() -> new RenditionException(RenditionError.FILE_NOT_FOUND, "file not found"));
            String key = file.key() == null ? null : file.key().trim();
            if (!StringUtils.hasText(key)) {
                throw new RenditionException(RenditionError.FILE_NOT_FOUND, "the file has no stored object");
            }
            if (EvalApiFileService.isReservedSource(file.source()) || cdnUrlService.isRoutedToPrivateOrigin(key)
                    || key.startsWith(RenditionKeys.PREFIX) || !ownedProductImage(file, owners)) {
                throw new RenditionException(RenditionError.NOT_PUBLIC, "this file cannot be used as a product image");
            }
            return generateLocked(fileId, key);
        } catch (AmazonServiceException e) {
            throw new RenditionException(RenditionError.STORAGE_ERROR, "storage error: " + e.getErrorCode(), e);
        } catch (OutOfMemoryError e) {
            // Never retried: the same image would exhaust the memory of this shared service again.
            log.error("Renditions for file {} ran out of memory; the image is refused", fileId);
            throw new RenditionException(RenditionError.TOO_MANY_PIXELS, "the image needs too much memory");
        } finally {
            slots.release();
        }
    }

    private static boolean ownedProductImage(RenditionSourceReader.Source file, Collection<String> owners) {
        if (!PRODUCT_MEDIA_SOURCE.equals(file.source()) || !StringUtils.hasText(file.sourceId()) || owners == null) {
            return false;
        }
        for (String owner : owners) {
            if (StringUtils.hasText(owner) && file.sourceId().equals(owner.trim())) {
                return true;
            }
        }
        return false;
    }

    /**
     * The pixel limit of one upload. What is bounded is the memory of a decode, which the byte
     * and pixel counts alone do not tell: a WebP source is decoded at full size, a progressive
     * JPEG is buffered whole in native memory by the JDK decoder, and a 16-bit PNG takes twice
     * the memory of an 8-bit one.
     */
    long pixelLimit(ImageProbe.Info info) {
        if (info.format() == ImageProbe.Format.WEBP) {
            return maxPixelsWebp;
        }
        if (info.progressive()) {
            return maxPixelsProgressive;
        }
        return info.bitDepth() > 8 ? maxPixels / 2 : maxPixels;
    }

    private ImageRenditionResult generateLocked(String fileId, String key) throws RenditionException {
        String bucket = sourceBucket(key);
        byte[] source = download(bucket, key);
        ImageProbe.Info info = ImageProbe.probe(source);
        if (info.storedWidth() > MAX_SIDE || info.storedHeight() > MAX_SIDE
                || info.pixels() > pixelLimit(info)) {
            throw new RenditionException(RenditionError.TOO_MANY_PIXELS,
                    "the image is " + info.storedWidth() + " x " + info.storedHeight() + " pixels, over the limit");
        }
        int sourceWidth = info.displayWidth();
        int sourceHeight = info.displayHeight();
        List<Integer> widths = RenditionLadder.widthsFor(sourceWidth);

        List<ImageRenditionResult.Rendition> renditions = new ArrayList<>();
        BufferedImage decoded = null;
        for (int width : widths) {
            int height = RenditionLadder.heightFor(sourceWidth, sourceHeight, width);
            String renditionKey = RenditionKeys.key(fileId, width);
            ObjectMetadata existing = head(publicBucket, renditionKey);
            long bytes;
            boolean created = false;
            if (existing != null) {
                bytes = existing.getContentLength();
            } else {
                if (decoded == null) {
                    decoded = decode(source, info, widths.get(widths.size() - 1));
                }
                byte[] webp = encodeWithinBudget(ImageScaler.render(decoded, info.orientation(), width, height),
                        width);
                put(renditionKey, webp);
                bytes = webp.length;
                created = true;
            }
            renditions.add(ImageRenditionResult.Rendition.builder()
                    .width(width)
                    .height(height)
                    .url(cdnUrlService.publicUrl(renditionKey))
                    .bytes(bytes)
                    .created(created)
                    .build());
        }
        log.info("Renditions for file {}: source {} x {}, widths {}", fileId, sourceWidth, sourceHeight, widths);
        return ImageRenditionResult.builder()
                .fileId(fileId)
                .width(sourceWidth)
                .height(sourceHeight)
                .pipelineVersion(RenditionKeys.PIPELINE_VERSION)
                .renditions(renditions)
                .build();
    }

    /** The public bucket when the object is there, else the main one; refuses oversized files unread. */
    private String sourceBucket(String key) throws RenditionException {
        String bucket = publicBucket;
        ObjectMetadata metadata = head(publicBucket, key);
        if (metadata == null) {
            bucket = mainBucket;
            metadata = head(mainBucket, key);
        }
        if (metadata == null) {
            throw new RenditionException(RenditionError.SOURCE_MISSING, "the file is not in storage yet");
        }
        if (metadata.getContentLength() > maxSourceBytes) {
            throw new RenditionException(RenditionError.TOO_LARGE,
                    "the file is larger than " + maxSourceBytes + " bytes");
        }
        return bucket;
    }

    private byte[] download(String bucket, String key) throws RenditionException {
        try (S3Object object = s3Client.getObject(bucket, key);
             InputStream in = object.getObjectContent()) {
            // The stored length was checked; the read is capped as well in case it lied.
            byte[] bytes = in.readNBytes((int) Math.min(Integer.MAX_VALUE - 8L, maxSourceBytes + 1));
            if (bytes.length > maxSourceBytes) {
                throw new RenditionException(RenditionError.TOO_LARGE,
                        "the file is larger than " + maxSourceBytes + " bytes");
            }
            return bytes;
        } catch (IOException e) {
            throw new RenditionException(RenditionError.STORAGE_ERROR, "could not read the file", e);
        }
    }

    private BufferedImage decode(byte[] source, ImageProbe.Info info, int widestTarget) throws RenditionException {
        if (info.format() == ImageProbe.Format.WEBP) {
            return codec.decode(source);
        }
        return ImageScaler.decode(source, info.format(), ImageScaler.subsampling(info.displayWidth(), widestTarget));
    }

    private byte[] encodeWithinBudget(BufferedImage image, int width) throws RenditionException {
        long budget = byteBudget(width);
        byte[] webp = null;
        for (int quality : QUALITY_STEPS) {
            webp = codec.encode(image, quality);
            if (webp.length <= budget) {
                break;
            }
        }
        return webp;
    }

    private void put(String key, byte[] webp) {
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(WEBP_CONTENT_TYPE);
        metadata.setContentLength(webp.length);
        metadata.setCacheControl(CACHE_CONTROL);
        s3Client.putObject(publicBucket, key, new ByteArrayInputStream(webp), metadata);
    }

    /** Null when the object does not exist. */
    private ObjectMetadata head(String bucket, String key) {
        try {
            return s3Client.getObjectMetadata(bucket, key);
        } catch (AmazonServiceException e) {
            if (e.getStatusCode() == 404) {
                return null;
            }
            throw e;
        }
    }
}
