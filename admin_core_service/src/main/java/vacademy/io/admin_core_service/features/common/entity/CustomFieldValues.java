package vacademy.io.admin_core_service.features.common.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.common.listener.CustomFieldValueSyncListener;
import vacademy.io.common.common.dto.CustomFieldValueDTO;

import java.sql.Timestamp;

@Entity
@EntityListeners(CustomFieldValueSyncListener.class)
@Table(name = "custom_field_values")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomFieldValues {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "custom_field_id", nullable = false)
    private String customFieldId;

    @Column(name = "source_type", nullable = false)
    private String sourceType;

    @Column(name = "source_id", nullable = false)
    private String sourceId;

    private String type;

    @Column(name = "type_id")
    private String typeId;

    @Column(columnDefinition = "TEXT")
    private String value;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    public CustomFieldValues(CustomFieldValueDTO customFieldValuesDTO) {
        this.customFieldId = customFieldValuesDTO.getCustomFieldId();
        this.sourceType = customFieldValuesDTO.getSourceType();
        this.sourceId = customFieldValuesDTO.getSourceId();
        this.type = customFieldValuesDTO.getType();
        this.typeId = customFieldValuesDTO.getTypeId();
        this.value = customFieldValuesDTO.getValue();
    }
}

