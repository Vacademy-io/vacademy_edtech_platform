package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.QueryTimeoutException;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.dto.LeadMergeDTOs;
import vacademy.io.admin_core_service.features.audience.repository.LeadMergeDao;
import vacademy.io.admin_core_service.features.audience.service.LeadMergeService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Merging one person's leads into another person: what is refused, what a merge and an undo change. */
class LeadMergeServiceTest {

    private static final String INST = "inst-1";
    private static final String KEEP = "user-keep";
    private static final String DUP = "user-dup";

    private LeadMergeDao dao;
    private InstituteAccessValidator validator;
    private CounsellorScopeService scope;
    private TimelineEventRepository timeline;
    private LeadMergeService service;
    private CustomUserDetails admin;

    @BeforeEach
    void setUp() {
        dao = mock(LeadMergeDao.class);
        validator = mock(InstituteAccessValidator.class);
        scope = mock(CounsellorScopeService.class);
        timeline = mock(TimelineEventRepository.class);
        service = new LeadMergeService(dao, validator, scope, timeline, new ObjectMapper());
        admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        when(admin.getFullName()).thenReturn("Admin One");
        plainPair();
    }

    /** Two plain leads in this institute: nothing stands in the way of a merge. */
    private void plainPair() {
        when(dao.findProfile(INST, KEEP)).thenReturn(Optional.of(profile("p-keep", KEEP, "CONVERTED", null)));
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.of(profile("p-dup", DUP, "CONVERTED", null)));
        when(dao.enquiriesOf(INST, KEEP)).thenReturn(List.of(enquiry("r-keep", KEEP, "Asha Rao")));
        when(dao.enquiriesOf(INST, DUP)).thenReturn(List.of(enquiry("r-dup-1", DUP, "Asha  Rao"),
                enquiry("r-dup-2", DUP, null)));
        when(dao.mergedInto(anyString(), anyString())).thenReturn(List.of());
        when(dao.moveEnquiries(INST, DUP, KEEP)).thenReturn(2);
        when(dao.markMerged(INST, "p-dup", KEEP, "admin-1")).thenReturn(1);
    }

    private static LeadMergeDao.Profile profile(String id, String user, String status, String mergedInto) {
        return new LeadMergeDao.Profile(id, user, status, "HOT", null, new Timestamp(0), mergedInto,
                mergedInto == null ? null : new Timestamp(1000));
    }

    private static LeadMergeDao.Enquiry enquiry(String id, String user, String name) {
        return new LeadMergeDao.Enquiry(id, user, null, "list-1", "Website", name, "+91 98765 43210",
                "asha@example.com", "MANUAL", "NEW", "ACTIVE", new Timestamp(0));
    }

    private LeadMergeDTOs.MergeRequest req() {
        return new LeadMergeDTOs.MergeRequest(KEEP, DUP);
    }

    private void assertRefused(String code) {
        LeadMergeDTOs.Preview preview = service.preview(INST, req(), admin);
        assertFalse(preview.canMerge());
        assertTrue(preview.refusals().stream().anyMatch(r -> r.code().equals(code)),
                () -> "expected " + code + " in " + preview.refusals());
        VacademyException e = assertThrows(VacademyException.class, () -> service.merge(INST, req(), admin));
        assertFalse(e.getMessage().isBlank());
        verify(dao, never()).moveEnquiries(anyString(), anyString(), anyString());
        verify(dao, never()).markMerged(anyString(), anyString(), anyString(), anyString());
        verify(timeline, never()).save(any());
    }

    // ── refusals ─────────────────────────────────────────────────────────

    @Test
    void refusesTheSamePersonTwice() {
        LeadMergeDTOs.MergeRequest same = new LeadMergeDTOs.MergeRequest(KEEP, " " + KEEP + " ");
        LeadMergeDTOs.Preview preview = service.preview(INST, same, admin);
        assertFalse(preview.canMerge());
        assertEquals("SAME_PERSON", preview.refusals().get(0).code());
        assertThrows(VacademyException.class, () -> service.merge(INST, same, admin));
        verify(dao, never()).moveEnquiries(anyString(), anyString(), anyString());
    }

    @Test
    void refusesWhenThePersonToKeepIsNotALeadHere() {
        when(dao.findProfile(INST, KEEP)).thenReturn(Optional.empty());
        assertRefused("KEEP_NOT_IN_INSTITUTE");
    }

    @Test
    void refusesWhenTheDuplicateIsNotALeadHere() {
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.empty());
        assertRefused("DUPLICATE_NOT_IN_INSTITUTE");
    }

    @Test
    void refusesWhenThePersonToKeepWasMergedIntoSomeoneElse() {
        when(dao.findProfile(INST, KEEP)).thenReturn(Optional.of(profile("p-keep", KEEP, "LEAD", "user-other")));
        assertRefused("KEEP_IS_MERGED");
    }

    @Test
    void refusesWhenTheDuplicateWasAlreadyMerged() {
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.of(profile("p-dup", DUP, "LEAD", "user-other")));
        assertRefused("DUPLICATE_ALREADY_MERGED");
    }

    @Test
    void refusesWhenOthersWereMergedIntoTheDuplicate() {
        when(dao.mergedInto(INST, DUP)).thenReturn(List.of(
                new LeadMergeDao.MergedPerson("user-x", "p-x", new Timestamp(0), "admin-1", "X", 1)));
        assertRefused("DUPLICATE_HAS_MERGED_PEOPLE");
    }

    @Test
    void refusesWhenThePersonToKeepOptedOut() {
        when(dao.hasOptedOut(INST, KEEP)).thenReturn(true);
        assertRefused("KEEP_OPTED_OUT");
    }

    @Test
    void refusesWhenTheDuplicateOptedOut() {
        when(dao.hasOptedOut(INST, DUP)).thenReturn(true);
        assertRefused("DUPLICATE_OPTED_OUT");
    }

    @Test
    void refusesWhenTheDuplicateIsEnrolled() {
        when(dao.hasEnrolment(INST, DUP)).thenReturn(true);
        assertRefused("DUPLICATE_ENROLLED");
    }

    @Test
    void refusesWhenTheDuplicateHasAPlan() {
        when(dao.hasPlan(INST, DUP)).thenReturn(true);
        assertRefused("DUPLICATE_HAS_PLAN");
    }

    @Test
    void refusesWhenTheDuplicateHasPayments() {
        when(dao.hasPayment(INST, DUP)).thenReturn(true);
        assertRefused("DUPLICATE_HAS_PAYMENT");
    }

    @Test
    void refusesWhenTheDuplicateIsTheStudentOnSomeoneElsesEnquiry() {
        when(dao.isLinkedOnOtherEnquiry(INST, DUP)).thenReturn(true);
        assertRefused("DUPLICATE_LINKED_ELSEWHERE");
    }

    @Test
    void refusesWhenOneIsTheOthersStudent() {
        when(dao.areLinked(INST, KEEP, DUP)).thenReturn(true);
        assertRefused("PEOPLE_LINKED");
    }

    @Test
    void onlyAdminsMayPreviewMergeOrUndo() {
        doThrow(new ForbiddenException("admin only")).when(validator).requireInstituteAdmin(admin, INST);
        assertThrows(ForbiddenException.class, () -> service.preview(INST, req(), admin));
        assertThrows(ForbiddenException.class, () -> service.merge(INST, req(), admin));
        assertThrows(ForbiddenException.class,
                () -> service.unmerge(INST, new LeadMergeDTOs.UnmergeRequest(DUP), admin));
        verify(dao, never()).findProfile(anyString(), anyString());
        verify(dao, never()).moveEnquiries(anyString(), anyString(), anyString());
        verifyNoInteractions(timeline);
    }

    @Test
    void requiresBothPeople() {
        assertThrows(VacademyException.class,
                () -> service.merge(INST, new LeadMergeDTOs.MergeRequest(KEEP, " "), admin));
        verify(dao, never()).moveEnquiries(anyString(), anyString(), anyString());
    }

    // ── merge ────────────────────────────────────────────────────────────

    @Test
    void previewShowsBothPeopleAndWhatMovesWithoutChangingAnything() {
        LeadMergeDTOs.Preview preview = service.preview(INST, req(), admin);
        assertTrue(preview.canMerge());
        assertTrue(preview.refusals().isEmpty());
        assertEquals(KEEP, preview.keep().userId());
        assertEquals(2, preview.duplicate().enquiries().size());
        assertEquals("Asha  Rao", preview.duplicate().name());
        assertTrue(preview.effects().get(0).startsWith("2 enquiries"));
        verify(dao, never()).moveEnquiries(anyString(), anyString(), anyString());
        verify(dao, never()).lockProfiles(anyString(), anyString(), anyString());
        verifyNoInteractions(timeline);
    }

    @Test
    void mergeMovesTheEnquiriesMarksTheDuplicateAndLogsOnBothPeople() {
        LeadMergeDTOs.MergeResult result = service.merge(INST, req(), admin);

        assertEquals(2, result.enquiriesMoved());
        assertEquals(KEEP, result.keepUserId());
        verify(dao).lockProfiles(INST, KEEP, DUP);
        verify(dao).moveEnquiries(INST, DUP, KEEP);
        verify(dao).markMerged(INST, "p-dup", KEEP, "admin-1");

        ArgumentCaptor<TimelineEvent> events = ArgumentCaptor.forClass(TimelineEvent.class);
        verify(timeline, times(2)).save(events.capture());
        TimelineEvent onKeep = events.getAllValues().get(0);
        TimelineEvent onDup = events.getAllValues().get(1);
        assertEquals("p-keep", onKeep.getTypeId());
        assertEquals(KEEP, onKeep.getStudentUserId());
        assertEquals("p-dup", onDup.getTypeId());
        assertEquals(DUP, onDup.getStudentUserId());
        for (TimelineEvent e : events.getAllValues()) {
            assertEquals(LeadMergeService.EVENT_TYPE, e.getType());
            assertEquals(LeadMergeService.ACTION_MERGED, e.getActionType());
            assertEquals(INST, e.getInstituteId());
            assertEquals(TimelineCategory.JOURNEY, e.getCategory());
            assertEquals("admin-1", e.getActorId());
            assertTrue(e.getMetadataJson().contains("\"merged_user_id\":\"" + DUP + "\""));
            assertTrue(e.getMetadataJson().contains("r-dup-1"));
        }
    }

    @Test
    void mergeStopsWhenTheDuplicateChangedMeanwhile() {
        when(dao.markMerged(INST, "p-dup", KEEP, "admin-1")).thenReturn(0);
        assertThrows(VacademyException.class, () -> service.merge(INST, req(), admin));
        verify(timeline, never()).save(any());
    }

    // ── unmerge ──────────────────────────────────────────────────────────

    @Test
    void unmergeMovesTheEnquiriesBackAndClearsTheMark() {
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.of(profile("p-dup", DUP, "CONVERTED", KEEP)));
        when(dao.moveEnquiriesBack(INST, DUP, KEEP)).thenReturn(2);
        when(dao.clearMerged(INST, "p-dup", KEEP)).thenReturn(1);

        LeadMergeDTOs.UnmergeResult result = service.unmerge(INST, new LeadMergeDTOs.UnmergeRequest(DUP), admin);

        assertEquals(2, result.enquiriesMovedBack());
        assertEquals(KEEP, result.keepUserId());
        verify(dao).lockProfiles(INST, KEEP, DUP);
        verify(dao).moveEnquiriesBack(INST, DUP, KEEP);
        verify(dao).clearMerged(INST, "p-dup", KEEP);
        ArgumentCaptor<TimelineEvent> events = ArgumentCaptor.forClass(TimelineEvent.class);
        verify(timeline, times(2)).save(events.capture());
        assertTrue(events.getAllValues().stream().allMatch(e -> LeadMergeService.ACTION_UNMERGED.equals(e.getActionType())));
        assertEquals(List.of(KEEP, DUP), events.getAllValues().stream().map(TimelineEvent::getStudentUserId).toList());
    }

    @Test
    void unmergeRefusesAPersonWhoIsNotMerged() {
        assertThrows(VacademyException.class,
                () -> service.unmerge(INST, new LeadMergeDTOs.UnmergeRequest(DUP), admin));
        verify(dao, never()).moveEnquiriesBack(anyString(), anyString(), anyString());
    }

    @Test
    void unmergeRefusesAPersonWhoIsNotALeadHere() {
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.empty());
        assertThrows(VacademyException.class,
                () -> service.unmerge(INST, new LeadMergeDTOs.UnmergeRequest(DUP), admin));
        verify(dao, never()).moveEnquiriesBack(anyString(), anyString(), anyString());
    }

    @Test
    void unmergeStopsWhenTheMergeChangedMeanwhile() {
        when(dao.findProfile(INST, DUP)).thenReturn(Optional.of(profile("p-dup", DUP, "LEAD", KEEP)),
                Optional.of(profile("p-dup", DUP, "LEAD", null)));
        assertThrows(VacademyException.class,
                () -> service.unmerge(INST, new LeadMergeDTOs.UnmergeRequest(DUP), admin));
        verify(dao, never()).moveEnquiriesBack(anyString(), anyString(), anyString());
        verify(dao, never()).clearMerged(anyString(), anyString(), anyString());
    }

    // ── state ────────────────────────────────────────────────────────────

    @Test
    void stateListsWhoWasMergedIntoAPerson() {
        when(dao.mergedInto(INST, KEEP)).thenReturn(List.of(
                new LeadMergeDao.MergedPerson(DUP, "p-dup", new Timestamp(5), "admin-1", "Asha Rao", 2)));
        LeadMergeDTOs.MergeState state = service.state(INST, KEEP, admin);
        verify(validator).requireInstituteStaff(admin, INST);
        assertEquals(1, state.mergedPeople().size());
        assertEquals(DUP, state.mergedPeople().get(0).userId());
        assertEquals(null, state.mergedIntoUserId());
    }

    // ── similar names ────────────────────────────────────────────────────

    private static LeadMergeDao.NameMatch match(String user, String counsellor) {
        return new LeadMergeDao.NameMatch("r-" + user, user, "Asha Rao", "+91 98765 43210", "asha@example.com",
                "Website", "NEW", counsellor, new Timestamp(0), true);
    }

    @Test
    void similarNamesMaskContact() {
        when(scope.hasAdminRole(admin, INST)).thenReturn(true);
        when(dao.similarNames(INST, "Asha Rao", 50)).thenReturn(List.of(match("u1", null)));
        LeadMergeDTOs.SimilarNames out = service.similarNames(INST, " Asha Rao ", admin);
        verify(validator).requireInstituteStaff(admin, INST);
        assertEquals(1, out.matches().size());
        assertEquals("******3210", out.matches().get(0).phone());
        assertEquals("a***@example.com", out.matches().get(0).email());
        assertEquals(180, out.days());
    }

    @Test
    void similarNamesShowATeamScopedCallerOnlyTheirTeamsLeads() {
        CustomUserDetails counsellor = mock(CustomUserDetails.class);
        when(counsellor.getUserId()).thenReturn("c-1");
        when(scope.hasAdminRole(counsellor, INST)).thenReturn(false);
        when(scope.isScopedCaller(INST, counsellor)).thenReturn(true);
        when(scope.scopedCounsellorUserIds(INST, "c-1")).thenReturn(List.of("c-2"));
        when(dao.similarNames(INST, "Asha Rao", 50)).thenReturn(List.of(match("u1", "c-1"), match("u2", "c-2"),
                match("u3", "c-9"), match("u4", null)));
        LeadMergeDTOs.SimilarNames out = service.similarNames(INST, "Asha Rao", counsellor);
        assertEquals(List.of("u1", "u2"), out.matches().stream().map(LeadMergeDTOs.NameMatch::userId).toList());
        assertEquals(2, out.notShown());
    }

    @Test
    void similarNamesSkipShortNamesAndGiveUpQuietly() {
        assertTrue(service.similarNames(INST, "A ", admin).matches().isEmpty());
        verify(dao, never()).similarNames(anyString(), anyString(), anyInt());
        when(dao.similarNames(eq(INST), anyString(), anyInt())).thenThrow(new QueryTimeoutException("slow"));
        LeadMergeDTOs.SimilarNames out = service.similarNames(INST, "Asha Rao", admin);
        assertTrue(out.matches().isEmpty());
        assertEquals(0, out.notShown());
    }
}
