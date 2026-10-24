package vacademy.io.admin_core_service.features.telephony.ivr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.controller.IvrAdminController;
import vacademy.io.admin_core_service.features.telephony.controller.dto.IvrMenuDTO;
import vacademy.io.admin_core_service.features.telephony.controller.dto.IvrNodeDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrMenu;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrNode;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.IvrMenuRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.IvrNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * IVR menus are one institute's: an AI_AGENT step must name an enabled agent of that
 * institute, a save cannot re-home another institute's menu or nodes, and the admin routes
 * check the caller belongs to the menu's institute.
 */
class IvrMenuServiceTenantTest {

    private IvrMenuRepository menus;
    private IvrNodeRepository nodes;
    private AiAgentRepository agents;
    private IvrMenuService service;

    @BeforeEach
    void setUp() {
        menus = mock(IvrMenuRepository.class);
        nodes = mock(IvrNodeRepository.class);
        agents = mock(AiAgentRepository.class);
        service = new IvrMenuService(menus, nodes, mock(IvrPromptWarmer.class), agents);
        when(menus.findById(anyString())).thenReturn(Optional.empty());
        when(nodes.findAllById(any())).thenReturn(List.of());
    }

    private static IvrMenuDTO menu(String agentId) {
        IvrNodeDTO ai = IvrNodeDTO.builder().id("n-1").nodeType("AI_AGENT").label("Sales AI").aiAgentId(agentId).build();
        return IvrMenuDTO.builder().id("m-1").instituteId("inst-1").name("Main").rootNodeId("n-1")
                .nodes(List.of(ai)).build();
    }

    private void agent(String id, String institute, boolean enabled) {
        when(agents.findByIdAndInstituteId(id, institute)).thenReturn(Optional.of(
                AiAgent.builder().id(id).instituteId(institute).name("Riya").enabled(enabled).build()));
    }

    @Test
    void anEnabledAgentOfTheInstituteIsAccepted() {
        agent("a-1", "inst-1", true);
        assertNotNull(service.saveMenu(menu("a-1")));
        verify(nodes).saveAll(anyList());
    }

    @Test
    void anotherInstitutesAgentIsRefused() {
        when(agents.findByIdAndInstituteId("a-9", "inst-1")).thenReturn(Optional.empty());
        VacademyException e = assertThrows(VacademyException.class, () -> service.saveMenu(menu("a-9")));
        assertTrue(e.getMessage().contains("not an agent of this institute"));
        verify(nodes, never()).saveAll(anyList());
    }

    @Test
    void aDisabledAgentIsRefused() {
        agent("a-1", "inst-1", false);
        VacademyException e = assertThrows(VacademyException.class, () -> service.saveMenu(menu("a-1")));
        assertTrue(e.getMessage().contains("turned off"));
    }

    @Test
    void anotherInstitutesMenuIdIsNotReHomed() {
        agent("a-1", "inst-1", true);
        when(menus.findById("m-1")).thenReturn(Optional.of(IvrMenu.builder().id("m-1").instituteId("inst-2").build()));
        assertThrows(VacademyException.class, () -> service.saveMenu(menu("a-1")));
        verify(nodes, never()).deleteByMenuId(anyString());
    }

    @Test
    void nodeIdsOfAnotherMenuAreRefused() {
        agent("a-1", "inst-1", true);
        when(nodes.findAllById(any())).thenReturn(List.of(IvrNode.builder().id("n-1").menuId("m-other").build()));
        assertThrows(VacademyException.class, () -> service.saveMenu(menu("a-1")));
        verify(nodes, never()).deleteByMenuId(anyString());
    }

    @Test
    void adminRoutesCheckTheMenusInstitute() {
        InstituteAccessValidator validator = mock(InstituteAccessValidator.class);
        CustomUserDetails user = mock(CustomUserDetails.class);
        doThrow(new VacademyException("no")).when(validator).requireInstituteStaff(user, "inst-2");
        IvrMenuService svc = mock(IvrMenuService.class);
        when(svc.menuInstitute("m-2")).thenReturn(Optional.of("inst-2"));
        IvrAdminController c = new IvrAdminController(svc, validator);

        assertThrows(VacademyException.class, () -> c.get("m-2", user));
        assertThrows(VacademyException.class, () -> c.delete("m-2", user));
        assertThrows(VacademyException.class, () -> c.list("inst-2", user));
        IvrMenuDTO other = IvrMenuDTO.builder().instituteId("inst-2").name("x").build();
        assertThrows(VacademyException.class, () -> c.save(other, user));
        verify(svc, never()).deleteMenu(anyString());
        verify(svc, never()).saveMenu(any());
        verify(svc, never()).getMenu(anyString());
    }
}
