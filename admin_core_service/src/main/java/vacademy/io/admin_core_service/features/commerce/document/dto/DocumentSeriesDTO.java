package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** A document series in requests and responses. Only status can change after creation. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DocumentSeriesDTO {

    private String id;
    private String sellerGstin;
    private String locationId;
    private String registerId;
    private String channel;
    private String documentType;
    private String kind;
    private String prefix;
    private String financialYear;
    /** At creation: the first number to issue (default 1). In responses: the next number. */
    private Long nextValue;
    private Long bookFrom;
    private Long bookTo;
    private String status;
    /** Read-only: what the next document number will look like. */
    private String nextNumberPreview;
}
