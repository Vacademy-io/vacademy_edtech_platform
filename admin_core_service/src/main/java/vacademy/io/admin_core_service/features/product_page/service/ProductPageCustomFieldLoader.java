package vacademy.io.admin_core_service.features.product_page.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageReadRepository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * The checkout-form fields of every invite on a product page, read in one
 * query instead of one per course.
 *
 * Returns, per invite, exactly the list
 * InstituteCustomFiledService.findCustomFieldsAsJson builds for it (same
 * rows, same order, same DTO), so the page's aggregated form is unchanged.
 * The DTO mapping is a copy of that service's private converter; the
 * by-code comparison test runs the real service beside this one, on page
 * fixtures and on a row with every entity column filled, to keep the two
 * from drifting apart.
 */
@Component
public class ProductPageCustomFieldLoader {

    /** Keeps each IN list well inside what the database and driver handle comfortably. */
    static final int CHUNK = 500;

    @Autowired
    private ProductPageReadRepository readRepository;

    /** Invite id -> its ACTIVE fields in form order. Invites with no fields are absent. */
    public Map<String, List<InstituteCustomFieldDTO>> fieldsByInvite(String instituteId,
                                                                    Collection<String> enrollInviteIds) {
        Map<String, List<InstituteCustomFieldDTO>> out = new LinkedHashMap<>();
        List<String> ids = new ArrayList<>(new LinkedHashSet<>(enrollInviteIds));
        ids.removeIf(id -> id == null);
        for (int from = 0; from < ids.size(); from += CHUNK) {
            List<String> chunk = ids.subList(from, Math.min(ids.size(), from + CHUNK));
            List<Object[]> rows = readRepository.findCustomFieldsWithDetailsForTypeIds(
                    instituteId, CustomFieldTypeEnum.ENROLL_INVITE.name(), chunk, StatusEnum.ACTIVE.name());
            for (Object[] row : rows) {
                InstituteCustomFieldDTO dto = toDto(row);
                // Belt and braces: the query already filters on status.
                if (!StatusEnum.ACTIVE.name().equals(dto.getStatus())) continue;
                out.computeIfAbsent(dto.getTypeId(), k -> new ArrayList<>()).add(dto);
            }
        }
        return out;
    }

    /** Copy of InstituteCustomFiledService#convertToInstituteCustomFieldDto. */
    static InstituteCustomFieldDTO toDto(Object[] result) {
        InstituteCustomField icf = (InstituteCustomField) result[0];
        CustomFields cf = (CustomFields) result[1];

        CustomFieldDTO customFieldDTO = new CustomFieldDTO();
        customFieldDTO.setId(cf.getId());
        customFieldDTO.setFieldKey(cf.getFieldKey());
        customFieldDTO.setFieldName(cf.getFieldName());
        customFieldDTO.setFieldType(cf.getFieldType());
        customFieldDTO.setDefaultValue(cf.getDefaultValue());
        customFieldDTO.setConfig(cf.getConfig());
        customFieldDTO.setFormOrder(cf.getFormOrder());
        customFieldDTO.setIsMandatory(cf.getIsMandatory());
        customFieldDTO.setIsFilter(cf.getIsFilter());
        customFieldDTO.setIsSortable(cf.getIsSortable());
        customFieldDTO.setIsHidden(cf.getIsHidden());
        if (cf.getCreatedAt() != null) {
            customFieldDTO.setCreatedAt(new Timestamp(cf.getCreatedAt().getTime()));
        }
        if (cf.getUpdatedAt() != null) {
            customFieldDTO.setUpdatedAt(new Timestamp(cf.getUpdatedAt().getTime()));
        }
        customFieldDTO.setSessionId(icf.getTypeId());

        InstituteCustomFieldDTO instituteDTO = new InstituteCustomFieldDTO();
        instituteDTO.setId(icf.getId());
        instituteDTO.setFieldId(cf.getId());
        instituteDTO.setInstituteId(icf.getInstituteId());
        instituteDTO.setType(icf.getType());
        instituteDTO.setTypeId(icf.getTypeId());
        instituteDTO.setGroupName(icf.getGroupName());
        instituteDTO.setIndividualOrder(icf.getIndividualOrder());
        instituteDTO.setGroupInternalOrder(icf.getGroupInternalOrder());
        instituteDTO.setIsMandatory(icf.getIsMandatory());
        instituteDTO.setCustomField(customFieldDTO);
        instituteDTO.setStatus(icf.getStatus());
        return instituteDTO;
    }
}
