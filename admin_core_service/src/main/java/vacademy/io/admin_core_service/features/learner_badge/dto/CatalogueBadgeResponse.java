package vacademy.io.admin_core_service.features.learner_badge.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Result of a catalogue append: the badge as stored, the full list after the write, and the master toggle. */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class CatalogueBadgeResponse {
    private BadgeDefinition badge;
    private List<BadgeDefinition> badges;
    private boolean enabled;
}
