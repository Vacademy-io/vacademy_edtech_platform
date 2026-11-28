package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One chip in the Call Log's disposition strip: an effective outcome (manual key,
 * else the AI agent's) present in the current window, and how many calls carry it.
 * {@code key} is the normalized form the disposition filter matches on — clicking
 * a chip sends it straight back as {@code disposition_keys}. Empty key = no outcome.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DispositionCountDTO {
    private String key;
    private String label;
    private String color;
    private String category;
    private boolean settable;
    private long count;
}
