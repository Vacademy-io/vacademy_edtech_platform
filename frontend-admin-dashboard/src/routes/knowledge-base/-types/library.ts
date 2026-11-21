/** The knowledge base library — curated corpora published by Vacademy. */

export type ListingStatus = 'DRAFT' | 'PUBLISHED' | 'UNLISTED';

/** The four facets the catalogue filters on. Everything else lives in tags. */
export interface ListingFacets {
    subject: string | null;
    level: string | null;
    board: string | null;
    language: string | null;
}

export interface LibraryListing extends ListingFacets {
    id: string;
    knowledge_base_id: string;
    title: string;
    summary: string;
    description: string | null;
    cover_file_id: string | null;
    cover_alt: string | null;
    tags: string[];
    status: ListingStatus;
    sort_weight: number;
    published_at: string | null;
    published_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** How much material is behind it — the honest numbers, not adjectives. */
    sources: number | null;
    pages: number | null;
    /** Whether THIS institute has unlocked it. */
    unlocked: boolean | null;
    /** "SYLLABUS" = an official syllabus document, not a textbook: papers follow its scope, unpaginated. */
    curriculum_kind: 'SYLLABUS' | null;
}

/** A listing plus the price, as the detail page receives it. */
export interface LibraryListingDetail extends LibraryListing {
    unlock_credits: number;
}

/**
 * A row in the publisher's console: every knowledge base in the publishing
 * institute, described or not. Undescribed bases still appear — that is how
 * they get described.
 */
export interface PublisherListingRow extends Partial<Omit<LibraryListing, 'status'>> {
    knowledge_base_id: string;
    kb_name: string;
    kb_status: string;
    owner_type: string;
    /** null when the base has no listing yet — that is how it gets one. */
    status: ListingStatus | null;
}

export interface CatalogueResponse {
    libraries: LibraryListing[];
    unlock_credits: number;
}

export type FacetValues = Record<keyof ListingFacets, string[]>;

export interface CatalogueFilters {
    subject?: string;
    /** Class ("10"). */
    level?: string;
    /** Taxonomy board key ("CBSE", "UP"); the server resolves aliases. */
    board?: string;
    /** Taxonomy exam key ("JEE_MAIN"); overrides board + level on the server. */
    exam?: string;
    language?: string;
    q?: string;
    limit?: number;
}

// ---- Curriculum taxonomy ----------------------------------------------------
//
// What the picker offers — every board, exam, class and subject, loaded or
// not — with the number of published libraries that answer each node. Comes
// from GET /library/taxonomy; see ai_service/app/services/kb/taxonomy.py.

/** A corpus a board or exam is answered from: listing.board, for these classes (null = all). */
export interface TaxonomySource {
    board: string;
    classes: string[] | null;
}

export interface TaxonomySubject {
    name: string;
    libraries: number;
}

export interface TaxonomyClass {
    class: string;
    libraries: number;
    subjects: TaxonomySubject[];
}

export interface TaxonomyBoard {
    key: string;
    name: string;
    full_name: string;
    kind: 'NATIONAL' | 'STATE';
    /** Whether the aliased books are what the board sets, or just the nearest free corpus. */
    alias_kind: 'PRESCRIBES' | 'OVERLAPS';
    /** Boards whose books this one prescribes (CBSE → NCERT). Empty = its own. */
    sources: TaxonomySource[];
    libraries: number;
    classes: TaxonomyClass[];
}

export interface TaxonomyExam {
    key: string;
    name: string;
    full_name: string;
    sources: TaxonomySource[];
    libraries: number;
    /** Subjects or sections; a section without a corpus simply counts 0. */
    subjects: TaxonomySubject[];
}

export interface LibraryTaxonomy {
    mediums: string[];
    boards: TaxonomyBoard[];
    exams: TaxonomyExam[];
}

export interface ListingDraft {
    title: string;
    summary: string;
    description?: string;
    cover_file_id?: string | null;
    cover_alt?: string | null;
    subject?: string;
    level?: string;
    board?: string;
    language?: string;
    tags: string[];
    sort_weight: number;
}

export interface UnlockResult {
    unlocked: boolean;
    credits_charged: number;
    already_owned: boolean;
}
