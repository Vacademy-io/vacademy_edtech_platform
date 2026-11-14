import { createFileRoute } from '@tanstack/react-router';
import { CatalogueEditorPage } from '../-components/CatalogueEditorPage';

/**
 * `?page=<route>&section=<id>` opens the editor on a specific page and
 * selects a section. This is the deep link every AI-made change hands back
 * (the copilot, and AI apps connected over MCP): "review it here" only helps
 * if "here" is the block that changed, not the site's first page.
 */
export interface EditorSearch {
    page?: string;
    section?: string;
}

export const Route = createFileRoute('/manage-pages/editor/$tagName')({
    validateSearch: (search: Record<string, unknown>): EditorSearch => ({
        page: typeof search.page === 'string' && search.page ? search.page : undefined,
        section: typeof search.section === 'string' && search.section ? search.section : undefined,
    }),
    component: CatalogueEditorPage,
});
