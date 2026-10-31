# Catalogue Blog — posts on any website page, written in the dashboard or over MCP

> **Status:** BUILT 2026-09-21, uncommitted. Backend + learner renderer + admin editor/manager + MCP tools + edge SEO.
> **Touches:** `admin_core_service` (V526, `features/catalogue_blog`), `frontend-learner-dashboard-app` (`blog` section, routes, `functions/_middleware.ts`), `frontend-admin-dashboard` (`blog` block, Manage Pages → Blog), `ai_service` (`blog` / `blog_edit` MCP tools, schema catalog).

## 1. What it is

A **Blog** block for the page builder. An admin drops it on a page (ideally a dedicated `/blog` page); it lists the institute's published posts and, at `/<site>/<page>/<slug>`, renders one article with its own title, description, Open Graph and `BlogPosting` JSON-LD. Posts are written in **Manage Pages → Blog** — a visual editor (TipTap) and an **HTML** view (Monaco) edit the same body, so an article can be typed, pasted from an AI or a document export, or written by an AI app connected over **MCP**.

## 2. Why posts are rows, not pages in `catalogue_json`

| Concern | Pages in the site JSON | Rows (`catalogue_blog_post`) — chosen |
| :--- | :--- | :--- |
| Publishing an article | Republish the whole site (draft → publish checks → publish) | Press **Publish** on the post; the site is untouched |
| MCP | `website_edit` writes site drafts; an article would sit in a site draft until someone publishes the site | `blog_edit` writes DRAFT posts; the admin publishes the post |
| Size | `catalogue_json` already reaches MB on imported HTML sites; 100 articles of HTML would bloat every load | Bodies live in their own table; list endpoints never return bodies |
| Multiple sites | Copy posts per site | One library per institute; every site's Blog block reads it (optionally pinned to a category) |
| Paging / filtering / counting | Parse every site | SQL |

## 3. Data & API (`admin_core_service`)

`V526__Catalogue_blog_posts.sql` → `catalogue_blog_post` (institute-scoped, `UNIQUE (institute_id, slug)`; `status` DRAFT / PUBLISHED / ARCHIVED; `published_at` doubles as the schedule — a PUBLISHED post with a future time is not public yet; `source` EDITOR / MCP / AI; `reading_minutes` computed on save; `updated_at` Hibernate-managed).

| | Endpoint | Notes |
| :--- | :--- | :--- |
| Admin (JWT, `InstituteAccessValidator`) | `GET /admin-core-service/v1/catalogue-blog/posts?instituteId&status&category&q&page&size` | Summaries + `categories`; no bodies |
| | `GET …/post?instituteId&postId` · `POST …/post?instituteId` · `PUT …/post?instituteId&postId` | `PUT` is partial: null = leave as is |
| | `POST …/post/publish` · `/unpublish` · `/archive` · `DELETE …/post` | Publish stamps `published_at` on first publish only |
| Public (no auth, cached 300s) | `GET /admin-core-service/public/catalogue-blog/v1/posts?instituteId&category&page&size` | PUBLISHED and past `published_at` only |
| | `GET …/post?instituteId&slug` | 404 for drafts / scheduled / unknown |

Slugs: ASCII-folded, lowercase, dashes, ≤120 chars, unique per institute by `-2`, `-3` suffix. Body cap 400k chars. Bodies are stored as authored and **sanitised where rendered** (same model as `htmlBlock`).

## 4. Learner site

- `JsonRenderer` case `"blog"` → `BlogComponent` (`-components/components/BlogComponent.tsx`). One section, two faces decided from the URL: list on the page, article when a slug follows the page route (`RouteMatcher.segmentsAfterBase`), or `?post=<slug>` for a blog on the home page (where a trailing segment would collide with page/course routes; the editor warns about this).
- Routes: new `$tagName/$pageSlug_.$postSlug.tsx` for `/<tag>/<page>/<slug>` (the `_` stops it nesting under `$pageSlug.tsx`, which has no `<Outlet/>`; redirects to `/<page>/<slug>` on a root-mounted host). `$pageSlug.tsx` now reads `/<page>/<slug>` on a root-mounted host through `RootMountedSegment pageOnly` before falling back to "second catalogue's tag".
- Body sanitiser `-utils/blog-html.ts`: DOMPurify with an article profile (headings, figure, tables, code, video/audio, `iframe` **only** for YouTube / Vimeo embed hosts), `RETURN_DOM` post-pass (no global hooks — `catalogue-html.ts` shares the DOMPurify instance). Rendered in `.catalogue-rich-text.catalogue-blog-article` (`catalogue-blog.css`, learner-only, not in the byte-synced set).
- SEO (`functions/_middleware.ts`): `resolveCataloguePage` resolves 3-segment (`/<tag>/<page>/<slug>`) and root-mounted 2-segment (`/<page>/<slug>`) post URLs when the page carries an enabled `blog` component; the crawler branch then emits the post's title / description / cover, `og:type=article`, `article:published_time`, `summary_large_image`, and a `BlogPosting` JSON-LD next to the site graph. The sitemap lists every published post under each blog page (with `<lastmod>`), except blogs on the home page.
- i18n: `coursePlayerB.blog.*` (en/hi/ar/fr).

## 5. Admin dashboard

- **Block:** template `blog` (`component-templates.ts`), label/description, palette group *Answers & text*, canvas thumbnail (`ComponentPreviews` `BlogPreview`), property panel `BlogEditor` (heading, subheading, grid/list, columns, posts per page, category pin — read from the posts in use —, show toggles, labels, colours, **Manage posts** link). i18n in `managePagesComponentTemplates` / `managePagesPropertyPanel` / `managePagesComponentPreviews` `blog.*`.
- **Manager:** lives *inside the Website Builder* — a full-screen dialog (`BlogManagerDialog`, state in `-stores/blog-manager-store.ts`) opened from the **Blog** button on the sites list, the newspaper button in the site editor's toolbar, or a Blog section's property panel (*Manage posts*). `BlogPostsList` (status filter, search, publish/unpublish/archive/delete, "AI app" badge for `source=MCP`) and `BlogPostEditor` (`new` creates) render inside it. Deep link: `/manage-pages?blog=list` or `?blog=<postId>` (what the MCP tools return); the old `/manage-pages/blog[/editor/$postId]` URLs redirect there. The sidebar sub-item `blog` ships hidden (`SUB_ITEMS_HIDDEN_BY_DEFAULT`). Editor: title → slug preview, Visual/HTML toggle (HTML view opens by default for bodies TipTap would normalise — iframes, figures, tables, divs — and the switch back warns), cover image, excerpt, category (datalist), tags, author (defaults to the signed-in user), publish date (back-date / schedule), SEO title + description, **Where it appears** (every site/page with a Blog block, from the catalogue JSON) and live links once published.
- Permissions reuse `useCataloguePermissions` (ADMIN/OWNER write, publish, delete).
- `scripts/export-catalogue-schema-catalog.mjs` was broken since the templates moved to `buildComponentTemplates(t)`; fixed to resolve keys from the English catalog and regenerated — the composer / `website(schema)` now knows `blog` (data-bound: never invent posts; put it on a dedicated page).

## 6. MCP (`ai_service`)

`app/services/assistant_tools_blog.py`, registered in `_load_feature_tools`, exposed in `MCP_EXPOSED_TOOLS`, allow-listed in `MCP_ALLOWED_WRITE_TOOLS` as draft-only. Toggles appear in the MCP settings tab automatically (`blog` "Blog: view", `blog_edits` "Blog: draft posts").

| Tool · action | Does |
| :--- | :--- |
| `blog` · `list` | Posts (any status), categories, `shown_on` placements, `editor_url`; never bodies |
| `blog` · `get` (post_id \| slug) | Body (≤60k chars into context), word count, SEO, `public_urls` when published |
| `blog` · `placements` | Site/page/URL pattern for every Blog block; hint when none |
| `blog_edit` · `create` | nh3-cleans the body with the article profile (YouTube/Vimeo iframes kept, others dropped, `https` only), forces `status=DRAFT`, `source=MCP` (`AI` from the in-product Assistant — detected by the absence of a chat `session_id`), author defaults to the connected user, returns `editor_url` + audit |
| `blog_edit` · `update` | DRAFT only; never sets status |
| `blog_edit` · `request_publish` | Readiness audit (title, body length, excerpt, cover, meta description, category) + the dashboard link. **Never publishes** |
| `blog_edit` · `discard` | Deletes a DRAFT (the undo) |

`SERVER_INSTRUCTIONS` gained a Blog paragraph; `MCP_SERVER_GUIDE.md` §1 lists the tools. Tests: `tests/test_blog_tools.py` (sanitiser, draft containment, source marking, placements) + the exposed-set assertion in `tests/test_mcp_adapter.py`.

## 7. Verification done (2026-09-21)

- `admin_core_service`: `mvn -q -o compiler:compile` clean on JDK 21.
- Learner: `vitest` `blog.test.ts` 7/7; `npm run typecheck` adds no errors (pre-existing baseline untouched); `functions/_middleware.ts` type-checks standalone; design-lint clean on new files.
- Admin: `npm run typecheck` 0 errors; design-lint clean on the new blog UI; route tree regenerated.
- `ai_service`: `pytest tests/test_blog_tools.py tests/test_mcp_adapter.py tests/test_workflow_tools.py` 52 passed.

**Not yet exercised end-to-end against a running stack** (needs the V526 migration applied and a deploy of all four services). First-run checklist: create a post in Manage Pages → Blog, publish, add the Blog block to a `/blog` page, publish the site, open `/<site>/blog` and `/<site>/blog/<slug>`, then `curl -A WhatsApp` the post URL and `/<site>/sitemap.xml`.

## 8. Known limits / next

- No server-side HTML sanitiser in Java (no jsoup in admin-core); safety is at render (learner DOMPurify) and on the MCP path (nh3) — same model as `htmlBlock`.
- Public list has no free-text search; category filter only.
- Posts are institute-wide; there is no per-site library. A site that should show a subset pins a category.
- Blog on the home page works via `?post=` but those articles are not in the sitemap; the editor tells the admin to use a dedicated page.
- Related posts, comments, RSS, author pages: not built.
