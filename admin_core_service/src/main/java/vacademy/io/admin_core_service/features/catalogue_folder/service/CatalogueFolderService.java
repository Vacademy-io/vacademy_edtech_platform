package vacademy.io.admin_core_service.features.catalogue_folder.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.DeleteResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.LibraryRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.LibraryResponse;
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

import java.sql.Timestamp;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Folder libraries of an institute's catalogue sites.
 *
 * Two audiences, as with blog posts: the dashboard (staff read every node;
 * only institute ADMINs change anything, since edits are live on the public
 * site with no publish step) and the public site ({@link #publicTree}: ACTIVE nodes whose product pages
 * are ACTIVE, no auth). Every admin mutation answers with the fresh tree so
 * the manager never has to reconcile a partial update.
 */
@Service
public class CatalogueFolderService {

    static final String LIBRARY_ACTIVE = "ACTIVE";
    static final String LIBRARY_DELETED = "DELETED";
    static final String TYPE_FOLDER = "FOLDER";
    static final String TYPE_PRODUCT_PAGE = "PRODUCT_PAGE";
    static final String NODE_ACTIVE = "ACTIVE";
    static final String NODE_HIDDEN = "HIDDEN";
    private static final String PRODUCT_PAGE_ACTIVE = "ACTIVE";
    private static final String PRODUCT_PAGE_DELETED = "DELETED";

    private static final Set<String> NODE_TYPES = Set.of(TYPE_FOLDER, TYPE_PRODUCT_PAGE);
    private static final Set<String> NODE_STATUSES = Set.of(NODE_ACTIVE, NODE_HIDDEN);

    /** Bounds that keep one library a browsable tree, not a dumping ground. */
    private static final int MAX_LIBRARIES = 100;
    private static final int MAX_NODES = 2000;
    /** Levels, counting the top level as 1. */
    private static final int MAX_DEPTH = 10;
    private static final int MAX_NAME_CHARS = 255;
    private static final int MAX_DESCRIPTION_CHARS = 2000;
    private static final int MAX_URL_CHARS = 2048;
    private static final int MAX_VIEW_CHARS = 4000;
    /* Knowledge-stream field limits (V560). */
    private static final int MAX_SLUG_CHARS = 120;
    private static final int MAX_COURSE_TAG_CHARS = 191;
    private static final int MAX_SUBTITLE_CHARS = 255;
    private static final int MAX_TAGLINE_CHARS = 255;
    private static final int MAX_CTA_LABEL_CHARS = 120;
    private static final int MAX_AUDIENCE_ID_CHARS = 255;
    /** The one campaign status lead capture accepts sign-ups for (exact, as AudienceService compares it). */
    private static final String AUDIENCE_ACTIVE = "ACTIVE";
    private static final Pattern SLUG = Pattern.compile("[a-z0-9-]{1," + MAX_SLUG_CHARS + "}");
    private static final Pattern HEX_COLOR =
            Pattern.compile("#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})");

    @Autowired
    private CatalogueFolderLibraryRepository libraryRepository;

    @Autowired
    private CatalogueFolderNodeRepository nodeRepository;

    @Autowired
    private ProductPageRepository productPageRepository;

    @Autowired
    private InstituteAccessValidator accessValidator;

    @Autowired
    private AudienceRepository audienceRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    /* ── libraries ─────────────────────────────────────────────────────── */

    public List<LibraryResponse> listLibraries(CustomUserDetails user, String instituteId) {
        accessValidator.requireInstituteStaff(user, instituteId);
        Map<String, Long> counts = new HashMap<>();
        for (Object[] row : nodeRepository.countNodesByLibrary(instituteId)) {
            counts.put((String) row[0], ((Number) row[1]).longValue());
        }
        List<LibraryResponse> out = new ArrayList<>();
        for (CatalogueFolderLibrary lib : libraryRepository
                .findByInstituteIdAndStatusOrderByUpdatedAtDesc(instituteId, LIBRARY_ACTIVE)) {
            out.add(toLibrary(lib, counts.getOrDefault(lib.getId(), 0L)));
        }
        return out;
    }

    @Transactional
    public LibraryResponse createLibrary(CustomUserDetails user, String instituteId, LibraryRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        if (req == null || blank(req.getName())) {
            throw new VacademyException("Library name is required");
        }
        if (libraryRepository.countByInstituteIdAndStatus(instituteId, LIBRARY_ACTIVE) >= MAX_LIBRARIES) {
            throw new VacademyException("An institute can have at most " + MAX_LIBRARIES + " folder libraries");
        }
        CatalogueFolderLibrary lib = CatalogueFolderLibrary.builder()
                .instituteId(instituteId)
                .name(cap(req.getName().trim(), MAX_NAME_CHARS, "Library name"))
                .description(capOrNull(req.getDescription(), MAX_DESCRIPTION_CHARS, "Description"))
                .status(LIBRARY_ACTIVE)
                .createdBy(user.getUserId())
                .updatedBy(user.getUserId())
                .build();
        return toLibrary(libraryRepository.save(lib), 0);
    }

    @Transactional
    public LibraryResponse updateLibrary(CustomUserDetails user, String instituteId, String libraryId,
                                         LibraryRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        CatalogueFolderLibrary lib = requireLibrary(instituteId, libraryId);
        if (req != null && req.getName() != null) {
            if (blank(req.getName())) throw new VacademyException("Library name cannot be empty");
            lib.setName(cap(req.getName().trim(), MAX_NAME_CHARS, "Library name"));
        }
        if (req != null && req.getDescription() != null) {
            lib.setDescription(capOrNull(req.getDescription(), MAX_DESCRIPTION_CHARS, "Description"));
        }
        lib.setUpdatedBy(user.getUserId());
        return toLibrary(libraryRepository.save(lib), nodeRepository.countByLibraryId(lib.getId()));
    }

    /**
     * Soft delete: a section still pointing at the library then renders its
     * empty state rather than failing, and the rows stay recoverable.
     */
    @Transactional
    public void deleteLibrary(CustomUserDetails user, String instituteId, String libraryId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        CatalogueFolderLibrary lib = lockLibrary(instituteId, libraryId);
        lib.setStatus(LIBRARY_DELETED);
        lib.setUpdatedBy(user.getUserId());
        libraryRepository.save(lib);
    }

    /* ── tree (admin) ──────────────────────────────────────────────────── */

    public TreeResponse getTree(CustomUserDetails user, String instituteId, String libraryId) {
        accessValidator.requireInstituteStaff(user, instituteId);
        return adminTree(requireLibrary(instituteId, libraryId));
    }

    @Transactional
    public TreeResponse createNode(CustomUserDetails user, String instituteId, String libraryId, NodeRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        CatalogueFolderLibrary lib = lockLibrary(instituteId, libraryId);
        if (req == null) throw new VacademyException("Node details are required");

        List<CatalogueFolderNode> nodes = loadNodes(lib);
        if (nodes.size() >= MAX_NODES) {
            throw new VacademyException("A folder library can hold at most " + MAX_NODES + " items");
        }
        Map<String, CatalogueFolderNode> byId = indexById(nodes);

        String type = upper(req.getNodeType());
        if (!NODE_TYPES.contains(type)) {
            throw new VacademyException("node_type must be FOLDER or PRODUCT_PAGE");
        }
        String parentId = blank(req.getParentId()) ? null : req.getParentId().trim();
        if (parentId != null) {
            CatalogueFolderNode parent = byId.get(parentId);
            if (parent == null) throw new VacademyException("Parent folder not found in this library");
            if (!TYPE_FOLDER.equals(parent.getNodeType())) {
                throw new VacademyException("Items can only be added inside a folder");
            }
            if (depthOf(parent, byId) + 1 > MAX_DEPTH) {
                throw new VacademyException("Folders can be nested at most " + MAX_DEPTH + " levels deep");
            }
        }

        CatalogueFolderNode node = CatalogueFolderNode.builder()
                .libraryId(lib.getId())
                .instituteId(instituteId)
                .parentId(parentId)
                .nodeType(type)
                .status(NODE_ACTIVE)
                .createdBy(user.getUserId())
                .updatedBy(user.getUserId())
                .build();
        if (TYPE_FOLDER.equals(type)) {
            if (blank(req.getTitle())) throw new VacademyException("Folder title is required");
            if (!blank(req.getProductPageId())) {
                throw new VacademyException("A folder cannot link a product page; add a product page inside it");
            }
            node.setTitle(cap(req.getTitle().trim(), MAX_NAME_CHARS, "Title"));
        } else {
            node.setProductPageId(requireProductPage(instituteId, req.getProductPageId()).getId());
            node.setTitle(blank(req.getTitle()) ? null : cap(req.getTitle().trim(), MAX_NAME_CHARS, "Title"));
        }
        node.setDescription(capOrNull(req.getDescription(), MAX_DESCRIPTION_CHARS, "Description"));
        node.setImageUrl(imageUrlOrNull(req.getImageUrl()));
        applyStreamFields(node, req, nodes, instituteId);
        if (req.getStatus() != null) node.setStatus(status(req.getStatus()));
        if (req.getView() != null) node.setViewJson(writeView(req.getView()));
        node.setDisplayOrder(nextOrder(nodes, parentId));

        nodeRepository.save(node);
        touch(lib, user);
        return adminTree(lib);
    }

    @Transactional
    public TreeResponse updateNode(CustomUserDetails user, String instituteId, String nodeId, NodeRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        // Locked too: the save writes every column, so an unlocked rename racing
        // a move would write the old parent back and undo the move.
        LockedTree locked = lockTreeOf(instituteId, nodeId);
        CatalogueFolderLibrary lib = locked.lib();
        CatalogueFolderNode node = locked.node();
        if (req == null) return adminTree(lib);

        boolean folder = TYPE_FOLDER.equals(node.getNodeType());
        if (req.getTitle() != null) {
            if (blank(req.getTitle())) {
                if (folder) throw new VacademyException("Folder title cannot be empty");
                node.setTitle(null);
            } else {
                node.setTitle(cap(req.getTitle().trim(), MAX_NAME_CHARS, "Title"));
            }
        }
        if (req.getDescription() != null) {
            node.setDescription(capOrNull(req.getDescription(), MAX_DESCRIPTION_CHARS, "Description"));
        }
        if (req.getImageUrl() != null) node.setImageUrl(imageUrlOrNull(req.getImageUrl()));
        // Only a CHANGED link is validated: re-sending the stored id must not
        // fail just because that product page has since been deleted, or the
        // item could never be renamed or hidden again.
        if (req.getProductPageId() != null && !blank(req.getProductPageId())
                && !req.getProductPageId().trim().equals(node.getProductPageId())) {
            if (folder) {
                throw new VacademyException("A folder cannot link a product page; add a product page inside it");
            }
            node.setProductPageId(requireProductPage(instituteId, req.getProductPageId()).getId());
        }
        applyStreamFields(node, req, locked.nodes(), instituteId);
        if (req.getStatus() != null) node.setStatus(status(req.getStatus()));
        if (req.getView() != null) node.setViewJson(writeView(req.getView()));
        node.setUpdatedBy(user.getUserId());

        nodeRepository.save(node);
        touch(lib, user);
        return adminTree(lib);
    }

    /**
     * Move and/or reorder: places the node at `index` among the destination's
     * children and renumbers both the destination and (if different) the
     * source sibling lists, so display_order stays a dense 0..n-1.
     */
    @Transactional
    public TreeResponse moveNode(CustomUserDetails user, String instituteId, String nodeId, MoveRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        LockedTree locked = lockTreeOf(instituteId, nodeId);
        CatalogueFolderLibrary lib = locked.lib();
        List<CatalogueFolderNode> nodes = locked.nodes();
        CatalogueFolderNode node = locked.node();
        Map<String, CatalogueFolderNode> byId = indexById(nodes);

        String destId = req == null || blank(req.getParentId()) ? null : req.getParentId().trim();
        if (destId != null) {
            CatalogueFolderNode dest = byId.get(destId);
            if (dest == null) throw new VacademyException("Destination folder not found in this library");
            if (!TYPE_FOLDER.equals(dest.getNodeType())) {
                throw new VacademyException("Items can only be moved into a folder");
            }
            // Walk up from the destination: meeting the node itself means the
            // move would put a folder inside its own subtree.
            for (CatalogueFolderNode cur = dest; cur != null; cur = parentOf(cur, byId)) {
                if (cur.getId().equals(node.getId())) {
                    throw new VacademyException("A folder cannot be moved inside itself");
                }
            }
            if (depthOf(dest, byId) + heightOf(node, childrenIndex(nodes)) > MAX_DEPTH) {
                throw new VacademyException("Folders can be nested at most " + MAX_DEPTH + " levels deep");
            }
        }

        String sourceId = node.getParentId();
        List<CatalogueFolderNode> destSiblings = siblings(nodes, destId);
        destSiblings.removeIf(n -> n.getId().equals(nodeId));
        int at = req == null || req.getIndex() == null ? destSiblings.size()
                : Math.max(0, Math.min(req.getIndex(), destSiblings.size()));
        destSiblings.add(at, node);
        node.setParentId(destId);
        node.setUpdatedBy(user.getUserId());

        List<CatalogueFolderNode> changed = new ArrayList<>(renumber(destSiblings));
        if (!sameParent(sourceId, destId)) {
            List<CatalogueFolderNode> sourceSiblings = siblings(nodes, sourceId);
            sourceSiblings.removeIf(n -> n.getId().equals(nodeId));
            changed.addAll(renumber(sourceSiblings));
        }
        if (!changed.contains(node)) changed.add(node);
        nodeRepository.saveAll(changed);
        touch(lib, user);
        return adminTree(lib);
    }

    /** Deletes the node and everything under it. */
    @Transactional
    public DeleteResponse deleteNode(CustomUserDetails user, String instituteId, String nodeId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        LockedTree locked = lockTreeOf(instituteId, nodeId);
        CatalogueFolderLibrary lib = locked.lib();
        List<CatalogueFolderNode> nodes = locked.nodes();
        CatalogueFolderNode node = locked.node();
        Map<String, List<CatalogueFolderNode>> children = childrenIndex(nodes);

        List<String> doomed = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        Deque<String> queue = new ArrayDeque<>();
        queue.add(node.getId());
        while (!queue.isEmpty()) {
            String id = queue.poll();
            if (!seen.add(id)) continue;
            doomed.add(id);
            for (CatalogueFolderNode child : children.getOrDefault(id, List.of())) {
                queue.add(child.getId());
            }
        }
        nodeRepository.deleteAllById(doomed);

        List<CatalogueFolderNode> remaining = siblings(nodes, node.getParentId());
        remaining.removeIf(n -> n.getId().equals(nodeId));
        nodeRepository.saveAll(renumber(remaining));
        touch(lib, user);
        return new DeleteResponse(doomed.size(), adminTree(lib));
    }

    /* ── public ────────────────────────────────────────────────────────── */

    /**
     * What learners see. Hidden nodes drop out with their whole subtree, and a
     * product page leaf only survives while its page is ACTIVE and belongs to
     * this institute. Empty folders are kept; the section decides whether to
     * show them.
     */
    public Optional<TreeResponse> publicTree(String instituteId, String libraryId) {
        if (blank(instituteId) || blank(libraryId)) return Optional.empty();
        return libraryRepository.findByIdAndInstituteIdAndStatus(libraryId, instituteId, LIBRARY_ACTIVE)
                .map(lib -> buildTree(lib, loadNodes(lib), false));
    }

    /* ── tree building ─────────────────────────────────────────────────── */

    private TreeResponse adminTree(CatalogueFolderLibrary lib) {
        return buildTree(lib, loadNodes(lib), true);
    }

    private TreeResponse buildTree(CatalogueFolderLibrary lib, List<CatalogueFolderNode> nodes, boolean admin) {
        Set<String> pageIds = new HashSet<>();
        for (CatalogueFolderNode n : nodes) {
            if (n.getProductPageId() != null) pageIds.add(n.getProductPageId());
        }
        Map<String, ProductPage> pages = new HashMap<>();
        if (!pageIds.isEmpty()) {
            for (ProductPage p : productPageRepository.findAllById(pageIds)) {
                // Another institute's page never resolves, even if its id was stored.
                if (lib.getInstituteId().equals(p.getInstituteId())) pages.put(p.getId(), p);
            }
        }
        Map<String, List<CatalogueFolderNode>> children = childrenIndex(nodes);
        int[] count = {0};
        List<NodeResponse> roots = buildLevel(null, children, pages, admin, new HashSet<>(), 0, count);
        LibraryResponse library = toLibrary(lib, admin ? nodes.size() : count[0]);
        if (!admin) {
            // The library description is an admin note ("only you see this" in
            // the manager); visitors get the name and the tree, nothing else.
            library.setDescription(null);
            library.setCreatedAt(null);
            library.setUpdatedAt(null);
        }
        return TreeResponse.builder()
                .library(library)
                .roots(roots)
                .build();
    }

    private List<NodeResponse> buildLevel(String parentId, Map<String, List<CatalogueFolderNode>> children,
                                          Map<String, ProductPage> pages, boolean admin, Set<String> visited,
                                          int depth, int[] count) {
        List<NodeResponse> out = new ArrayList<>();
        // Depth guard against a corrupt parent cycle; the API itself never creates one.
        if (depth > MAX_DEPTH + 5) return out;
        for (CatalogueFolderNode n : children.getOrDefault(key(parentId), List.of())) {
            if (!visited.add(n.getId())) continue;
            if (!admin && !NODE_ACTIVE.equals(n.getStatus())) continue;

            NodeResponse.NodeResponseBuilder b = NodeResponse.builder()
                    .id(n.getId())
                    .parentId(n.getParentId())
                    .nodeType(n.getNodeType())
                    .title(n.getTitle())
                    .description(n.getDescription())
                    .imageUrl(n.getImageUrl())
                    .displayOrder(n.getDisplayOrder())
                    .status(n.getStatus())
                    .view(readView(n.getViewJson()))
                    .slug(n.getSlug())
                    .courseTag(n.getCourseTag())
                    .subtitle(n.getSubtitle())
                    .tagline(n.getTagline())
                    .ctaLabel(n.getCtaLabel())
                    .linkUrl(n.getLinkUrl())
                    .accentColor(n.getAccentColor())
                    // Visitors only learn of the flag when it is set, so a library
                    // that never uses it keeps serving the payload it did before.
                    .comingSoon(admin ? Boolean.valueOf(n.isComingSoon()) : (n.isComingSoon() ? Boolean.TRUE : null))
                    .audienceId(n.getAudienceId());

            if (TYPE_PRODUCT_PAGE.equals(n.getNodeType())) {
                ProductPage page = pages.get(n.getProductPageId());
                if (!admin && (page == null || !PRODUCT_PAGE_ACTIVE.equals(page.getStatus()))) continue;
                if (page != null) {
                    b.productPageCode(page.getCode()).productPageName(page.getName());
                }
                if (admin) {
                    b.productPageId(n.getProductPageId())
                            .productPageStatus(page == null ? "MISSING" : page.getStatus());
                }
            } else {
                b.children(buildLevel(n.getId(), children, pages, admin, visited, depth + 1, count));
            }
            count[0]++;
            out.add(b.build());
        }
        return out;
    }

    /* ── helpers ───────────────────────────────────────────────────────── */

    private List<CatalogueFolderNode> loadNodes(CatalogueFolderLibrary lib) {
        return nodeRepository.findByLibraryIdAndInstituteIdOrderByDisplayOrderAsc(lib.getId(), lib.getInstituteId());
    }

    private CatalogueFolderLibrary requireLibrary(String instituteId, String libraryId) {
        if (blank(libraryId)) throw new VacademyException("libraryId is required");
        return libraryRepository.findByIdAndInstituteIdAndStatus(libraryId, instituteId, LIBRARY_ACTIVE)
                .orElseThrow(() -> new VacademyException("Folder library not found"));
    }

    /** {@link #requireLibrary} plus the row lock that serialises tree changes. */
    private CatalogueFolderLibrary lockLibrary(String instituteId, String libraryId) {
        if (blank(libraryId)) throw new VacademyException("libraryId is required");
        return libraryRepository.lockForUpdate(libraryId, instituteId, LIBRARY_ACTIVE)
                .orElseThrow(() -> new VacademyException("Folder library not found"));
    }

    /** A node's library, locked, with its whole tree and the node as read under that lock. */
    private record LockedTree(CatalogueFolderLibrary lib, List<CatalogueFolderNode> nodes, CatalogueFolderNode node) {}

    /**
     * Resolves the node's library WITHOUT loading the node (a projection), then
     * locks it and reads the tree. Loading the node first would put a copy in
     * the persistence context from before the lock, and Hibernate keeps that
     * stale copy even when the tree is re-queried afterwards.
     */
    private LockedTree lockTreeOf(String instituteId, String nodeId) {
        if (blank(nodeId)) throw new VacademyException("nodeId is required");
        String libraryId = nodeRepository.findLibraryIdOf(nodeId, instituteId)
                .orElseThrow(() -> new VacademyException("Folder item not found"));
        CatalogueFolderLibrary lib = lockLibrary(instituteId, libraryId);
        List<CatalogueFolderNode> nodes = loadNodes(lib);
        CatalogueFolderNode node = nodes.stream()
                .filter(n -> n.getId().equals(nodeId))
                .findFirst()
                .orElseThrow(() -> new VacademyException("Folder item not found"));
        return new LockedTree(lib, nodes, node);
    }

    /** Linking needs a live page of THIS institute; a DRAFT page may be linked while it is being built. */
    private ProductPage requireProductPage(String instituteId, String productPageId) {
        if (blank(productPageId)) throw new VacademyException("Choose a product page");
        ProductPage page = productPageRepository.findById(productPageId.trim())
                .orElseThrow(() -> new VacademyException("Product page not found"));
        if (!instituteId.equals(page.getInstituteId()) || PRODUCT_PAGE_DELETED.equals(page.getStatus())) {
            throw new VacademyException("Product page not found");
        }
        return page;
    }

    private static Map<String, CatalogueFolderNode> indexById(List<CatalogueFolderNode> nodes) {
        Map<String, CatalogueFolderNode> byId = new HashMap<>();
        for (CatalogueFolderNode n : nodes) byId.put(n.getId(), n);
        return byId;
    }

    /** Children per parent, in display order (nodes arrive sorted). Top level is keyed "". */
    private static Map<String, List<CatalogueFolderNode>> childrenIndex(List<CatalogueFolderNode> nodes) {
        Map<String, List<CatalogueFolderNode>> out = new LinkedHashMap<>();
        for (CatalogueFolderNode n : nodes) {
            out.computeIfAbsent(key(n.getParentId()), k -> new ArrayList<>()).add(n);
        }
        return out;
    }

    private static List<CatalogueFolderNode> siblings(List<CatalogueFolderNode> nodes, String parentId) {
        List<CatalogueFolderNode> out = new ArrayList<>();
        for (CatalogueFolderNode n : nodes) {
            if (sameParent(n.getParentId(), parentId)) out.add(n);
        }
        out.sort(Comparator.comparingInt(n -> n.getDisplayOrder() == null ? 0 : n.getDisplayOrder()));
        return out;
    }

    /** Sets display_order to the list position; returns the rows whose order changed. */
    private static List<CatalogueFolderNode> renumber(List<CatalogueFolderNode> ordered) {
        List<CatalogueFolderNode> changed = new ArrayList<>();
        for (int i = 0; i < ordered.size(); i++) {
            CatalogueFolderNode n = ordered.get(i);
            if (n.getDisplayOrder() == null || n.getDisplayOrder() != i) {
                n.setDisplayOrder(i);
                changed.add(n);
            }
        }
        return changed;
    }

    private static int nextOrder(List<CatalogueFolderNode> nodes, String parentId) {
        int max = -1;
        for (CatalogueFolderNode n : nodes) {
            if (sameParent(n.getParentId(), parentId) && n.getDisplayOrder() != null) {
                max = Math.max(max, n.getDisplayOrder());
            }
        }
        return max + 1;
    }

    private static CatalogueFolderNode parentOf(CatalogueFolderNode n, Map<String, CatalogueFolderNode> byId) {
        return n.getParentId() == null ? null : byId.get(n.getParentId());
    }

    /** Level of a node, the top level being 1. Bounded so a corrupt cycle cannot spin. */
    private static int depthOf(CatalogueFolderNode n, Map<String, CatalogueFolderNode> byId) {
        int depth = 0;
        for (CatalogueFolderNode cur = n; cur != null && depth <= MAX_DEPTH + 5; cur = parentOf(cur, byId)) {
            depth++;
        }
        return depth;
    }

    /** Levels a node's subtree spans, the node itself counting as 1. */
    private static int heightOf(CatalogueFolderNode n, Map<String, List<CatalogueFolderNode>> children) {
        int best = 1;
        Deque<Object[]> stack = new ArrayDeque<>();
        Set<String> seen = new HashSet<>();
        stack.push(new Object[]{n, 1});
        while (!stack.isEmpty()) {
            Object[] top = stack.pop();
            CatalogueFolderNode cur = (CatalogueFolderNode) top[0];
            int level = (Integer) top[1];
            if (!seen.add(cur.getId())) continue;
            best = Math.max(best, level);
            for (CatalogueFolderNode child : children.getOrDefault(cur.getId(), List.of())) {
                stack.push(new Object[]{child, level + 1});
            }
        }
        return best;
    }

    private void touch(CatalogueFolderLibrary lib, CustomUserDetails user) {
        lib.setUpdatedBy(user.getUserId());
        lib.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
        libraryRepository.save(lib);
    }

    private String writeView(Map<String, Object> view) {
        if (view == null || view.isEmpty()) return null;
        try {
            String json = mapper.writeValueAsString(view);
            if (json.length() > MAX_VIEW_CHARS) {
                throw new VacademyException("Display settings are too large");
            }
            return json;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Display settings are not valid");
        }
    }

    private Map<String, Object> readView(String json) {
        if (blank(json)) return null;
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return null;
        }
    }

    /** Images render as <img src> on the public site: web URLs only. */
    private static String imageUrlOrNull(String raw) {
        if (blank(raw)) return null;
        String url = raw.trim();
        String lower = url.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("https://") && !lower.startsWith("http://")) {
            throw new VacademyException("Image must be a web address (https://...)");
        }
        return cap(url, MAX_URL_CHARS, "Image address");
    }

    /**
     * The knowledge-stream fields of a create or update. A null field is left
     * as is (unset on create); an empty string clears it. `libraryNodes` is the
     * whole tree as read under the library lock, for the slug uniqueness check.
     */
    private void applyStreamFields(CatalogueFolderNode node, NodeRequest req,
                                   List<CatalogueFolderNode> libraryNodes, String instituteId) {
        if (req.getSlug() != null) node.setSlug(slugOrNull(req.getSlug(), node, libraryNodes));
        if (req.getCourseTag() != null) node.setCourseTag(courseTagOrNull(req.getCourseTag()));
        if (req.getSubtitle() != null) {
            node.setSubtitle(capOrNull(req.getSubtitle(), MAX_SUBTITLE_CHARS, "Subtitle"));
        }
        if (req.getTagline() != null) node.setTagline(capOrNull(req.getTagline(), MAX_TAGLINE_CHARS, "Tagline"));
        if (req.getCtaLabel() != null) {
            node.setCtaLabel(capOrNull(req.getCtaLabel(), MAX_CTA_LABEL_CHARS, "Button label"));
        }
        if (req.getLinkUrl() != null) node.setLinkUrl(linkUrlOrNull(req.getLinkUrl()));
        if (req.getAccentColor() != null) node.setAccentColor(accentColorOrNull(req.getAccentColor()));
        if (req.getComingSoon() != null) node.setComingSoon(req.getComingSoon());
        if (req.getAudienceId() != null) {
            node.setAudienceId(audienceIdOrNull(req.getAudienceId(), node.getAudienceId(), instituteId));
        }
    }

    /** Lower-cased URL key, unique among the library's other nodes. */
    private static String slugOrNull(String raw, CatalogueFolderNode node, List<CatalogueFolderNode> libraryNodes) {
        if (blank(raw)) return null;
        String slug = raw.trim().toLowerCase(Locale.ROOT);
        if (!SLUG.matcher(slug).matches()) {
            throw new VacademyException("Slug can use only lowercase letters, numbers and hyphens (max "
                    + MAX_SLUG_CHARS + " characters)");
        }
        for (CatalogueFolderNode other : libraryNodes) {
            boolean self = other.getId() != null && other.getId().equals(node.getId());
            if (!self && slug.equals(other.getSlug())) {
                throw new VacademyException("Another item in this library already uses the slug \"" + slug + "\"");
            }
        }
        return slug;
    }

    /** Courses carry their tags comma separated, so a tag holding a comma could never match one. */
    private static String courseTagOrNull(String raw) {
        if (blank(raw)) return null;
        String tag = cap(raw.trim(), MAX_COURSE_TAG_CHARS, "Course tag");
        if (tag.indexOf(',') >= 0) {
            throw new VacademyException("Course tag is a single tag and cannot contain commas");
        }
        return tag;
    }

    /**
     * Folder links render as {@code <a href>} on the public site: a site route
     * ("/courses?stream=shiksha") or an http(s) address, nothing else. Rejects
     * javascript:/data: and every way of leaving the site from a "/" link:
     * "//host", "/\host", and tabs or newlines, which browsers strip from a
     * URL before reading it.
     */
    static String linkUrlOrNull(String raw) {
        if (blank(raw)) return null;
        String url = cap(raw.trim(), MAX_URL_CHARS, "Link");
        for (int i = 0; i < url.length(); i++) {
            char c = url.charAt(i);
            if (c < 0x20 || c == 0x7f) {
                throw new VacademyException("Link contains characters that are not allowed");
            }
        }
        String invalid = "Link must be a page of this site (starting with /) or a web address (https://...)";
        if (url.startsWith("/")) {
            if (url.startsWith("//") || url.startsWith("/\\")) throw new VacademyException(invalid);
            return url;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        String rest = lower.startsWith("https://") ? url.substring(8)
                : lower.startsWith("http://") ? url.substring(7) : null;
        if (rest == null) throw new VacademyException(invalid);
        // The host part must be there and readable: "https://", "https:///x"
        // and "https://exa mple.com" are not addresses a browser can open.
        int end = rest.length();
        for (char stop : new char[]{'/', '?', '#'}) {
            int at = rest.indexOf(stop);
            if (at >= 0) end = Math.min(end, at);
        }
        String host = rest.substring(0, end);
        if (host.isEmpty() || host.indexOf('\\') >= 0 || host.chars().anyMatch(Character::isWhitespace)) {
            throw new VacademyException(invalid);
        }
        return url;
    }

    private static String accentColorOrNull(String raw) {
        if (blank(raw)) return null;
        String color = raw.trim();
        if (!HEX_COLOR.matcher(color).matches()) {
            throw new VacademyException("Accent colour must be a hex colour such as #e85d04");
        }
        return color.toLowerCase(Locale.ROOT);
    }

    /**
     * The audience (lead campaign) that collects "notify me" sign-ups. Only a
     * CHANGED id is checked, as with product pages: re-sending the stored id
     * must not fail because that audience was deleted or paused since.
     *
     * A newly chosen audience must be ACTIVE: lead capture accepts sign-ups
     * only for an ACTIVE campaign (a paused, completed or archived one refuses
     * them, or they land in the default catalogue list), so any other status
     * would quietly lose the folder's sign-ups.
     */
    private String audienceIdOrNull(String raw, String current, String instituteId) {
        if (blank(raw)) return null;
        String id = cap(raw.trim(), MAX_AUDIENCE_ID_CHARS, "Audience");
        if (!id.equals(current)) {
            Audience audience = audienceRepository.findByIdAndInstituteId(id, instituteId)
                    .orElseThrow(() -> new VacademyException("Audience not found"));
            if (!AUDIENCE_ACTIVE.equals(audience.getStatus())) {
                throw new VacademyException("Audience campaign is not active (" + (blank(audience.getStatus())
                        ? "no status" : audience.getStatus().trim()) + "): choose an active campaign to collect "
                        + "notify-me sign-ups");
            }
        }
        return id;
    }

    private static String status(String raw) {
        String s = upper(raw);
        if (!NODE_STATUSES.contains(s)) throw new VacademyException("status must be ACTIVE or HIDDEN");
        return s;
    }

    private static LibraryResponse toLibrary(CatalogueFolderLibrary lib, long nodeCount) {
        return LibraryResponse.builder()
                .id(lib.getId())
                .instituteId(lib.getInstituteId())
                .name(lib.getName())
                .description(lib.getDescription())
                .nodeCount(nodeCount)
                .createdAt(iso(lib.getCreatedAt()))
                .updatedAt(iso(lib.getUpdatedAt()))
                .build();
    }

    private static String cap(String s, int max, String label) {
        if (s.length() > max) throw new VacademyException(label + " is too long (max " + max + " characters)");
        return s;
    }

    private static String capOrNull(String s, int max, String label) {
        return blank(s) ? null : cap(s.trim(), max, label);
    }

    private static String key(String parentId) {
        return parentId == null ? "" : parentId;
    }

    private static boolean sameParent(String a, String b) {
        return key(a).equals(key(b));
    }

    private static String upper(String s) {
        return s == null ? "" : s.trim().toUpperCase(Locale.ROOT);
    }

    private static String iso(Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
