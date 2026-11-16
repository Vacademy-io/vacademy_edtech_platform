package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCollection;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductCollection;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.CollectionKind;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.CollectionStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.enumName;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.require;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.requireNotNegative;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.trimToNull;

/** Categories and collections, as a tree. A collection is archived, never deleted. */
@Service
@RequiredArgsConstructor
public class CommerceCollectionService {

    private static final String ENTITY_COLLECTION = "COLLECTION";

    private final CommerceCollectionRepository collectionRepository;
    private final CommerceProductCollectionRepository productCollectionRepository;
    private final CommerceProductRepository productRepository;
    private final CommerceAuditService auditService;

    @Transactional(readOnly = true)
    public Page<CollectionDTO> list(String instituteId, int page, int size) {
        return collectionRepository.findByInstituteId(instituteId,
                        CatalogueRules.page(page, size, Sort.by(Sort.Order.asc("position"), Sort.Order.asc("slug"))))
                .map(c -> toDto(c, null));
    }

    /** The whole tree of the institute: roots first, children nested, each level by position. */
    @Transactional(readOnly = true)
    public List<CollectionDTO> tree(String instituteId) {
        List<CommerceCollection> all = collectionRepository.findByInstituteIdOrderByPositionAsc(instituteId);
        Map<String, CollectionDTO> nodes = new LinkedHashMap<>();
        all.forEach(c -> nodes.put(c.getId(), toDto(c, new ArrayList<>())));
        List<CollectionDTO> roots = new ArrayList<>();
        for (CommerceCollection collection : all) {
            CollectionDTO node = nodes.get(collection.getId());
            CollectionDTO parent = collection.getParentId() == null ? null : nodes.get(collection.getParentId());
            if (parent == null) {
                roots.add(node);
            } else {
                parent.getChildren().add(node);
            }
        }
        return roots;
    }

    @Transactional(readOnly = true)
    public CollectionDTO get(String instituteId, String collectionId) {
        return toDto(requireCollection(instituteId, collectionId), null);
    }

    @Transactional
    public CollectionDTO create(String instituteId, String actorUserId, CollectionDTO request) {
        require(request != null, "request body is required");
        Map<String, String> names = CatalogueRules.cleanI18n(request.getNameI18n());
        require(names != null, "name_i18n needs at least one language");

        CommerceCollection collection = new CommerceCollection();
        collection.setInstituteId(instituteId);
        collection.setKind(CollectionKind.CATEGORY.name());
        collection.setStatus(CollectionStatus.ACTIVE.name());
        collection.setPosition(0);
        String slug = trimToNull(request.getSlug());
        if (slug == null) {
            slug = CatalogueRules.slugFrom(names.values().iterator().next());
            if (slug.isEmpty() || collectionRepository.findByInstituteIdAndSlug(instituteId, slug).isPresent()) {
                slug = (slug.isEmpty() ? "collection" : slug) + "-" + CatalogueRules.randomSuffix();
            }
            collection.setSlug(slug);
        }
        applyFields(instituteId, collection, request);
        collection = collectionRepository.save(collection);
        audit(instituteId, actorUserId, "COLLECTION_SAVED", collection);
        return toDto(collection, null);
    }

    @Transactional
    public CollectionDTO update(String instituteId, String actorUserId, String collectionId, CollectionDTO request) {
        require(request != null, "request body is required");
        CommerceCollection collection = requireCollection(instituteId, collectionId);
        applyFields(instituteId, collection, request);
        collection = collectionRepository.save(collection);
        audit(instituteId, actorUserId, "COLLECTION_SAVED", collection);
        return toDto(collection, null);
    }

    /** Package ids of the collection, in display order. */
    @Transactional(readOnly = true)
    public List<String> products(String instituteId, String collectionId) {
        requireCollection(instituteId, collectionId);
        return productCollectionRepository
                .findByInstituteIdAndCollectionIdOrderByPositionAsc(instituteId, collectionId).stream()
                .map(CommerceProductCollection::getPackageId).toList();
    }

    /** Replaces the products of the collection; the list order becomes the display order. */
    @Transactional
    public List<String> setProducts(String instituteId, String actorUserId, String collectionId,
                                    List<String> packageIds) {
        require(packageIds != null, "package_ids is required");
        CommerceCollection collection = requireCollection(instituteId, collectionId);
        List<String> wanted = new ArrayList<>();
        for (String id : packageIds) {
            require(trimToNull(id) != null, "package_ids holds an empty id");
            wanted.add(id.trim());
        }
        require(new HashSet<>(wanted).size() == wanted.size(), "package_ids holds a product twice");
        if (!wanted.isEmpty()) {
            Set<String> found = productRepository.findByInstituteIdAndPackageIdIn(instituteId, wanted).stream()
                    .map(CommerceProduct::getPackageId).collect(Collectors.toSet());
            for (String id : wanted) {
                require(found.contains(id), "unknown product: " + id);
            }
        }
        // Rows are changed in place: delete-then-insert would break the unique pair at flush.
        Map<String, CommerceProductCollection> existing = new HashMap<>();
        productCollectionRepository
                .findByInstituteIdAndCollectionIdOrderByPositionAsc(instituteId, collectionId)
                .forEach(row -> existing.put(row.getPackageId(), row));
        for (int i = 0; i < wanted.size(); i++) {
            CommerceProductCollection row = existing.remove(wanted.get(i));
            if (row == null) {
                row = new CommerceProductCollection();
                row.setInstituteId(instituteId);
                row.setCollectionId(collectionId);
                row.setPackageId(wanted.get(i));
            }
            row.setPosition(i);
            productCollectionRepository.save(row);
        }
        if (!existing.isEmpty()) {
            productCollectionRepository.deleteAll(existing.values());
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("slug", collection.getSlug());
        detail.put("product_count", wanted.size());
        auditService.record(instituteId, actorUserId, "COLLECTION_PRODUCTS_SET", ENTITY_COLLECTION, collectionId,
                CatalogueRules.json(detail));
        return wanted;
    }

    private CommerceCollection requireCollection(String instituteId, String collectionId) {
        return collectionRepository.findByInstituteIdAndId(instituteId, collectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Collection not found"));
    }

    private void applyFields(String instituteId, CommerceCollection collection, CollectionDTO request) {
        String slug = trimToNull(request.getSlug());
        if (slug != null) {
            slug = CatalogueRules.requireSlug(slug);
            if (!slug.equals(collection.getSlug())) {
                if (collectionRepository.findByInstituteIdAndSlug(instituteId, slug).isPresent()) {
                    throw new ConflictException("Another collection already uses the slug " + slug);
                }
                collection.setSlug(slug);
            }
        }
        if (request.getNameI18n() != null) {
            Map<String, String> names = CatalogueRules.cleanI18n(request.getNameI18n());
            require(names != null, "name_i18n needs at least one language");
            collection.setNameI18n(names);
        }
        if (request.getDescriptionI18n() != null) {
            collection.setDescriptionI18n(CatalogueRules.cleanI18n(request.getDescriptionI18n()));
        }
        String kind = enumName(CollectionKind.class, request.getKind(), "kind");
        if (kind != null) {
            collection.setKind(kind);
        }
        String status = enumName(CollectionStatus.class, request.getStatus(), "status");
        if (status != null) {
            collection.setStatus(status);
        }
        if (request.getMediaId() != null) {
            collection.setMediaId(CatalogueRules.mediaId(request.getMediaId()));
        }
        requireNotNegative(request.getReturnWindowDays(), "return_window_days");
        if (request.getReturnWindowDays() != null) {
            collection.setReturnWindowDays(request.getReturnWindowDays());
        }
        requireNotNegative(request.getPosition(), "position");
        if (request.getPosition() != null) {
            collection.setPosition(request.getPosition());
        }
        if (trimToNull(request.getExternalRef()) != null) {
            collection.setExternalRef(request.getExternalRef().trim());
        }
        // An empty parent_id moves the collection to the root; null leaves the parent as it is.
        if (request.getParentId() != null) {
            String parentId = trimToNull(request.getParentId());
            if (parentId != null) {
                requireNoCycle(instituteId, collection, parentId);
            }
            collection.setParentId(parentId);
        }
    }

    /** The new parent is of this institute and is neither the collection nor one of its descendants. */
    private void requireNoCycle(String instituteId, CommerceCollection collection, String parentId) {
        Set<String> seen = new HashSet<>();
        String cursor = parentId;
        while (cursor != null) {
            require(collection.getId() == null || !cursor.equals(collection.getId()),
                    "a collection cannot be moved under itself or its own descendant");
            require(seen.add(cursor), "the collection tree holds a loop");
            String id = cursor;
            cursor = collectionRepository.findByInstituteIdAndId(instituteId, id)
                    .orElseThrow(() -> new ResourceNotFoundException("Parent collection not found"))
                    .getParentId();
        }
    }

    private void audit(String instituteId, String actorUserId, String action, CommerceCollection collection) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("slug", collection.getSlug());
        detail.put("status", collection.getStatus());
        detail.put("parent_id", collection.getParentId());
        auditService.record(instituteId, actorUserId, action, ENTITY_COLLECTION, collection.getId(),
                CatalogueRules.json(detail));
    }

    private static CollectionDTO toDto(CommerceCollection collection, List<CollectionDTO> children) {
        return CollectionDTO.builder()
                .id(collection.getId())
                .parentId(collection.getParentId())
                .kind(collection.getKind())
                .slug(collection.getSlug())
                .nameI18n(collection.getNameI18n())
                .descriptionI18n(collection.getDescriptionI18n())
                .mediaId(collection.getMediaId())
                .returnWindowDays(collection.getReturnWindowDays())
                .position(collection.getPosition())
                .status(collection.getStatus())
                .externalRef(collection.getExternalRef())
                .children(children)
                .build();
    }
}
