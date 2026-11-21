package vacademy.io.admin_core_service.features.super_admin.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.time.Instant;

public final class ExternalApiLogDTOs {

    private ExternalApiLogDTOs() {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LogRow(String id, Instant occurredAt, String vendor, String operation, String status, String error,
            String instituteId, String instituteName, BigDecimal amount, String currency, BigDecimal durationMs,
            Boolean creditsBilled, Integer httpStatus) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LogDetail(String payload, String response) {
    }
}
