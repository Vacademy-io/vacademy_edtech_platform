package vacademy.io.admin_core_service.features.hr_attendance.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.time.LocalTime;
import java.util.List;
import java.util.Map;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttendanceConfigDTO {

    private String id;
    private String instituteId;
    private String mode;
    private String timezone;
    private Boolean autoCheckoutEnabled;
    private LocalTime autoCheckoutTime;
    private Boolean geoFenceEnabled;
    private Double geoFenceLat;
    private Double geoFenceLng;
    private Integer geoFenceRadiusM;
    private Boolean ipRestrictionEnabled;
    private List<String> allowedIps;
    private Boolean overtimeEnabled;
    private Integer overtimeThresholdMin;
    private Integer halfDayThresholdMin;
    private List<String> weekendDays;
    private Map<String, Object> settings;
}
