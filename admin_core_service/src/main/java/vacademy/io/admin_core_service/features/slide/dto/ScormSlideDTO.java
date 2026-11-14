package vacademy.io.admin_core_service.features.slide.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ScormSlideDTO {

    @JsonProperty("id")
    private String id;

    @JsonProperty("launch_url")
    private String launchUrl;

    @JsonProperty("scorm_version")
    private String scormVersion;

    @JsonProperty("original_file_id")
    private String originalFileId;

    @JsonProperty("launch_path")
    private String launchPath;

    // Upload response only: package repairs applied and progress-tracking warnings.
    @JsonProperty("compatibility_fixes")
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    private List<String> compatibilityFixes;

    @JsonProperty("compatibility_warnings")
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    private List<String> compatibilityWarnings;
}
