package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Deductor (employer) block of a Form 24Q — from hr_tax_configuration.statutory_settings. */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form24QDeductorDTO {

    private String name;
    private String tan;
    private String pan;
    private String address;
}
