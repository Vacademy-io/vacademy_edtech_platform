package vacademy.io.admin_core_service.features.discussion;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionPostView;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionRequests;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionSettings;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionThreadView;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionPost;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReactionRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReportRepository;
import vacademy.io.admin_core_service.features.discussion.service.DiscussionService;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The forum's visibility and permission rules, which are what keep a private reflection private. */
class DiscussionServiceTest {

    private static final String SLIDE = "slide-1";
    private static final String INSTITUTE = "inst-1";
    private static final String BATCH = "ps-1";
    private static final String ME = "learner-me";
    private static final String CLASSMATE = "learner-other";
    private static final String TEACHER = "teacher-1";

    private final DiscussionPostRepository posts = mock(DiscussionPostRepository.class);
    private final DiscussionReactionRepository reactions = mock(DiscussionReactionRepository.class);
    private final DiscussionReportRepository reports = mock(DiscussionReportRepository.class);
    private final LearnerQuizAccessService access = mock(LearnerQuizAccessService.class);
    private final InstituteAccessValidator validator = mock(InstituteAccessValidator.class);
    private final DiscussionService service = new DiscussionService(posts, reactions, reports, access, validator);

    private final List<DiscussionPost> stored = new ArrayList<>();
    private long clock = 1_000_000L;

    @BeforeEach
    void setUp() {
        when(access.requireAccess(any(), eq(SLIDE), any(), any(), any()))
                .thenReturn(new LearnerQuizAccessService.Access(INSTITUTE, BATCH, "chapter-1"));
        when(posts.findForBatch(eq(SLIDE), anyString())).thenAnswer(inv -> List.copyOf(stored));
        when(posts.findForInstitute(SLIDE, INSTITUTE)).thenAnswer(inv -> List.copyOf(stored));
        when(posts.findById(anyString())).thenAnswer(inv -> stored.stream()
                .filter(p -> p.getId().equals(inv.getArgument(0))).findFirst());
        when(posts.save(any())).thenAnswer(inv -> {
            DiscussionPost p = inv.getArgument(0);
            if (p.getId() == null) {
                p.setId(UUID.randomUUID().toString());
                p.setCreatedAt(new Timestamp(clock++));
            }
            return p;
        });
        DiscussionPostRepository.BatchRow batch = mock(DiscussionPostRepository.BatchRow.class);
        when(batch.getPackageSessionId()).thenReturn(BATCH);
        when(batch.getPackageName()).thenReturn("Wellbeing 101");
        when(posts.findBatchesOfSlide(SLIDE, INSTITUTE)).thenReturn(List.of(batch));
        when(reactions.findByPostIdIn(any())).thenReturn(List.of());
        when(reactions.findByPostId(any())).thenReturn(List.of());
        when(reports.findByUserIdAndPostIdIn(any(), any())).thenReturn(List.of());
        when(reports.findByPostIdIn(any())).thenReturn(List.of());
        settings("{}");
    }

    private void settings(String settingsJson) {
        DiscussionPostRepository.SlideDocumentRow row = mock(DiscussionPostRepository.SlideDocumentRow.class);
        when(row.getSlideId()).thenReturn(SLIDE);
        when(row.getSlideStatus()).thenReturn("PUBLISHED");
        when(row.getSourceType()).thenReturn("DOCUMENT");
        when(row.getDocumentType()).thenReturn("DISCUSSION");
        when(row.getPublishedData()).thenReturn("{\"prompt_html\":\"<p>Q</p>\",\"settings\":" + settingsJson + "}");
        when(posts.findSlideDocument(SLIDE)).thenReturn(Optional.of(row));
    }

    private DiscussionPost post(String userId, String role, String status, String parentId) {
        DiscussionPost p = new DiscussionPost();
        p.setId(UUID.randomUUID().toString());
        p.setSlideId(SLIDE);
        p.setInstituteId(INSTITUTE);
        p.setPackageSessionId(BATCH);
        p.setParentId(parentId);
        p.setUserId(userId);
        p.setAuthorName(userId + "-name");
        p.setAuthorRole(role);
        p.setStatus(status);
        p.setContent("text by " + userId);
        p.setCreatedAt(new Timestamp(clock++));
        stored.add(p);
        return p;
    }

    private static CustomUserDetails user(String id) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        when(u.getFullName()).thenReturn(id + "-name");
        return u;
    }

    private DiscussionThreadView learnerView() {
        return service.learnerThread(user(ME), SLIDE, BATCH, null, INSTITUTE);
    }

    private static List<String> authors(DiscussionThreadView v) {
        return v.getPosts().stream().map(DiscussionPostView::getAuthorUserId).toList();
    }

    @Test
    void open_showsPublishedClassmates_butNotTheirPendingOrHidden_andShowsMyOwnPending() {
        settings("{\"visibility\":\"OPEN\"}");
        post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        post("pending-one", "LEARNER", "PENDING", null);
        post("hidden-one", "LEARNER", "HIDDEN", null);
        DiscussionPost mine = post(ME, "LEARNER", "PENDING", null);

        DiscussionThreadView v = learnerView();

        assertThat(authors(v)).containsExactlyInAnyOrder(CLASSMATE, ME);
        assertThat(v.getPosts()).filteredOn(p -> p.getId().equals(mine.getId()))
                .singleElement().extracting(DiscussionPostView::getStatus).isEqualTo("PENDING");
        assertThat(v.getPosts()).allMatch(p -> p.getReportCount() == null);
    }

    @Test
    void afterReply_hidesClassmatesUntilILPost_butAlwaysShowsTeacher() {
        settings("{\"visibility\":\"AFTER_REPLY\"}");
        post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        post(TEACHER, "STAFF", "PUBLISHED", null);

        DiscussionThreadView before = learnerView();
        assertThat(authors(before)).containsExactly(TEACHER);
        assertThat(before.getViewer().isCanSeeOthers()).isFalse();
        assertThat(before.getStats().getResponses()).isEqualTo(1);

        post(ME, "LEARNER", "PUBLISHED", null);
        DiscussionThreadView after = learnerView();
        assertThat(authors(after)).containsExactlyInAnyOrder(TEACHER, CLASSMATE, ME);
        assertThat(after.getViewer().isCanSeeOthers()).isTrue();
    }

    @Test
    void private_neverShowsClassmates_evenAfterReplying_butShowsTeacherReplyInMyThread() {
        settings("{\"visibility\":\"PRIVATE\"}");
        DiscussionPost theirs = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        post(TEACHER, "STAFF", "PUBLISHED", theirs.getId());
        DiscussionPost mine = post(ME, "LEARNER", "PUBLISHED", null);
        post(TEACHER, "STAFF", "PUBLISHED", mine.getId());
        post(CLASSMATE, "LEARNER", "PUBLISHED", mine.getId());

        DiscussionThreadView v = learnerView();

        assertThat(authors(v)).containsExactly(ME);
        assertThat(v.getPosts().get(0).getComments()).extracting(DiscussionPostView::getAuthorUserId)
                .containsExactly(TEACHER);
        assertThat(v.getViewer().isCanCommentOnOthers()).isFalse();
    }

    @Test
    void anonymous_hidesNameFromClassmates_butNotFromTeachers() {
        settings("{\"visibility\":\"OPEN\",\"allow_anonymous\":true}");
        DiscussionPost anon = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        anon.setAnonymous(true);

        DiscussionPostView seenByLearner = learnerView().getPosts().get(0);
        assertThat(seenByLearner.getAuthorName()).isEqualTo("Anonymous classmate");
        assertThat(seenByLearner.getAuthorUserId()).isNull();

        DiscussionPostView seenByStaff = service.staffThread(user(TEACHER), SLIDE, INSTITUTE, null).getPosts().get(0);
        assertThat(seenByStaff.getAuthorName()).isEqualTo(CLASSMATE + "-name");
        assertThat(seenByStaff.getAuthorUserId()).isEqualTo(CLASSMATE);
        assertThat(seenByStaff.isAnonymous()).isTrue();
    }

    @Test
    void staffSeeEverythingButDeleted_withStats() {
        post(CLASSMATE, "LEARNER", "PENDING", null);
        post("x", "LEARNER", "HIDDEN", null).setReportCount(2);
        post("y", "LEARNER", "DELETED", null);

        DiscussionThreadView v = service.staffThread(user(TEACHER), SLIDE, INSTITUTE, null);

        assertThat(v.getPosts()).hasSize(2);
        assertThat(v.getStats().getPending()).isEqualTo(1);
        assertThat(v.getStats().getHidden()).isEqualTo(1);
        assertThat(v.getStats().getFlagged()).isEqualTo(1);
        assertThat(v.getBatches()).singleElement().extracting(DiscussionThreadView.Batch::getName)
                .isEqualTo("Wellbeing 101");
        verify(validator).requireInstituteStaff(any(), eq(INSTITUTE));
    }

    @Test
    void staffRefusedWhenSlideIsNotInTheirInstitute() {
        when(posts.findBatchesOfSlide(SLIDE, "other-inst")).thenReturn(List.of());
        assertThatThrownBy(() -> service.staffThread(user(TEACHER), SLIDE, "other-inst", null))
                .isInstanceOf(ForbiddenException.class);
    }

    private DiscussionRequests.CreatePost create(String parentId, boolean anonymous) {
        DiscussionRequests.CreatePost req = new DiscussionRequests.CreatePost();
        req.setSlideId(SLIDE);
        req.setPackageSessionId(BATCH);
        req.setParentId(parentId);
        req.setContent("  I feel calmer when I walk.  ");
        req.setAnonymous(anonymous);
        return req;
    }

    @Test
    void create_respectsApproval_andIgnoresAnonymousWhenNotAllowed() {
        settings("{\"require_approval\":true,\"allow_anonymous\":false}");
        DiscussionService.Created created = service.createAsLearner(user(ME), create(null, true), INSTITUTE);

        assertThat(created.post().getStatus()).isEqualTo("PENDING");
        assertThat(created.post().isAnonymous()).isFalse();
        assertThat(created.post().getContent()).isEqualTo("I feel calmer when I walk.");
        assertThat(created.firstResponse()).isTrue();
    }

    @Test
    void replyUnderMyOwnAnonymousResponse_staysAnonymous() {
        settings("{\"visibility\":\"OPEN\",\"allow_anonymous\":true}");
        DiscussionPost mine = post(ME, "LEARNER", "PUBLISHED", null);
        mine.setAnonymous(true);

        DiscussionService.Created reply = service.createAsLearner(user(ME), create(mine.getId(), false), INSTITUTE);

        assertThat(reply.post().isAnonymous()).isTrue();
        assertThat(reply.firstResponse()).isFalse();
    }

    @Test
    void create_refusedWhenLocked() {
        settings("{\"locked\":true}");
        assertThatThrownBy(() -> service.createAsLearner(user(ME), create(null, false), INSTITUTE))
                .isInstanceOf(VacademyException.class).hasMessageContaining("closed");
    }

    @Test
    void comments_offBlocksCommentingOnClassmates_butNotOnMyOwnThread() {
        settings("{\"visibility\":\"OPEN\",\"allow_comments\":false}");
        DiscussionPost theirs = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        DiscussionPost mine = post(ME, "LEARNER", "PUBLISHED", null);

        assertThatThrownBy(() -> service.createAsLearner(user(ME), create(theirs.getId(), false), INSTITUTE))
                .isInstanceOf(ForbiddenException.class);
        assertThat(service.createAsLearner(user(ME), create(mine.getId(), false), INSTITUTE).post().getParentId())
                .isEqualTo(mine.getId());
    }

    @Test
    void cannotCommentOn_reactTo_orReport_aPostIAmNotAllowedToSee() {
        settings("{\"visibility\":\"PRIVATE\"}");
        DiscussionPost theirs = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        when(posts.hasResponded(SLIDE, ME)).thenReturn(true);

        assertThatThrownBy(() -> service.createAsLearner(user(ME), create(theirs.getId(), false), INSTITUTE))
                .isInstanceOf(ForbiddenException.class);
        DiscussionRequests.React react = new DiscussionRequests.React();
        react.setReaction("HEART");
        assertThatThrownBy(() -> service.react(user(ME), theirs.getId(), react, INSTITUTE, null))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.report(user(ME), theirs.getId(), new DiscussionRequests.Report(), INSTITUTE))
                .isInstanceOf(ForbiddenException.class);
        verify(reactions, never()).insertIfAbsent(any(), any(), any(), any());
        verify(reports, never()).insertIfAbsent(any(), any(), any(), any());
    }

    @Test
    void reactionMustBeOneTheTeacherEnabled() {
        settings("{\"visibility\":\"OPEN\",\"reactions\":[\"HEART\"]}");
        DiscussionPost theirs = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        DiscussionRequests.React react = new DiscussionRequests.React();
        react.setReaction("HUG");
        assertThatThrownBy(() -> service.react(user(ME), theirs.getId(), react, INSTITUTE, null))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void cannotEditSomeoneElsesPost_orMineWhenEditingIsOff() {
        settings("{\"visibility\":\"OPEN\",\"allow_edit_own\":false}");
        DiscussionPost theirs = post(CLASSMATE, "LEARNER", "PUBLISHED", null);
        DiscussionPost mine = post(ME, "LEARNER", "PUBLISHED", null);
        DiscussionRequests.EditPost edit = new DiscussionRequests.EditPost();
        edit.setContent("changed");

        assertThatThrownBy(() -> service.editAsLearner(user(ME), theirs.getId(), edit, INSTITUTE))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.editAsLearner(user(ME), mine.getId(), edit, INSTITUTE))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    void settingsParsing_failsClosed() throws Exception {
        java.lang.reflect.Method parse = DiscussionService.class.getDeclaredMethod("parseSettings", String.class);
        parse.setAccessible(true);

        DiscussionSettings broken = (DiscussionSettings) parse.invoke(null, "{not json");
        assertThat(broken.getVisibility()).isEqualTo("PRIVATE");
        assertThat(broken.isLocked()).isTrue();

        DiscussionSettings unknown = (DiscussionSettings) parse.invoke(null,
                "{\"settings\":{\"visibility\":\"EVERYONE_ON_EARTH\",\"reactions\":[\"HEART\",\"THUMBS_DOWN\"]}}");
        assertThat(unknown.getVisibility()).isEqualTo("PRIVATE");
        assertThat(unknown.getReactions()).containsExactly("HEART");

        DiscussionSettings defaults = (DiscussionSettings) parse.invoke(null, "{\"prompt_html\":\"x\"}");
        assertThat(defaults.getVisibility()).isEqualTo("OPEN");
        assertThat(defaults.isLocked()).isFalse();
    }

    @Test
    void blankPostIsRefused() {
        DiscussionRequests.CreatePost req = create(null, false);
        req.setContent(" \n\t ");
        assertThatThrownBy(() -> service.createAsLearner(user(ME), req, INSTITUTE))
                .isInstanceOf(VacademyException.class);
    }
}
