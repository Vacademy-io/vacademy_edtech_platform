package vacademy.io.admin_core_service.features.institute_api.entity;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

/** Composite key of {@link InstituteApiAccess}: (institute_id, product). */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class InstituteApiAccessId implements Serializable {
    private String instituteId;
    private String product;
}
