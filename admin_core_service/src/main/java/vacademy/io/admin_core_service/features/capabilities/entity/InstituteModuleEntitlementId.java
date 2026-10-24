package vacademy.io.admin_core_service.features.capabilities.entity;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

/** Composite key of {@link InstituteModuleEntitlement}: (institute_id, key). */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class InstituteModuleEntitlementId implements Serializable {
    private String instituteId;
    private String key;
}
