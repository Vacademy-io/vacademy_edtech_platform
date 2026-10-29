package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Who hears about a lead when the engine needs a person: the contacts picked on the engine plus the
 * lead's own counsellor, de-duplicated, with the engine's creator only as a last resort. Contacts
 * must be staff of the institute, because the alert carries a lead's name, number and message.
 */
class EngagementTeamAlertTest {

    private EngagementCoordinationDao coordination;
    private EngagementTeamAlertService alerts;
    private EngagementEngine engine;
    private EngagementMember lead;

    @BeforeEach
    void setUp() {
        coordination = mock(EngagementCoordinationDao.class);
        alerts = new EngagementTeamAlertService(mock(NotificationService.class), mock(AuthService.class),
                coordination, mock(ContactResolver.class));
        engine = new EngagementEngine();
        engine.setInstituteId("inst");
        engine.setCreatedBy("creator");
        lead = new EngagementMember();
        lead.setAudienceResponseId("lead-1");
    }

    @Test
    void chosenContactsAndTheLeadsCounsellorAreBothTold() {
        engine.setNotifyUserIds("[\"a\",\"b\"]");
        when(coordination.leadOwnerUserId("inst", "lead-1")).thenReturn("c");
        assertEquals(List.of("a", "b", "c"), alerts.recipients(engine, lead));
    }

    @Test
    void aContactWhoIsAlsoTheCounsellorIsToldOnce() {
        engine.setNotifyUserIds("[\"a\"]");
        when(coordination.leadOwnerUserId("inst", "lead-1")).thenReturn("a");
        assertEquals(List.of("a"), alerts.recipients(engine, lead));
    }

    @Test
    void theCreatorIsOnlyTheLastResort() {
        when(coordination.leadOwnerUserId("inst", "lead-1")).thenReturn(null);
        assertEquals(List.of("creator"), alerts.recipients(engine, lead));
        engine.setNotifyUserIds("[\"a\"]");
        assertEquals(List.of("a"), alerts.recipients(engine, lead));
    }

    @Test
    void aLearnerMemberWithNoLeadStillReachesTheChosenContacts() {
        engine.setNotifyUserIds("[\"a\"]");
        assertEquals(List.of("a"), alerts.recipients(engine, new EngagementMember()));
    }

    @Test
    void garbledContactsDoNotBreakTheAlert() {
        engine.setNotifyUserIds("not json");
        assertEquals(List.of("creator"), alerts.recipients(engine, new EngagementMember()));
    }

    @Test
    void onlyStaffOfThisInstituteCanBePickedAsContacts() throws Exception {
        AuthService auth = mock(AuthService.class);
        when(auth.getInstituteRoles(eq("inst"), anyList())).thenReturn(Map.of(
                "staff", List.of("ADMIN"), "learner", List.of("STUDENT")));
        EngagementEngineService service = new EngagementEngineService(null, null, null, null, null);
        var f = EngagementEngineService.class.getDeclaredField("authService");
        f.setAccessible(true);
        f.set(service, auth);
        var m = EngagementEngineService.class.getDeclaredMethod("validNotifyUsersJson", List.class, String.class);
        m.setAccessible(true);

        assertEquals("[\"staff\"]", m.invoke(service, List.of("staff"), "inst"));
        var e = assertThrows(java.lang.reflect.InvocationTargetException.class,
                () -> m.invoke(service, List.of("staff", "learner", "stranger"), "inst"));
        assertTrue(e.getCause() instanceof VacademyException);
        assertTrue(e.getCause().getMessage().contains("learner"));
        assertTrue(e.getCause().getMessage().contains("stranger"));
    }
}
