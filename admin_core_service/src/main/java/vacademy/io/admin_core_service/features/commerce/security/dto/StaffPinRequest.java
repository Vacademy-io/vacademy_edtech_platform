package vacademy.io.admin_core_service.features.commerce.security.dto;

import lombok.Data;

/** Body of PUT /commerce/v1/staff/pin. */
@Data
public class StaffPinRequest {
    private String pin;
}
