package vacademy.io.admin_core_service.features.learner_home.media;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.learner_home.model.HomeImages;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ImageRef;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ImageSlotRef;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Publish-time image work, done before the publish transaction opens: the permanent URL of each
 * image and its WebP renditions. Sequential, one image at a time (the rendition service is shared
 * and memory-bound). A failure never blocks publish: it becomes a warning and the learner app
 * falls back to the original URL.
 */
@Slf4j
@Component
public class LearnerHomeMediaService {

    /** The rendition ladder starts at 320; a smaller original gets no renditions. */
    static final int LADDER_MIN = 320;

    private final LearnerHomeRenditionClient renditionClient;
    private final CatalogMediaResolver mediaResolver;

    public LearnerHomeMediaService(LearnerHomeRenditionClient renditionClient, CatalogMediaResolver mediaResolver) {
        this.renditionClient = renditionClient;
        this.mediaResolver = mediaResolver;
    }

    public List<Block> prepare(String instituteId, List<Block> blocks, List<Issue> warnings) {
        Map<String, ImageRef> done = new HashMap<>();
        List<Block> out = new ArrayList<>();
        for (Block b : blocks) {
            out.add(HomeImages.mapImages(b, ref -> {
                ImageRef image = ref.image();
                if (image.fileId() == null) return image;
                ImageRef cached = done.get(image.fileId());
                ImageRef prepared = cached != null
                        ? image.withMedia(image.url() != null ? image.url() : cached.url(), cached.width(),
                                cached.height(), cached.renditions())
                        : prepareOne(instituteId, b.blockKey(), ref, warnings);
                done.putIfAbsent(image.fileId(), prepared);
                if (prepared.width() != null && prepared.width() < HomeImages.minWidth(ref.slot())) {
                    warnings.add(new Issue(b.blockKey(), ref.path(), "IMAGE_TOO_SMALL",
                            "This image is " + prepared.width() + " px wide; at least "
                                    + HomeImages.minWidth(ref.slot()) + " px is recommended"));
                }
                return prepared;
            }));
        }
        return out;
    }

    private ImageRef prepareOne(String instituteId, String blockKey, ImageSlotRef ref, List<Issue> warnings) {
        ImageRef image = ref.image();
        if (image.renditions() != null && !image.renditions().isEmpty()) {
            return image;
        }
        if (image.width() != null && image.width() < LADDER_MIN) {
            return missingUrl(image, blockKey, ref, warnings);
        }
        try {
            // The media service checks that the file was uploaded as learner-home media of this
            // institute; only then is its permanent URL looked up here.
            LearnerHomeRenditionClient.Result r = renditionClient.generate(image.fileId(), instituteId);
            Map<String, String> renditions = new LinkedHashMap<>();
            r.urls().forEach((w, u) -> renditions.put(String.valueOf(w), u));
            String url = image.url();
            if (url == null) {
                try {
                    url = mediaResolver.resolveOne(image.fileId());
                } catch (RuntimeException e) {
                    log.warn("[learner-home] URL of file {} not resolved: {}", image.fileId(), e.getMessage());
                }
            }
            return image.withMedia(url, r.width(), r.height(), Collections.unmodifiableMap(renditions));
        } catch (LearnerHomeRenditionClient.RenditionFailed e) {
            warnings.add(new Issue(blockKey, ref.path(), "RENDITION_FAILED",
                    "Smaller copies of this image could not be made (" + e.getCode() + "); the original is used"));
            return missingUrl(image, blockKey, ref, warnings);
        }
    }

    /** Without renditions the learner app needs the original URL, which the editor sends with the upload. */
    private static ImageRef missingUrl(ImageRef image, String blockKey, ImageSlotRef ref, List<Issue> warnings) {
        if (image.url() == null) {
            warnings.add(new Issue(blockKey, ref.path(), "IMAGE_URL_MISSING",
                    "This image has no address yet; upload it again"));
        }
        return image;
    }
}
