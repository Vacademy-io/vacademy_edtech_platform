package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalDate;

/** Body of POST and PUT /commerce/v1/locations. In an update a null field is left unchanged. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LocationRequest {
    private String code;
    private String name;
    private String addressLine1;
    private String addressLine2;
    private String city;
    private String pincode;
    private String stateCode;
    private String gstin;
    private Boolean isStore;
    private Boolean isWarehouse;
    private Boolean isSource;
    private Boolean isTemporary;
    private LocalDate startsOn;
    private LocalDate endsOn;
    private Boolean sellsOnline;
    private Boolean isPosEnabled;
    private String status;
}
