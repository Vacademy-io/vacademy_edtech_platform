package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/**
 * The different phone numbers and real emails the person behind a lead enquired with,
 * each with the first enquiry that brought it (lead "Other contact details" in the side
 * panel). Placeholder emails minted for emailless leads are left out.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadEnquiryContactsDTO {

    private List<Contact> phones;
    private List<Contact> emails;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Contact {
        private String value;
        private String responseId;
        private String sourceType;
        private String campaignName;
        private Timestamp createdAt;
    }
}
