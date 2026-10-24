package vacademy.io.admin_core_service.features.institute.setting_history;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * One write of one institute setting key (spec §5, §12.3). {@code oldValue}/{@code newValue}
 * are the JSON of {@code setting.<KEY>} inside institutes.setting_json ({key, name, data});
 * NULL = the key was absent. Written only by {@link InstituteSettingWriter}.
 */
@Entity
@Table(name = "institute_setting_history")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InstituteSettingHistory {

    public static final String SOURCE_TENANT = "TENANT";
    public static final String SOURCE_PLATFORM = "PLATFORM";

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "setting_key", nullable = false)
    private String settingKey;

    @Column(name = "old_value", columnDefinition = "TEXT")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "TEXT")
    private String newValue;

    @Column(name = "actor")
    private String actor;

    @Column(name = "source", nullable = false, length = 16)
    private String source;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
