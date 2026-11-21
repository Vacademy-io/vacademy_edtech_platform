package vacademy.io.admin_core_service.features.packages.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.packages.entity.PackagePageContent;
import vacademy.io.admin_core_service.features.packages.repository.PackagePageContentRepository;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Course page content per package ({@code course_page_json}): a JSON object whose shape
 * the frontends own ({@code {"v":1,"mode":"SELF_PACED"|"LIVE"|null,"faqs":[{"q":..,"a":..}]}}).
 * The backend stores the string verbatim and only checks it is a JSON object of at most
 * {@link #MAX_LENGTH} characters.
 *
 * <p>Write semantics:
 * <ul>
 *   <li>create: null or blank = nothing stored; otherwise validate and store.</li>
 *   <li>update: null (field absent, as older admin builds send) = leave the stored content
 *       untouched; blank ("") = clear it; otherwise validate and replace.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class PackagePageContentService {

    public static final int MAX_LENGTH = 100_000;

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private final PackagePageContentRepository packagePageContentRepository;

    /**
     * Throws HTTP 400 unless {@code json} is null, blank, or a JSON object within the size cap.
     * Call it before writing anything else, so a bad payload never half-saves a course.
     */
    public static void validate(String json) {
        if (!StringUtils.hasText(json)) {
            return;
        }
        if (json.length() > MAX_LENGTH) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "course_page_json is too large: " + json.length() + " characters (max " + MAX_LENGTH + ")");
        }
        JsonNode node;
        try {
            node = MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "course_page_json is not valid JSON: " + e.getOriginalMessage());
        }
        if (node == null || !node.isObject()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "course_page_json must be a JSON object, e.g. {\"v\":1,\"faqs\":[]}");
        }
    }

    /** Course creation: store the content when one was sent; null or blank stores nothing. */
    public void applyOnCreate(String packageId, String json) {
        if (!StringUtils.hasText(json) || !StringUtils.hasText(packageId)) {
            return;
        }
        validate(json);
        upsert(packageId, json);
    }

    /** Course update: null leaves the content untouched, blank clears it, anything else replaces it. */
    public void applyOnUpdate(String packageId, String json) {
        if (json == null || !StringUtils.hasText(packageId)) {
            return;
        }
        if (!StringUtils.hasText(json)) {
            packagePageContentRepository.findById(packageId).ifPresent(packagePageContentRepository::delete);
            return;
        }
        validate(json);
        upsert(packageId, json);
    }

    /** The stored content of one package, or null when it has none. */
    public String getContentJson(String packageId) {
        if (!StringUtils.hasText(packageId)) {
            return null;
        }
        return packagePageContentRepository.findById(packageId)
                .map(PackagePageContent::getContentJson)
                .orElse(null);
    }

    /**
     * Make {@code toPackageId} carry the same content as {@code fromPackageId} (used when a course
     * is copied into, or merged back from, another package). No content on the source = none on
     * the target.
     */
    public void copy(String fromPackageId, String toPackageId) {
        if (!StringUtils.hasText(fromPackageId) || !StringUtils.hasText(toPackageId)
                || fromPackageId.equals(toPackageId)) {
            return;
        }
        String content = getContentJson(fromPackageId);
        if (StringUtils.hasText(content)) {
            upsert(toPackageId, content);
        } else {
            packagePageContentRepository.findById(toPackageId).ifPresent(packagePageContentRepository::delete);
        }
    }

    private void upsert(String packageId, String json) {
        PackagePageContent row = packagePageContentRepository.findById(packageId)
                .orElseGet(() -> new PackagePageContent(packageId, null));
        row.setContentJson(json);
        packagePageContentRepository.save(row);
    }
}
