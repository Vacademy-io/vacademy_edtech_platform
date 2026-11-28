package vacademy.io.admin_core_service.features.catalogue_review.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One answer to a custom question of the review form: the field key, its label as shown, the value. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ReviewAnswer {
    private String key;
    private String label;
    private String value;
}
