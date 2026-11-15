package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttribute;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttributeValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCollection;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.VariantInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportProductReadRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportVariantReadRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxClass;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxClassRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;

import java.util.List;

/**
 * Reads what one institute has, once per file. Every query carries the institute id, so the
 * planner can only ever resolve a code or an id to a row of that institute.
 *
 * <p>The transaction is not read-only on purpose: a read-only transaction goes to the
 * replica, and a job that runs right after another one must see the products it wrote.
 */
@Component
@RequiredArgsConstructor
public class ImportReferenceLoader {

    private final CommerceTaxClassRepository taxClassRepository;
    private final CommerceTaxSettingService taxSettingService;
    private final StockLocationRepository locationRepository;
    private final CommerceAttributeRepository attributeRepository;
    private final CommerceAttributeValueRepository attributeValueRepository;
    private final CommerceCollectionRepository collectionRepository;
    private final CommerceImportProductReadRepository productReadRepository;
    private final CommerceImportVariantReadRepository variantReadRepository;

    @Transactional
    public ImportReferenceData load(String instituteId) {
        ImportReferenceData ref = new ImportReferenceData();
        ref.taxClassRequiredToPublish(taxSettingService.context(instituteId).getMode() == TaxMode.REGULAR);
        for (CommerceTaxClass taxClass : taxClassRepository.findByInstituteId(instituteId, Pageable.unpaged())) {
            ref.addTaxClass(taxClass.getId(), taxClass.getCode(), taxClass.getHsnCode(), taxClass.getStatus());
        }
        for (StockLocation location : locationRepository.findByInstituteIdOrderByCodeAsc(instituteId)) {
            ref.addLocation(location.getId(), location.getCode(), location.isSource());
        }
        List<CommerceAttribute> attributes = attributeRepository.findByInstituteId(instituteId, Pageable.unpaged())
                .getContent();
        for (CommerceAttribute attribute : attributes) {
            ref.addAttribute(attribute.getId(), attribute.getCode());
        }
        if (!attributes.isEmpty()) {
            for (CommerceAttributeValue value : attributeValueRepository
                    .findByInstituteIdAndAttributeIdInOrderByPositionAsc(instituteId,
                            attributes.stream().map(CommerceAttribute::getId).toList())) {
                ref.addValue(value.getId(), value.getAttributeId(), value.getCode());
            }
        }
        for (CommerceCollection collection : collectionRepository.findByInstituteIdOrderByPositionAsc(instituteId)) {
            ref.addCollection(collection.getId(), collection.getParentId(), collection.getSlug());
        }
        for (CommerceProduct product : productReadRepository.findByInstituteId(instituteId)) {
            ref.addProduct(new ProductInfo(product.getPackageId(), product.getSlug(), product.getExternalRef(),
                    product.getTaxClassId(), product.getStockMode(), product.getUnit(), product.getQtyScale(),
                    product.getStatus(), product.getPublishedAt() != null));
        }
        for (CommerceVariant variant : variantReadRepository.findByInstituteId(instituteId)) {
            ref.addVariant(new VariantInfo(variant.getPackageSessionId(), variant.getPackageId(), variant.getSku(),
                    variant.getBarcode(), variant.getExternalRef(), variant.getStockPolicy(), variant.getStatus()));
        }
        return ref;
    }
}
