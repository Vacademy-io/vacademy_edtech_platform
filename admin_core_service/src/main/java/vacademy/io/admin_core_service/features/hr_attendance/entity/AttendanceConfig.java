package vacademy.io.admin_core_service.features.hr_attendance.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_attendance_config")
public class AttendanceConfig {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false, unique = true)
    private String instituteId;

    @Column(name = "mode", nullable = false, length = 20)
    private String mode;

    @Column(name = "timezone", length = 60)
    private String timezone;

    @Column(name = "auto_checkout_enabled")
    private Boolean autoCheckoutEnabled;

    @Column(name = "auto_checkout_time")
    private LocalTime autoCheckoutTime;

    @Column(name = "geo_fence_enabled")
    private Boolean geoFenceEnabled;

    @Column(name = "geo_fence_lat")
    private Double geoFenceLat;

    @Column(name = "geo_fence_lng")
    private Double geoFenceLng;

    @Column(name = "geo_fence_radius_m")
    private Integer geoFenceRadiusM;

    @Column(name = "ip_restriction_enabled")
    private Boolean ipRestrictionEnabled;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "allowed_ips", columnDefinition = "jsonb")
    private List<String> allowedIps;

    @Column(name = "overtime_enabled")
    private Boolean overtimeEnabled;

    @Column(name = "overtime_threshold_min")
    private Integer overtimeThresholdMin;

    @Column(name = "half_day_threshold_min")
    private Integer halfDayThresholdMin;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "weekend_days", columnDefinition = "jsonb")
    private List<String> weekendDays;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", columnDefinition = "jsonb")
    private Map<String, Object> settings;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = java.time.LocalDateTime.now();
    }
}
