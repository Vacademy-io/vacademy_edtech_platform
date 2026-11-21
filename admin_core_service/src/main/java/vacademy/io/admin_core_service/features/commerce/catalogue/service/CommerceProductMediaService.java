package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.MediaKind;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionService;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.enumName;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.require;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.requireNotNegative;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.trimToNull;

/**
 * The gallery of a product. A row points at a file that is already in the media service; the
 * file itself is never created or removed here.
 */
@Service
@RequiredArgsConstructor
public class CommerceProductMediaService {

    private static final String ENTITY_MEDIA = "PRODUCT_MEDIA";

    private final CommerceProductMediaRepository mediaRepository;
    private final CommerceProductRepository productRepository;
    private final CommerceVariantRepository variantRepository;
    private final CommerceAuditService auditService;
    private final CommerceRenditionService renditionService;

    @Transactional(readOnly = true)
    public Page<ProductMediaDTO> list(String instituteId, String packageId, int page, int size) {
        requireProduct(instituteId, packageId);
        return mediaRepository.findByInstituteIdAndPackageId(instituteId, packageId,
                        CatalogueRules.page(page, size, Sort.by(Sort.Order.asc("position"), Sort.Order.asc("id"))))
                .map(CommerceProductMediaService::toDto);
    }

    @Transactional
    public ProductMediaDTO attach(String instituteId, String actorUserId, ProductMediaDTO request) {
        require(request != null, "request body is required");
        String packageId = trimToNull(request.getPackageId());
        require(packageId != null, "package_id is required");
        requireProduct(instituteId, packageId);
        String mediaId = CatalogueRules.mediaId(request.getMediaId());
        require(mediaId != null, "media_id is required");

        CommerceProductMedia media = new CommerceProductMedia();
        media.setInstituteId(instituteId);
        media.setPackageId(packageId);
        media.setMediaId(mediaId);
        media.setKind(MediaKind.IMAGE.name());
        applyFields(instituteId, media, request);
        if (request.getPosition() == null) {
            // Appended after the entries the product already has.
            media.setPosition(mediaRepository
                    .findByInstituteIdAndPackageIdOrderByPositionAsc(instituteId, packageId).size());
        }
        media = mediaRepository.save(media);
        audit(instituteId, actorUserId, "MEDIA_ATTACHED", media);
        requestRenditions(media);
        return toDto(media);
    }

    @Transactional
    public ProductMediaDTO update(String instituteId, String actorUserId, String mediaRowId, ProductMediaDTO request) {
        require(request != null, "request body is required");
        CommerceProductMedia media = requireMedia(instituteId, mediaRowId);
        String mediaId = CatalogueRules.mediaId(request.getMediaId());
        boolean fileChanged = mediaId != null && !mediaId.equals(media.getMediaId());
        if (mediaId != null) {
            media.setMediaId(mediaId);
        }
        applyFields(instituteId, media, request);
        media = mediaRepository.save(media);
        audit(instituteId, actorUserId, "MEDIA_UPDATED", media);
        if (fileChanged && MediaKind.IMAGE.name().equals(media.getKind())) {
            // The renditions of the old file must not be served for the new one.
            renditionService.resetForNewFile(media);
        }
        return toDto(media);
    }

    /** Removes the gallery row only. */
    @Transactional
    public void remove(String instituteId, String actorUserId, String mediaRowId) {
        CommerceProductMedia media = requireMedia(instituteId, mediaRowId);
        mediaRepository.delete(media);
        audit(instituteId, actorUserId, "MEDIA_REMOVED", media);
    }

    /** Sets the gallery order of one product. Every row of the product must be named once. */
    @Transactional
    public List<ProductMediaDTO> reorder(String instituteId, String actorUserId, String packageId,
                                         List<String> mediaRowIds) {
        require(trimToNull(packageId) != null, "package_id is required");
        require(mediaRowIds != null, "media_row_ids is required");
        requireProduct(instituteId, packageId);
        Map<String, CommerceProductMedia> rows = new HashMap<>();
        mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(instituteId, packageId)
                .forEach(row -> rows.put(row.getId(), row));
        require(new HashSet<>(mediaRowIds).size() == mediaRowIds.size() && mediaRowIds.size() == rows.size()
                        && rows.keySet().containsAll(mediaRowIds),
                "media_row_ids must name every gallery entry of the product exactly once");
        List<CommerceProductMedia> ordered = new ArrayList<>();
        for (int i = 0; i < mediaRowIds.size(); i++) {
            CommerceProductMedia row = rows.get(mediaRowIds.get(i));
            row.setPosition(i);
            ordered.add(row);
        }
        List<ProductMediaDTO> result = mediaRepository.saveAll(ordered).stream()
                .map(CommerceProductMediaService::toDto).toList();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("count", ordered.size());
        auditService.record(instituteId, actorUserId, "MEDIA_REORDERED", "PRODUCT", packageId,
                CatalogueRules.json(detail));
        return result;
    }

    /**
     * WebP renditions are made after the commit, off the request thread. The save never
     * waits for them and never fails because of them; until they exist the row reads as
     * PENDING (renditions is null) and the editor shows "processing".
     */
    private void requestRenditions(CommerceProductMedia media) {
        if (MediaKind.IMAGE.name().equals(media.getKind())) {
            renditionService.requestAfterCommit(media.getId());
        }
    }

    private void requireProduct(String instituteId, String packageId) {
        if (productRepository.findByInstituteIdAndPackageId(instituteId, packageId).isEmpty()) {
            throw new ResourceNotFoundException("Product not found");
        }
    }

    private CommerceProductMedia requireMedia(String instituteId, String mediaRowId) {
        return mediaRepository.findByInstituteIdAndId(instituteId, mediaRowId)
                .orElseThrow(() -> new ResourceNotFoundException("Gallery entry not found"));
    }

    private void applyFields(String instituteId, CommerceProductMedia media, ProductMediaDTO request) {
        // An empty package_session_id unties the entry from a variant; null leaves it as it is.
        if (request.getPackageSessionId() != null) {
            String packageSessionId = trimToNull(request.getPackageSessionId());
            if (packageSessionId != null) {
                CommerceVariant variant = variantRepository
                        .findByInstituteIdAndPackageSessionId(instituteId, packageSessionId)
                        .orElseThrow(() -> new ResourceNotFoundException("Variant not found"));
                require(variant.getPackageId().equals(media.getPackageId()),
                        "the variant does not belong to this product");
            }
            media.setPackageSessionId(packageSessionId);
        }
        String kind = enumName(MediaKind.class, request.getKind(), "kind");
        if (kind != null) {
            media.setKind(kind);
        }
        if (request.getTag() != null) {
            String tag = trimToNull(request.getTag());
            require(tag == null || tag.length() <= 32, "tag is at most 32 characters");
            media.setTag(tag == null ? null : tag.toUpperCase(Locale.ROOT));
        }
        if (request.getAltI18n() != null) {
            media.setAltI18n(CatalogueRules.cleanI18n(request.getAltI18n()));
        }
        requireNotNegative(request.getWidth(), "width");
        if (request.getWidth() != null) {
            media.setWidth(request.getWidth());
        }
        requireNotNegative(request.getHeight(), "height");
        if (request.getHeight() != null) {
            media.setHeight(request.getHeight());
        }
        requireNotNegative(request.getPosition(), "position");
        if (request.getPosition() != null) {
            media.setPosition(request.getPosition());
        }
    }

    private void audit(String instituteId, String actorUserId, String action, CommerceProductMedia media) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("package_id", media.getPackageId());
        detail.put("media_id", media.getMediaId());
        detail.put("tag", media.getTag());
        auditService.record(instituteId, actorUserId, action, ENTITY_MEDIA, media.getId(),
                CatalogueRules.json(detail));
    }

    private static ProductMediaDTO toDto(CommerceProductMedia media) {
        return ProductMediaDTO.builder()
                .id(media.getId())
                .packageId(media.getPackageId())
                .packageSessionId(media.getPackageSessionId())
                .mediaId(media.getMediaId())
                .kind(media.getKind())
                .tag(media.getTag())
                .altI18n(media.getAltI18n())
                .width(media.getWidth())
                .height(media.getHeight())
                .renditions(media.getRenditionsJson())
                .position(media.getPosition())
                .build();
    }
}
