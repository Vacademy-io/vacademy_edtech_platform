package vacademy.io.admin_core_service.features.catalogue_folder.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.DeleteResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.MoveRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.NodeRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.NodeResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.TreeResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.entity.CatalogueFolderLibrary;
import vacademy.io.admin_core_service.features.catalogue_folder.entity.CatalogueFolderNode;
import vacademy.io.admin_core_service.features.catalogue_folder.repository.CatalogueFolderLibraryRepository;
import vacademy.io.admin_core_service.features.catalogue_folder.repository.CatalogueFolderNodeRepository;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tree rules of the folder library, run against an in-memory node table:
 * a folder can never move into its own subtree, orders stay dense after a
 * move, deletes take the subtree, and the public tree shows only what a
 * visitor may see (no hidden branches, no inactive or foreign product pages).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CatalogueFolderServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String LIBRARY = "lib-1";

    @Mock private CatalogueFolderLibraryRepository libraryRepository;
    @Mock private CatalogueFolderNodeRepository nodeRepository;
    @Mock private ProductPageRepository productPageRepository;
    @Mock private InstituteAccessValidator accessValidator;
    @Mock private AudienceRepository audienceRepository;
    @Mock private CustomUserDetails user;

    @InjectMocks private CatalogueFolderService service;

    private final Map<String, CatalogueFolderNode> table = new LinkedHashMap<>();
    private final Map<String, ProductPage> pages = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        CatalogueFolderLibrary lib = CatalogueFolderLibrary.builder()
                .id(LIBRARY).instituteId(INSTITUTE).name("Courses").status("ACTIVE").build();
        when(user.getUserId()).thenReturn("u-1");
        when(libraryRepository.findByIdAndInstituteIdAndStatus(LIBRARY, INSTITUTE, "ACTIVE"))
                .thenReturn(Optional.of(lib));
        when(libraryRepository.lockForUpdate(LIBRARY, INSTITUTE, "ACTIVE")).thenReturn(Optional.of(lib));
        when(libraryRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        when(nodeRepository.findByLibraryIdAndInstituteIdOrderByDisplayOrderAsc(LIBRARY, INSTITUTE))
                .thenAnswer(i -> {
                    List<CatalogueFolderNode> out = new ArrayList<>(table.values());
                    out.sort(Comparator.comparingInt(CatalogueFolderNode::getDisplayOrder));
                    return out;
                });
        when(nodeRepository.findLibraryIdOf(anyString(), anyString()))
                .thenAnswer(i -> Optional.ofNullable(table.get((String) i.getArgument(0)))
                        .filter(n -> n.getInstituteId().equals(i.getArgument(1)))
                        .map(CatalogueFolderNode::getLibraryId));
        when(nodeRepository.save(any())).thenAnswer(i -> {
            CatalogueFolderNode n = i.getArgument(0);
            if (n.getId() == null) n.setId(UUID.randomUUID().toString());
            table.put(n.getId(), n);
            return n;
        });
        when(nodeRepository.saveAll(any())).thenAnswer(i -> {
            for (CatalogueFolderNode n : (Iterable<CatalogueFolderNode>) i.getArgument(0)) table.put(n.getId(), n);
            return i.getArgument(0);
        });
        org.mockito.Mockito.doAnswer(i -> {
            for (Object id : (Collection<?>) i.getArgument(0)) table.remove(id);
            return null;
        }).when(nodeRepository).deleteAllById(any());

        when(productPageRepository.findAllById(any())).thenAnswer(i -> {
            List<ProductPage> out = new ArrayList<>();
            for (Object id : (Iterable<?>) i.getArgument(0)) {
                if (pages.containsKey(id)) out.add(pages.get(id));
            }
            return out;
        });
        when(productPageRepository.findById(anyString()))
                .thenAnswer(i -> Optional.ofNullable(pages.get((String) i.getArgument(0))));
    }

    private CatalogueFolderNode node(String id, String parent, String type, int order) {
        CatalogueFolderNode n = CatalogueFolderNode.builder()
                .id(id).libraryId(LIBRARY).instituteId(INSTITUTE).parentId(parent)
                .nodeType(type).title(id).displayOrder(order).status("ACTIVE").build();
        table.put(id, n);
        return n;
    }

    private ProductPage page(String id, String institute, String status) {
        ProductPage p = new ProductPage();
        p.setId(id);
        p.setCode("code-" + id);
        p.setName("Page " + id);
        p.setInstituteId(institute);
        p.setStatus(status);
        pages.put(id, p);
        return p;
    }

    private static List<String> ids(List<NodeResponse> nodes) {
        return nodes.stream().map(NodeResponse::getId).toList();
    }

    @Test
    @DisplayName("a folder cannot be moved into its own subtree")
    void moveIntoOwnDescendantIsRejected() {
        node("class10", null, "FOLDER", 0);
        node("science", "class10", "FOLDER", 0);
        node("physics", "science", "FOLDER", 0);

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.moveNode(user, INSTITUTE, "class10", new MoveRequest("physics", 0)));
        assertTrue(e.getMessage().contains("inside itself"));
        assertEquals("science", table.get("physics").getParentId());
    }

    @Test
    @DisplayName("moving renumbers the destination and the source densely")
    void moveRenumbersBothParents() {
        node("a", null, "FOLDER", 0);
        node("b", null, "FOLDER", 1);
        node("c", null, "FOLDER", 2);
        node("x", "a", "FOLDER", 0);

        TreeResponse tree = service.moveNode(user, INSTITUTE, "c", new MoveRequest("a", 0));

        assertEquals(List.of("a", "b"), ids(tree.getRoots()));
        assertEquals(List.of("c", "x"), ids(tree.getRoots().get(0).getChildren()));
        assertEquals(1, table.get("b").getDisplayOrder());
        assertEquals(0, table.get("c").getDisplayOrder());
        assertEquals(1, table.get("x").getDisplayOrder());
    }

    @Test
    @DisplayName("reordering within one folder keeps every sibling")
    void reorderWithinParent() {
        node("a", null, "FOLDER", 0);
        node("b", null, "FOLDER", 1);
        node("c", null, "FOLDER", 2);

        TreeResponse tree = service.moveNode(user, INSTITUTE, "a", new MoveRequest(null, 2));

        assertEquals(List.of("b", "c", "a"), ids(tree.getRoots()));
    }

    @Test
    @DisplayName("deleting a folder deletes everything under it")
    void deleteRemovesSubtree() {
        node("a", null, "FOLDER", 0);
        node("b", null, "FOLDER", 1);
        node("a1", "a", "FOLDER", 0);
        node("a1x", "a1", "PRODUCT_PAGE", 0).setProductPageId("p1");
        page("p1", INSTITUTE, "ACTIVE");

        DeleteResponse res = service.deleteNode(user, INSTITUTE, "a");

        assertEquals(3, res.getDeleted());
        assertEquals(List.of("b"), ids(res.getTree().getRoots()));
        assertEquals(0, table.get("b").getDisplayOrder());
    }

    @Test
    @DisplayName("the public tree hides hidden branches and pages a visitor cannot buy")
    void publicTreeFiltersWhatVisitorsSee() {
        node("open", null, "FOLDER", 0);
        node("hidden", null, "FOLDER", 1).setStatus("HIDDEN");
        node("underHidden", "hidden", "PRODUCT_PAGE", 0).setProductPageId("live");
        node("live", "open", "PRODUCT_PAGE", 0).setProductPageId("live");
        node("draft", "open", "PRODUCT_PAGE", 1).setProductPageId("draft");
        node("foreign", "open", "PRODUCT_PAGE", 2).setProductPageId("foreign");
        page("live", INSTITUTE, "ACTIVE");
        page("draft", INSTITUTE, "DRAFT");
        page("foreign", "other-institute", "ACTIVE");

        TreeResponse tree = service.publicTree(INSTITUTE, LIBRARY).orElseThrow();

        assertEquals(List.of("open"), ids(tree.getRoots()));
        List<NodeResponse> leaves = tree.getRoots().get(0).getChildren();
        assertEquals(List.of("live"), ids(leaves));
        assertEquals("code-live", leaves.get(0).getProductPageCode());
        // Learners address product pages by code; the id stays admin-only.
        assertEquals(null, leaves.get(0).getProductPageId());
    }

    @Test
    @DisplayName("another institute's product page cannot be linked")
    void foreignProductPageIsRejected() {
        node("a", null, "FOLDER", 0);
        page("foreign", "other-institute", "ACTIVE");
        NodeRequest req = new NodeRequest("a", "PRODUCT_PAGE", null, null, null, "foreign", null, null);

        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req));
        assertEquals(1, table.size());
    }

    @Test
    @DisplayName("nothing can be added inside a product page")
    void cannotNestUnderProductPage() {
        node("leaf", null, "PRODUCT_PAGE", 0).setProductPageId("p1");
        page("p1", INSTITUTE, "ACTIVE");
        NodeRequest req = new NodeRequest("leaf", "FOLDER", "Inner", null, null, null, null, null);

        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req));
    }

    @Test
    @DisplayName("an item whose product page was deleted can still be renamed")
    void renameWithDeletedProductPage() {
        node("a", null, "FOLDER", 0);
        node("leaf", "a", "PRODUCT_PAGE", 0).setProductPageId("gone");
        NodeRequest req = new NodeRequest(null, null, "Old bundle", null, null, "gone", "HIDDEN", null);

        service.updateNode(user, INSTITUTE, "leaf", req);

        assertEquals("Old bundle", table.get("leaf").getTitle());
        assertEquals("HIDDEN", table.get("leaf").getStatus());
    }

    @Test
    @DisplayName("an item of another institute is not found")
    void otherInstituteNodeIsNotFound() {
        node("a", null, "FOLDER", 0);
        NodeRequest req = new NodeRequest(null, null, "Hijacked", null, null, null, null, null);

        assertThrows(VacademyException.class, () -> service.updateNode(user, "inst-2", "a", req));
        assertEquals("a", table.get("a").getTitle());
    }

    @Test
    @DisplayName("image addresses must be web URLs")
    void imageMustBeWebUrl() {
        NodeRequest req = new NodeRequest(null, "FOLDER", "Class 10", null, "javascript:alert(1)", null, null, null);

        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req));
    }

    @Test
    @DisplayName("a new folder is appended after its siblings")
    void createAppends() {
        node("a", null, "FOLDER", 0);
        node("b", null, "FOLDER", 1);
        NodeRequest req = new NodeRequest(null, "FOLDER", "Class 12", "Boards", "https://x.vacademy.io/i.png",
                null, null, Map.of("layout", "list"));

        TreeResponse tree = service.createNode(user, INSTITUTE, LIBRARY, req);

        NodeResponse created = tree.getRoots().get(2);
        assertEquals("Class 12", created.getTitle());
        assertEquals("list", created.getView().get("layout"));
        assertEquals(2, created.getDisplayOrder());
    }

    /* ── knowledge-stream fields ───────────────────────────────────────── */

    private static NodeRequest folder(String title) {
        return new NodeRequest(null, "FOLDER", title, null, null, null, null, null);
    }

    private static NodeRequest edit() {
        return new NodeRequest();
    }

    private NodeResponse onlyRoot(TreeResponse tree, String title) {
        return tree.getRoots().stream().filter(n -> title.equals(n.getTitle())).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("a stream folder saves every knowledge-stream field and the admin tree returns them")
    void streamFieldsRoundTrip() {
        when(audienceRepository.findByIdAndInstituteId("aud-1", INSTITUTE))
                .thenReturn(Optional.of(Audience.builder().id("aud-1").instituteId(INSTITUTE).status("ACTIVE").build()));
        NodeRequest req = folder("शिक्षा");
        req.setSlug("  Shiksha ");
        req.setCourseTag(" education ");
        req.setSubtitle("EDUCATION");
        req.setTagline("Learn the Indian way of learning.");
        req.setCtaLabel("Explore Education");
        req.setLinkUrl("/courses?stream=shiksha");
        req.setAccentColor("#E85D04");
        req.setComingSoon(true);
        req.setAudienceId("aud-1");

        NodeResponse n = onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, req), "शिक्षा");

        assertEquals("shiksha", n.getSlug());
        assertEquals("education", n.getCourseTag());
        assertEquals("EDUCATION", n.getSubtitle());
        assertEquals("Learn the Indian way of learning.", n.getTagline());
        assertEquals("Explore Education", n.getCtaLabel());
        assertEquals("/courses?stream=shiksha", n.getLinkUrl());
        assertEquals("#e85d04", n.getAccentColor());
        assertEquals(Boolean.TRUE, n.getComingSoon());
        assertEquals("aud-1", n.getAudienceId());
    }

    @Test
    @DisplayName("on update null leaves a stream field, an empty string clears it")
    void updateLeavesOrClears() {
        CatalogueFolderNode stream = node("s", null, "FOLDER", 0);
        stream.setSlug("shiksha");
        stream.setSubtitle("EDUCATION");
        stream.setTagline("Old");
        stream.setComingSoon(true);
        NodeRequest req = edit();
        req.setSubtitle("");
        req.setTagline("New headline");
        req.setComingSoon(false);

        service.updateNode(user, INSTITUTE, "s", req);

        CatalogueFolderNode saved = table.get("s");
        assertEquals("shiksha", saved.getSlug());
        assertNull(saved.getSubtitle());
        assertEquals("New headline", saved.getTagline());
        assertFalse(saved.isComingSoon());
    }

    @Test
    @DisplayName("a slug is a lowercase url key")
    void slugFormat() {
        for (String bad : new String[]{"shiksha stream", "शिक्षा", "a/b", "x".repeat(121), "under_score"}) {
            NodeRequest req = folder("A");
            req.setSlug(bad);
            assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req), bad);
        }
        NodeRequest ok = folder("A");
        ok.setSlug("class-10-cbse");
        assertEquals("class-10-cbse", onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, ok), "A").getSlug());
    }

    @Test
    @DisplayName("a slug is unique within the library, but a node may keep its own")
    void slugIsUniquePerLibrary() {
        node("a", null, "FOLDER", 0).setSlug("shiksha");
        node("b", null, "FOLDER", 1);

        NodeRequest clash = folder("C");
        clash.setSlug("SHIKSHA");
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.createNode(user, INSTITUTE, LIBRARY, clash));
        assertTrue(e.getMessage().contains("shiksha"));

        NodeRequest steal = edit();
        steal.setSlug("shiksha");
        assertThrows(VacademyException.class, () -> service.updateNode(user, INSTITUTE, "b", steal));
        assertNull(table.get("b").getSlug());

        NodeRequest keep = edit();
        keep.setSlug("shiksha");
        keep.setTitle("Renamed");
        service.updateNode(user, INSTITUTE, "a", keep);
        assertEquals("Renamed", table.get("a").getTitle());
        assertEquals("shiksha", table.get("a").getSlug());
    }

    @Test
    @DisplayName("links are site routes or web addresses, never script or off-site tricks")
    void linkUrlRules() {
        for (String good : new String[]{"/courses?stream=shiksha", "/courses?stream={stream}", "https://vacademy.io/x",
                "HTTP://example.com", "https://example.com?q=a b"}) {
            NodeRequest req = folder("Good " + good);
            req.setLinkUrl(good);
            assertEquals(good, onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, req), "Good " + good)
                    .getLinkUrl());
        }
        for (String bad : new String[]{"javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x",
                "//evil.com", "/\\evil.com", "/\t/evil.com", "https://", "https:///x", "ftp://example.com",
                "courses", "https://exa mple.com", "mailto:a@b.c"}) {
            NodeRequest req = folder("Bad");
            req.setLinkUrl(bad);
            assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req), bad);
        }
    }

    @Test
    @DisplayName("accent colours are #rgb, #rrggbb or #rrggbbaa")
    void accentColorRules() {
        for (String good : new String[]{"#abc", "#A1B2C3", "#a1b2c3d4"}) {
            NodeRequest req = folder("Good " + good);
            req.setAccentColor(good);
            assertEquals(good.toLowerCase(), onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, req),
                    "Good " + good).getAccentColor());
        }
        for (String bad : new String[]{"red", "#abcd", "#ggg", "abc", "#1234567", "rgb(0,0,0)"}) {
            NodeRequest req = folder("Bad");
            req.setAccentColor(bad);
            assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, req), bad);
        }
    }

    @Test
    @DisplayName("text fields are length-capped and a course tag is a single tag")
    void lengthCapsAndCourseTag() {
        NodeRequest longSubtitle = folder("A");
        longSubtitle.setSubtitle("x".repeat(256));
        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, longSubtitle));

        NodeRequest longCta = folder("A");
        longCta.setCtaLabel("x".repeat(121));
        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, longCta));

        NodeRequest longTag = folder("A");
        longTag.setCourseTag("x".repeat(192));
        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, longTag));

        NodeRequest twoTags = folder("A");
        twoTags.setCourseTag("hindi,english");
        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, twoTags));

        NodeRequest atCap = folder("A");
        atCap.setTagline("x".repeat(255));
        assertEquals(255, onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, atCap), "A").getTagline().length());
    }

    @Test
    @DisplayName("a notify-me audience must be one of the institute's, checked only when it changes")
    void audienceIsValidatedOnChange() {
        when(audienceRepository.findByIdAndInstituteId(anyString(), anyString())).thenReturn(Optional.empty());
        NodeRequest foreign = folder("A");
        foreign.setAudienceId("someone-elses");
        assertThrows(VacademyException.class, () -> service.createNode(user, INSTITUTE, LIBRARY, foreign));

        // The stored audience was deleted since: re-sending it must not block a rename.
        node("s", null, "FOLDER", 0).setAudienceId("deleted-audience");
        NodeRequest rename = edit();
        rename.setTitle("Renamed");
        rename.setAudienceId("deleted-audience");
        service.updateNode(user, INSTITUTE, "s", rename);
        assertEquals("Renamed", table.get("s").getTitle());
        verify(audienceRepository, never()).findByIdAndInstituteId(eq("deleted-audience"), anyString());

        NodeRequest clear = edit();
        clear.setAudienceId("");
        service.updateNode(user, INSTITUTE, "s", clear);
        assertNull(table.get("s").getAudienceId());
    }

    @Test
    @DisplayName("a newly chosen notify-me audience must be an ACTIVE campaign; the stored one is never re-checked")
    void audienceMustBeActiveWhenChosen() {
        for (String status : new String[]{"PAUSED", "COMPLETED", "ARCHIVED", "DELETED", "active", null}) {
            String id = "aud-" + status;
            when(audienceRepository.findByIdAndInstituteId(id, INSTITUTE)).thenReturn(Optional.of(
                    Audience.builder().id(id).instituteId(INSTITUTE).status(status).build()));
            NodeRequest req = folder("Coming soon " + status);
            req.setAudienceId(id);
            VacademyException e = assertThrows(VacademyException.class,
                    () -> service.createNode(user, INSTITUTE, LIBRARY, req), String.valueOf(status));
            assertTrue(e.getMessage().startsWith("Audience campaign is not active"), e.getMessage());
        }

        when(audienceRepository.findByIdAndInstituteId("aud-live", INSTITUTE)).thenReturn(Optional.of(
                Audience.builder().id("aud-live").instituteId(INSTITUTE).status("ACTIVE").build()));
        NodeRequest live = folder("Live");
        live.setAudienceId(" aud-live ");
        assertEquals("aud-live", onlyRoot(service.createNode(user, INSTITUTE, LIBRARY, live), "Live").getAudienceId());

        // Paused since it was chosen: re-sending it with an unrelated edit still saves.
        node("s", null, "FOLDER", 0).setAudienceId("aud-PAUSED");
        NodeRequest rename = edit();
        rename.setTitle("Renamed");
        rename.setAudienceId("aud-PAUSED");
        service.updateNode(user, INSTITUTE, "s", rename);
        assertEquals("Renamed", table.get("s").getTitle());
        assertEquals("aud-PAUSED", table.get("s").getAudienceId());
    }

    @Test
    @DisplayName("the public tree carries the stream fields, keeps an empty coming-soon folder, and flags only when set")
    void publicTreeStreamFields() {
        CatalogueFolderNode stream = node("s", null, "FOLDER", 0);
        stream.setSlug("shiksha");
        stream.setSubtitle("EDUCATION");
        stream.setAudienceId("aud-1");
        CatalogueFolderNode soon = node("soon", "s", "FOLDER", 0);
        soon.setComingSoon(true);
        node("open", "s", "FOLDER", 1);

        TreeResponse tree = service.publicTree(INSTITUTE, LIBRARY).orElseThrow();

        NodeResponse root = tree.getRoots().get(0);
        assertEquals("shiksha", root.getSlug());
        assertEquals("EDUCATION", root.getSubtitle());
        assertEquals("aud-1", root.getAudienceId());
        assertNull(root.getComingSoon(), "the public tree omits coming_soon unless it is set");
        assertEquals(List.of("soon", "open"), ids(root.getChildren()));
        assertEquals(Boolean.TRUE, root.getChildren().get(0).getComingSoon());

        // The admin tree always states it.
        TreeResponse admin = service.getTree(user, INSTITUTE, LIBRARY);
        assertEquals(Boolean.FALSE, admin.getRoots().get(0).getComingSoon());
    }

    @Test
    @DisplayName("a library that never sets the stream fields serves the same public JSON as before")
    void untouchedLibraryPayloadIsUnchanged() throws Exception {
        node("a", null, "FOLDER", 0).setDescription("Boards");
        node("leaf", "a", "PRODUCT_PAGE", 0).setProductPageId("p1");
        page("p1", INSTITUTE, "ACTIVE");

        String json = new ObjectMapper().writeValueAsString(service.publicTree(INSTITUTE, LIBRARY).orElseThrow());

        for (String key : new String[]{"slug", "course_tag", "subtitle", "tagline", "cta_label", "link_url",
                "accent_color", "coming_soon", "audience_id"}) {
            assertFalse(json.contains("\"" + key + "\""), key + " must not appear in " + json);
        }
        assertTrue(json.contains("\"product_page_code\":\"code-p1\""));
    }
}
