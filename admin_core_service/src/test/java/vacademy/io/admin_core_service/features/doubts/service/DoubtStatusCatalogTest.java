package vacademy.io.admin_core_service.features.doubts.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtStatusDto;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto.WorkflowStatusConfig;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DoubtStatusCatalogTest {

    @Test
    @DisplayName("no configured statuses → exactly the two built-ins")
    void defaultsWhenNothingConfigured() {
        List<WorkflowStatusConfig> catalog = DoubtStatusCatalog.resolve(null);
        assertEquals(List.of("PENDING", "RESOLVED"), catalog.stream().map(WorkflowStatusConfig::getKey).toList());
        assertTrue(catalog.stream().allMatch(c -> Boolean.TRUE.equals(c.getIsSystem())));
    }

    @Test
    @DisplayName("built-ins are guaranteed around the configured list; keys are upper-cased; kinds default sensibly")
    void builtInsGuaranteedAndNormalised() {
        DoubtManagementSettingDataDto setting = DoubtManagementSettingDataDto.builder()
                .statuses(List.of(
                        WorkflowStatusConfig.builder().key("in_progress").label("In progress").kind("in_progress").build(),
                        WorkflowStatusConfig.builder().key("escalated").build(),
                        WorkflowStatusConfig.builder().key(null).label("junk").build()))
                .build();
        List<WorkflowStatusConfig> catalog = DoubtStatusCatalog.resolve(setting);
        assertEquals(List.of("PENDING", "IN_PROGRESS", "ESCALATED", "RESOLVED"),
                catalog.stream().map(WorkflowStatusConfig::getKey).toList());
        WorkflowStatusConfig escalated = DoubtStatusCatalog.find(catalog, "escalated").orElseThrow();
        assertEquals("Escalated", escalated.getLabel());
        assertEquals("OPEN", escalated.getKind());
        assertEquals("ACTIVE", DoubtStatusCatalog.coarseStatusFor(escalated));
        assertEquals("RESOLVED", DoubtStatusCatalog.coarseStatusFor(DoubtStatusCatalog.find(catalog, "RESOLVED").orElseThrow()));
    }

    @Test
    @DisplayName("built-in kinds are fixed whatever the stored blob claims")
    void builtInKindsAreForced() {
        List<WorkflowStatusConfig> catalog = DoubtStatusCatalog.resolve(DoubtManagementSettingDataDto.builder()
                .statuses(List.of(
                        WorkflowStatusConfig.builder().key("PENDING").kind("RESOLVED").build(),
                        WorkflowStatusConfig.builder().key("RESOLVED").kind("OPEN").build()))
                .build());
        assertEquals("OPEN", DoubtStatusCatalog.find(catalog, "PENDING").orElseThrow().getKind());
        assertEquals("RESOLVED", DoubtStatusCatalog.find(catalog, "RESOLVED").orElseThrow().getKind());
    }

    @Test
    @DisplayName("effective key: stored workflow key wins, else derived from the coarse status")
    void effectiveKey() {
        assertEquals("IN_PROGRESS", DoubtStatusCatalog.effectiveKey(Doubts.builder().status("ACTIVE").workflowStatus("IN_PROGRESS").build()));
        assertEquals("RESOLVED", DoubtStatusCatalog.effectiveKey(Doubts.builder().status("RESOLVED").build()));
        assertEquals("PENDING", DoubtStatusCatalog.effectiveKey(Doubts.builder().status("ACTIVE").build()));
    }

    @Test
    @DisplayName("learner status uses the learner label and never leaks an unknown internal key")
    void learnerStatusProjection() {
        List<WorkflowStatusConfig> catalog = DoubtStatusCatalog.resolve(DoubtManagementSettingDataDto.builder()
                .statuses(List.of(WorkflowStatusConfig.builder().key("ESCALATED_TO_HOD").label("Escalated to HOD")
                        .learnerLabel("Being looked into").kind("IN_PROGRESS").build()))
                .build());

        DoubtStatusDto escalated = DoubtStatusCatalog.toLearnerStatus(catalog,
                Doubts.builder().status("ACTIVE").workflowStatus("ESCALATED_TO_HOD").build());
        assertEquals("Being looked into", escalated.getLabel());
        assertEquals("IN_PROGRESS", escalated.getKind());

        // A status that was removed from settings after use degrades to the truthful coarse state.
        DoubtStatusDto orphan = DoubtStatusCatalog.toLearnerStatus(catalog,
                Doubts.builder().status("RESOLVED").workflowStatus("GONE").build());
        assertEquals("Resolved", orphan.getLabel());
        assertEquals("RESOLVED", orphan.getKind());
    }
}
