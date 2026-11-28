-- Folder libraries for catalogue (page-builder) sites.
--
-- A library is an admin-curated tree that learners browse like a file manager:
-- folders (title, description, image) nested to any depth, with product pages
-- as the leaves. Opening a folder that holds a product page shows that page's
-- courses, with add-to-cart and checkout exactly as the product page itself.
--
-- WHY TABLES, NOT A TREE INSIDE catalogue_json: one library is shared by every
-- `folderBrowser` section that points at it, across all of the institute's
-- sites, so "add a Class 11 folder" is one edit rather than one per page.
-- Edits are live (like product pages); a node can be HIDDEN to stage it.
--
-- WHY ONE ROW PER NODE, NOT ONE JSON BLOB PER LIBRARY: each edit in the admin
-- manager (rename, move, add) is a single small write, so two admins working
-- on different folders never overwrite each other's changes.
CREATE TABLE IF NOT EXISTS catalogue_folder_library (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- ACTIVE | DELETED. Deleting is soft, so a section still pointing at the
    -- library degrades to an empty state instead of erroring.
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_by VARCHAR(36),
    updated_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cfl_institute_status
    ON catalogue_folder_library (institute_id, status);

CREATE TABLE IF NOT EXISTS catalogue_folder_node (
    id VARCHAR(36) PRIMARY KEY,
    library_id VARCHAR(36) NOT NULL,
    -- Denormalised from the library so every lookup is tenant-scoped on its own.
    institute_id VARCHAR(36) NOT NULL,
    -- NULL = top level of the library.
    parent_id VARCHAR(36),
    -- FOLDER | PRODUCT_PAGE. Only folders have children.
    node_type VARCHAR(32) NOT NULL,
    -- Optional on PRODUCT_PAGE nodes, which fall back to the product page name.
    title VARCHAR(255),
    description TEXT,
    image_url TEXT,
    -- PRODUCT_PAGE nodes only. The id, not the code, so renaming a product
    -- page's code never breaks the link; the code is resolved at read time.
    product_page_id VARCHAR(255),
    display_order INTEGER NOT NULL DEFAULT 0,
    -- ACTIVE | HIDDEN. A hidden folder hides its whole subtree from learners.
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    -- JSON object: how THIS folder displays its children (layout, image
    -- shape, columns...), overriding the section's defaults. NULL = inherit.
    view_json TEXT,
    created_by VARCHAR(36),
    updated_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The tree read: every node of one library, in sibling order.
CREATE INDEX IF NOT EXISTS idx_cfn_library_parent_order
    ON catalogue_folder_node (library_id, parent_id, display_order);

-- Per-library node counts for the institute's library list.
CREATE INDEX IF NOT EXISTS idx_cfn_institute_library
    ON catalogue_folder_node (institute_id, library_id);
