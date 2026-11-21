package vacademy.io.admin_core_service.features.super_admin.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Totals for whatever the user has filtered to — the strip above the table. */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@NoArgsConstructor
@AllArgsConstructor
public class SuperAdminCallSummaryDTO {
    private long calls;
    private double minutes;
    private double costInr;
    private double billedInr;
    private double marginInr;
    private Double marginPct;
    private long red;
    private long amber;
    private long green;
    private long withRecording;
    private java.util.Map<String, Double> costBreakdown;
    /** The same modelled cost (INR) by vendor: plivo, sarvam (STT + Sarvam TTS), smallest, the LLM's vendor. */
    private java.util.Map<String, Double> costByVendorInr;
    private java.util.Map<String, Long> byTtsModel;
    private Boolean costIsModelled;

    /** TTS speech cache, aggregated over the same filter as the rest of this
     *  summary. Null when NO call in the range measured it — the cache was off
     *  everywhere, which must not read as "it ran and saved nothing". */
    private Long ttsCacheHits;
    private Long ttsCacheMisses;
    private Double ttsCacheHitRate;
    private Long ttsCacheCharsSaved;
    /** Rupees kept off the TTS bill. Excludes engines with no confirmed
     *  per-minute cost (edge is free, smallest has no invoice rate yet). */
    private Double ttsCacheSavedInr;
}
