package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** What happened to one alert, per recipient, so the dashboard can say what failed. */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AlertResultDTO {
    private List<Delivery> deliveries = new ArrayList<>();

    public void add(String channel, String to, String error) {
        deliveries.add(new Delivery(channel, to, error == null, error));
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Delivery {
        private String channel;
        private String to;
        private boolean sent;
        private String error;
    }
}
