package vacademy.io.admin_core_service.features.institute_api.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** POST /admin-core-service/super-admin/v1/api-access/bulk-enable (spec 10.7). */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class BulkEnableApiAccessRequest {

    @JsonProperty("institute_ids")
    @JsonAlias("instituteIds")
    private List<String> instituteIds;

    private String product;

    /** school | university | upsc | null (keeps an existing row's segment). */
    private String segment;

    private String reason;
}
