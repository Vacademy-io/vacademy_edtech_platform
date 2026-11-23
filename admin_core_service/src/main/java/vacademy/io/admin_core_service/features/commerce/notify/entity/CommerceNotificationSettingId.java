package vacademy.io.admin_core_service.features.commerce.notify.entity;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

/** The key of {@link CommerceNotificationSetting}: one row per shop and trigger. */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class CommerceNotificationSettingId implements Serializable {
    private String instituteId;
    private String triggerCode;
}
