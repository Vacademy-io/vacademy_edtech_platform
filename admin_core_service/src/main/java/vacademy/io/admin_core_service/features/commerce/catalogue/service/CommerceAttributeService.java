package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeValueDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttribute;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttributeValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.AttributeKind;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductOptionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantOptionValueRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.enumName;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.require;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.requireNotNegative;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.trimToNull;

/** Attributes and their values. The institute id comes from the access guard. */
@Service
@RequiredArgsConstructor
public class CommerceAttributeService {

    private static final String ENTITY_ATTRIBUTE = "ATTRIBUTE";
    private static final String ENTITY_VALUE = "ATTRIBUTE_VALUE";

    private final CommerceAttributeRepository attributeRepository;
    private final CommerceAttributeValueRepository valueRepository;
    private final CommerceProductOptionRepository productOptionRepository;
    private final CommerceProductAttributeValueRepository productAttributeValueRepository;
    private final CommerceVariantOptionValueRepository variantOptionValueRepository;
    private final CommerceAuditService auditService;

    @Transactional(readOnly = true)
    public Page<AttributeDTO> list(String instituteId, int page, int size) {
        Page<CommerceAttribute> attributes = attributeRepository.findByInstituteId(instituteId,
                CatalogueRules.page(page, size, Sort.by(Sort.Order.asc("position"), Sort.Order.asc("code"))));
        List<String> ids = attributes.getContent().stream().map(CommerceAttribute::getId).toList();
        Map<String, List<CommerceAttributeValue>> values = ids.isEmpty() ? Map.of()
                : valueRepository.findByInstituteIdAndAttributeIdInOrderByPositionAsc(instituteId, ids).stream()
                        .collect(Collectors.groupingBy(CommerceAttributeValue::getAttributeId));
        return attributes.map(a -> toDto(a, values.getOrDefault(a.getId(), List.of())));
    }

    @Transactional(readOnly = true)
    public AttributeDTO get(String instituteId, String attributeId) {
        CommerceAttribute attribute = requireAttribute(instituteId, attributeId);
        return toDto(attribute, valueRepository
                .findByInstituteIdAndAttributeIdInOrderByPositionAsc(instituteId, List.of(attributeId)));
    }

    @Transactional
    public AttributeDTO create(String instituteId, String actorUserId, AttributeDTO request) {
        require(request != null, "request body is required");
        String code = CatalogueRules.requireCode(request.getCode(), "code");
        if (attributeRepository.findByInstituteIdAndCode(instituteId, code).isPresent()) {
            throw new ConflictException("An attribute with the code " + code + " already exists");
        }
        CommerceAttribute attribute = new CommerceAttribute();
        attribute.setInstituteId(instituteId);
        attribute.setCode(code);
        attribute.setKind(AttributeKind.TEXT.name());
        attribute.setIsFilterable(false);
        attribute.setPosition(0);
        applyFields(attribute, request, true);
        attribute = attributeRepository.save(attribute);
        audit(instituteId, actorUserId, "ATTRIBUTE_SAVED", ENTITY_ATTRIBUTE, attribute.getId(), code);
        return toDto(attribute, List.of());
    }

    /** The code is fixed; everything else may change. */
    @Transactional
    public AttributeDTO update(String instituteId, String actorUserId, String attributeId, AttributeDTO request) {
        require(request != null, "request body is required");
        CommerceAttribute attribute = requireAttribute(instituteId, attributeId);
        applyFields(attribute, request, false);
        attribute = attributeRepository.save(attribute);
        audit(instituteId, actorUserId, "ATTRIBUTE_SAVED", ENTITY_ATTRIBUTE, attribute.getId(),
                attribute.getCode());
        return get(instituteId, attributeId);
    }

    /** Refused while any product, variant or value still uses the attribute. */
    @Transactional
    public void delete(String instituteId, String actorUserId, String attributeId) {
        CommerceAttribute attribute = requireAttribute(instituteId, attributeId);
        if (productOptionRepository.existsByInstituteIdAndAttributeId(instituteId, attributeId)
                || variantOptionValueRepository.existsByInstituteIdAndAttributeId(instituteId, attributeId)
                || valueRepository.existsByInstituteIdAndAttributeId(instituteId, attributeId)) {
            throw new ConflictException("The attribute is in use; remove its values and options first");
        }
        attributeRepository.delete(attribute);
        audit(instituteId, actorUserId, "ATTRIBUTE_DELETED", ENTITY_ATTRIBUTE, attributeId, attribute.getCode());
    }

    @Transactional
    public AttributeValueDTO createValue(String instituteId, String actorUserId, String attributeId,
                                         AttributeValueDTO request) {
        require(request != null, "request body is required");
        CommerceAttribute attribute = requireAttribute(instituteId, attributeId);
        String code = CatalogueRules.requireCode(request.getCode(), "code");
        if (valueRepository.findByAttributeIdAndCode(attribute.getId(), code).isPresent()) {
            throw new ConflictException("The attribute already has a value with the code " + code);
        }
        CommerceAttributeValue value = new CommerceAttributeValue();
        value.setInstituteId(instituteId);
        value.setAttributeId(attribute.getId());
        value.setCode(code);
        value.setPosition(0);
        applyValueFields(value, request, true);
        value = valueRepository.save(value);
        audit(instituteId, actorUserId, "ATTRIBUTE_VALUE_SAVED", ENTITY_VALUE, value.getId(), code);
        return toDto(value);
    }

    @Transactional
    public AttributeValueDTO updateValue(String instituteId, String actorUserId, String attributeId,
                                         String valueId, AttributeValueDTO request) {
        require(request != null, "request body is required");
        CommerceAttributeValue value = requireValue(instituteId, attributeId, valueId);
        applyValueFields(value, request, false);
        value = valueRepository.save(value);
        audit(instituteId, actorUserId, "ATTRIBUTE_VALUE_SAVED", ENTITY_VALUE, value.getId(), value.getCode());
        return toDto(value);
    }

    /** Refused while any product or variant still carries the value. */
    @Transactional
    public void deleteValue(String instituteId, String actorUserId, String attributeId, String valueId) {
        CommerceAttributeValue value = requireValue(instituteId, attributeId, valueId);
        if (productAttributeValueRepository.existsByInstituteIdAndAttributeValueId(instituteId, valueId)
                || variantOptionValueRepository.existsByInstituteIdAndAttributeValueId(instituteId, valueId)) {
            throw new ConflictException("The value is in use by a product or a variant");
        }
        valueRepository.delete(value);
        audit(instituteId, actorUserId, "ATTRIBUTE_VALUE_DELETED", ENTITY_VALUE, valueId, value.getCode());
    }

    private CommerceAttribute requireAttribute(String instituteId, String attributeId) {
        return attributeRepository.findByInstituteIdAndId(instituteId, attributeId)
                .orElseThrow(() -> new ResourceNotFoundException("Attribute not found"));
    }

    private CommerceAttributeValue requireValue(String instituteId, String attributeId, String valueId) {
        CommerceAttributeValue value = valueRepository.findByInstituteIdAndId(instituteId, valueId)
                .orElseThrow(() -> new ResourceNotFoundException("Attribute value not found"));
        if (!value.getAttributeId().equals(attributeId)) {
            throw new ResourceNotFoundException("Attribute value not found");
        }
        return value;
    }

    private static void applyFields(CommerceAttribute attribute, AttributeDTO request, boolean creating) {
        Map<String, String> names = CatalogueRules.cleanI18n(request.getNameI18n());
        require(!creating || names != null, "name_i18n needs at least one language");
        require(request.getNameI18n() == null || names != null, "name_i18n needs at least one language");
        if (names != null) {
            attribute.setNameI18n(names);
        }
        String kind = enumName(AttributeKind.class, request.getKind(), "kind");
        if (kind != null) {
            attribute.setKind(kind);
        }
        if (request.getIsFilterable() != null) {
            attribute.setIsFilterable(request.getIsFilterable());
        }
        requireNotNegative(request.getPosition(), "position");
        if (request.getPosition() != null) {
            attribute.setPosition(request.getPosition());
        }
    }

    private static void applyValueFields(CommerceAttributeValue value, AttributeValueDTO request,
                                         boolean creating) {
        Map<String, String> labels = CatalogueRules.cleanI18n(request.getLabelI18n());
        require(!creating || labels != null, "label_i18n needs at least one language");
        require(request.getLabelI18n() == null || labels != null, "label_i18n needs at least one language");
        if (labels != null) {
            value.setLabelI18n(labels);
        }
        if (request.getSwatchHex() != null) {
            String hex = trimToNull(request.getSwatchHex());
            require(hex == null || hex.matches("#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?"),
                    "swatch_hex must look like #RRGGBB");
            value.setSwatchHex(hex);
        }
        requireNotNegative(request.getPosition(), "position");
        if (request.getPosition() != null) {
            value.setPosition(request.getPosition());
        }
    }

    private void audit(String instituteId, String actorUserId, String action, String entityType, String entityId,
                       String code) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("code", code);
        auditService.record(instituteId, actorUserId, action, entityType, entityId, CatalogueRules.json(detail));
    }

    private static AttributeDTO toDto(CommerceAttribute attribute, List<CommerceAttributeValue> values) {
        return AttributeDTO.builder()
                .id(attribute.getId())
                .code(attribute.getCode())
                .nameI18n(attribute.getNameI18n())
                .kind(attribute.getKind())
                .isFilterable(attribute.getIsFilterable())
                .position(attribute.getPosition())
                .values(values.stream().map(CommerceAttributeService::toDto).toList())
                .build();
    }

    private static AttributeValueDTO toDto(CommerceAttributeValue value) {
        return AttributeValueDTO.builder()
                .id(value.getId())
                .attributeId(value.getAttributeId())
                .code(value.getCode())
                .labelI18n(value.getLabelI18n())
                .swatchHex(value.getSwatchHex())
                .position(value.getPosition())
                .build();
    }
}
