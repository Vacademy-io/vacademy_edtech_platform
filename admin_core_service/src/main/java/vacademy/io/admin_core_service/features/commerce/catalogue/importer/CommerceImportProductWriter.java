package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportImageQueue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportImageQueueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Writes one planned product in one transaction: the product and its variants through
 * {@link CommerceProductService} (the only writer of products), new gallery entries through
 * {@link CommerceProductMediaService}, and the image addresses into the migration queue.
 * A failure rolls back this product only.
 *
 * <p>Everything here is safe to repeat. The product is found again by external_ref or
 * handle, a gallery entry is added only when the product does not have that file yet, and
 * an address is queued only once per product.
 */
@Component
public class CommerceImportProductWriter {

    /** What happened to one product. */
    public record Result(String packageId, boolean created, int imageUrlsQueued) { }

    private static final List<String> LOCALE_ORDER = List.of("hi", "en");

    private final CommerceProductService productService;
    private final CommerceProductMediaService mediaService;
    private final CommerceProductMediaRepository mediaRepository;
    private final CommerceImportImageQueueRepository imageQueueRepository;
    private final TransactionTemplate transaction;

    public CommerceImportProductWriter(CommerceProductService productService,
                                       CommerceProductMediaService mediaService,
                                       CommerceProductMediaRepository mediaRepository,
                                       CommerceImportImageQueueRepository imageQueueRepository,
                                       PlatformTransactionManager transactionManager) {
        this.productService = productService;
        this.mediaService = mediaService;
        this.mediaRepository = mediaRepository;
        this.imageQueueRepository = imageQueueRepository;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    public Result write(String instituteId, String actorUserId, String jobId, ProductPlan plan) {
        if (plan.hasErrors() || plan.getRequest() == null) {
            throw new IllegalArgumentException("a product plan with errors is never written");
        }
        return transaction.execute(status -> writeInTransaction(instituteId, actorUserId, jobId, plan));
    }

    private Result writeInTransaction(String instituteId, String actorUserId, String jobId, ProductPlan plan) {
        ProductRequest request = plan.getRequest();
        ProductResponse saved;
        boolean created;
        if (plan.getExistingPackageId() != null) {
            ProductResponse current = productService.get(instituteId, plan.getExistingPackageId());
            request.setTranslations(mergeTranslations(request.getTranslations(), current.getTranslations()));
            saved = productService.update(instituteId, actorUserId, plan.getExistingPackageId(), request);
            created = false;
        } else {
            // save() itself looks the external_ref up again, so a product that appeared since
            // the file was planned is updated, not duplicated.
            saved = productService.save(instituteId, actorUserId, request);
            created = true;
        }
        String packageId = saved.getPackageId();

        if (!plan.getGalleryMediaIds().isEmpty()) {
            Set<String> present = new HashSet<>();
            for (CommerceProductMedia media
                    : mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(instituteId, packageId)) {
                present.add(media.getMediaId());
            }
            for (String mediaId : plan.getGalleryMediaIds()) {
                if (present.add(mediaId)) {
                    mediaService.attach(instituteId, actorUserId,
                            ProductMediaDTO.builder().packageId(packageId).mediaId(mediaId).build());
                }
            }
        }

        int queued = 0;
        if (!plan.getImageUrls().isEmpty()) {
            Set<String> known = new HashSet<>();
            for (CommerceImportImageQueue row
                    : imageQueueRepository.findByInstituteIdAndPackageId(instituteId, packageId)) {
                known.add(row.getSourceUrl());
            }
            int position = known.size();
            for (String url : plan.getImageUrls()) {
                if (!known.add(url)) {
                    continue;
                }
                CommerceImportImageQueue row = new CommerceImportImageQueue();
                row.setInstituteId(instituteId);
                row.setJobId(jobId);
                row.setPackageId(packageId);
                row.setSourceUrl(url);
                row.setPosition(position++);
                row.setStatus(CommerceImportImageQueue.PENDING);
                imageQueueRepository.save(row);
                queued++;
            }
        }
        return new Result(packageId, created, queued);
    }

    /**
     * The service replaces a translation as a whole and takes the legacy name from the first
     * one. So that a blank cell leaves the stored text alone, each language of the file is
     * filled up from the stored one (content blocks included, which the file does not
     * carry), and Hindi stays first whenever the product has it.
     */
    static List<ProductTranslationDTO> mergeTranslations(List<ProductTranslationDTO> wanted,
                                                         List<ProductTranslationDTO> stored) {
        if (wanted == null || wanted.isEmpty()) {
            return null;
        }
        Map<String, ProductTranslationDTO> storedByLocale = new HashMap<>();
        if (stored != null) {
            stored.forEach(t -> storedByLocale.put(t.getLocale(), t));
        }
        Map<String, ProductTranslationDTO> wantedByLocale = new HashMap<>();
        wanted.forEach(t -> wantedByLocale.put(t.getLocale(), t));

        List<ProductTranslationDTO> out = new ArrayList<>();
        for (String locale : LOCALE_ORDER) {
            ProductTranslationDTO file = wantedByLocale.get(locale);
            ProductTranslationDTO old = storedByLocale.get(locale);
            if (file == null && old == null) {
                continue;
            }
            if (file == null) {
                // Not in the file: sent back unchanged, only to keep its place in front.
                out.add(old);
                continue;
            }
            String name = file.getName() != null ? file.getName() : old == null ? null : old.getName();
            if (name == null) {
                throw new InvalidRequestException("name_" + locale
                        + " is required: the product has no name in that language yet");
            }
            out.add(ProductTranslationDTO.builder()
                    .locale(locale)
                    .name(name)
                    .shortDescription(file.getShortDescription() != null ? file.getShortDescription()
                            : old == null ? null : old.getShortDescription())
                    .descriptionHtml(file.getDescriptionHtml() != null ? file.getDescriptionHtml()
                            : old == null ? null : old.getDescriptionHtml())
                    .contentBlocks(mergeBlocks(old == null ? null : old.getContentBlocks(), file.getContentBlocks()))
                    .build());
        }
        return out;
    }

    /**
     * The stored content blocks with the blocks of the file put in by code: a block the file
     * names replaces the stored one of that code, every other stored block is kept in its place,
     * and a block that is new comes last.
     */
    static List<Map<String, Object>> mergeBlocks(List<Map<String, Object>> stored, List<Map<String, Object>> file) {
        if (file == null || file.isEmpty()) {
            return stored;
        }
        Map<Object, Map<String, Object>> wanted = new java.util.LinkedHashMap<>();
        file.forEach(block -> wanted.put(block.get("code"), block));
        List<Map<String, Object>> out = new ArrayList<>();
        if (stored != null) {
            for (Map<String, Object> block : stored) {
                Map<String, Object> replacement = block == null ? null : wanted.remove(block.get("code"));
                out.add(replacement != null ? replacement : block);
            }
        }
        out.addAll(wanted.values());
        return out;
    }
}
