package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A rendered WPS salary file: content plus the filename / media type the
 * download endpoint should serve it under.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WpsFileDTO {

    private String filename;

    /** e.g. "text/plain" (UAE .sif) or "text/csv" (Saudi .csv). */
    private String mediaType;

    private String content;
}
