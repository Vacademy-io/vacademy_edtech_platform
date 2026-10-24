import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowDown,
    ArrowLeft,
    ArrowSquareOut,
    ArrowUp,
    Code,
    Plus,
    TextAa,
    Trash,
    Warning,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { TipTapEditor } from '@/components/tiptap/TipTapEditor';
import { MonacoHtmlEditor } from '@/components/ai-video-editor/MonacoHtmlEditor';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { fetchBothInstituteAPIs } from '@/services/student-list-section/getInstituteDetails';
import { ImageUploadField } from '../ImageUploadField';
import { useCataloguePermissions } from '../../-hooks/use-catalogue-permissions';
import { getCatalogueTags } from '../../-services/catalogue-service';
import { getCatalogueSiteUrl } from '../../-utils/learner-site-url';
import {
    BLOG_MAX_RECOMMENDED_COURSES,
    createBlogPost,
    getBlogPost,
    listBlogPosts,
    publishBlogPost,
    slugifyTitle,
    unpublishBlogPost,
    updateBlogPost,
    type BlogPost,
    type BlogPostInput,
    type BlogPostStatus,
    type BlogPostTemplate,
} from '../../-services/blog-service';

/**
 * One blog post: metadata on the right, the body on the left.
 *
 * The body is HTML either way — the visual editor (TipTap) and the HTML view
 * (Monaco) edit the SAME string, so an admin can write in the visual editor,
 * flip to HTML to paste an embed or a page an AI wrote, and flip back. Flipping
 * from HTML to visual re-parses through TipTap, which normalises markup it
 * does not model (custom classes, some inline styles), so the switch warns.
 * The learner renderer sanitises whatever is stored at render time.
 *
 * Save never changes status; Publish / Unpublish are separate, deliberate
 * actions. A post written by an AI app over MCP lands here as a DRAFT.
 */

type Mode = 'visual' | 'html';

interface FormState {
    title: string;
    slug: string;
    slugTouched: boolean;
    excerpt: string;
    contentHtml: string;
    coverImageUrl: string;
    authorName: string;
    category: string;
    tagsText: string;
    publishedAt: string; // datetime-local value
    seoTitle: string;
    seoDescription: string;
    template: BlogPostTemplate;
    /** Course (package) ids, in display order; '' is a row not yet picked. */
    recommendedCourseIds: string[];
}

const toLocalInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromLocalInput = (v: string): string | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const emptyForm = (author: string): FormState => ({
    title: '',
    slug: '',
    slugTouched: false,
    excerpt: '',
    contentHtml: '',
    coverImageUrl: '',
    authorName: author,
    category: '',
    tagsText: '',
    publishedAt: '',
    seoTitle: '',
    seoDescription: '',
    template: 'CLASSIC',
    recommendedCourseIds: [],
});

const formFromPost = (p: BlogPost): FormState => ({
    title: p.title || '',
    slug: p.slug || '',
    slugTouched: true,
    excerpt: p.excerpt || '',
    contentHtml: p.content_html || '',
    coverImageUrl: p.cover_image_url || '',
    authorName: p.author_name || '',
    category: p.category || '',
    tagsText: (p.tags || []).join(', '),
    publishedAt: toLocalInput(p.published_at),
    seoTitle: p.seo_title || '',
    seoDescription: p.seo_description || '',
    template: TEMPLATES.some((t) => t.key === p.template)
        ? (p.template as BlogPostTemplate)
        : 'CLASSIC',
    recommendedCourseIds: (p.recommended_course_ids || []).slice(0, BLOG_MAX_RECOMMENDED_COURSES),
});

const TEMPLATES: Array<{ key: BlogPostTemplate; name: string; hint: string }> = [
    { key: 'CLASSIC', name: 'Classic', hint: 'One centred column. The current look.' },
    {
        key: 'SIDEBAR_TOC',
        name: 'Sidebar contents',
        hint: 'Table of contents fixed on the left, highlights as the reader scrolls. Built from H2/H3 headings.',
    },
    {
        key: 'MAGAZINE',
        name: 'Magazine',
        hint: 'Full-width cover with the title over it, related posts at the end.',
    },
    {
        key: 'FOCUS',
        name: 'Focus',
        hint: 'Narrow reading column, progress bar on top, floating share buttons.',
    },
];

/** Text lines of a schematic page; `w` is a width utility. */
const SchematicLines = ({ widths, className }: { widths: string[]; className?: string }) => (
    <div className={cn('flex flex-col gap-1', className)}>
        {widths.map((w, i) => (
            <span key={i} className={cn('h-1 rounded-full bg-neutral-200', w)} />
        ))}
    </div>
);

/** A tiny drawing of each layout — plain blocks, no images. */
const TemplateThumbnail = ({
    template,
    active,
}: {
    template: BlogPostTemplate;
    active: boolean;
}) => {
    const accent = active ? 'bg-primary-300' : 'bg-neutral-300';
    return (
        <div
            aria-hidden
            className="relative flex h-16 w-full overflow-hidden rounded-md border border-neutral-200 bg-white p-2"
        >
            {template === 'CLASSIC' && (
                <div className="mx-auto flex w-3/5 flex-col gap-1.5">
                    <span className={cn('h-1.5 w-4/5 rounded-full', accent)} />
                    <SchematicLines widths={['w-full', 'w-full', 'w-5/6', 'w-full', 'w-2/3']} />
                </div>
            )}
            {template === 'SIDEBAR_TOC' && (
                <div className="flex w-full gap-2">
                    <div className="flex w-1/4 flex-col gap-1 border-r border-neutral-100 pr-1.5">
                        <span className="h-1 w-full rounded-full bg-neutral-200" />
                        <span className={cn('h-1 w-full rounded-full', accent)} />
                        <span className="h-1 w-3/4 rounded-full bg-neutral-200" />
                        <span className="h-1 w-full rounded-full bg-neutral-200" />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                        <span className={cn('h-1.5 w-1/2 rounded-full', accent)} />
                        <SchematicLines widths={['w-full', 'w-full', 'w-5/6', 'w-full']} />
                    </div>
                </div>
            )}
            {template === 'MAGAZINE' && (
                <div className="flex w-full flex-col gap-1.5">
                    <div className={cn('flex h-6 items-end rounded-sm p-1', accent)}>
                        <span className="h-1.5 w-1/2 rounded-full bg-white" />
                    </div>
                    <SchematicLines widths={['w-full', 'w-4/5']} />
                    <div className="flex gap-1">
                        <span className="h-2 flex-1 rounded-sm bg-neutral-100" />
                        <span className="h-2 flex-1 rounded-sm bg-neutral-100" />
                        <span className="h-2 flex-1 rounded-sm bg-neutral-100" />
                    </div>
                </div>
            )}
            {template === 'FOCUS' && (
                <>
                    <span
                        className={cn(
                            'absolute inset-x-0 top-0 h-0.5 w-2/5',
                            active ? 'bg-primary-500' : 'bg-neutral-400'
                        )}
                    />
                    <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-1">
                        <span className="size-1.5 rounded-full bg-neutral-300" />
                        <span className="size-1.5 rounded-full bg-neutral-300" />
                        <span className="size-1.5 rounded-full bg-neutral-300" />
                    </div>
                    <div className="mx-auto flex w-2/5 flex-col gap-1.5 pt-1">
                        <span className={cn('h-1.5 w-full rounded-full', accent)} />
                        <SchematicLines widths={['w-full', 'w-full', 'w-4/5', 'w-full']} />
                    </div>
                </>
            )}
        </div>
    );
};

const LayoutPicker = ({
    value,
    onChange,
    disabled,
}: {
    value: BlogPostTemplate;
    onChange: (next: BlogPostTemplate) => void;
    disabled?: boolean;
}) => (
    <div role="group" aria-label="Article layout" className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => {
            const active = value === t.key;
            return (
                <button
                    key={t.key}
                    type="button"
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => onChange(t.key)}
                    className={cn(
                        'flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60',
                        active
                            ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                            : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                    )}
                >
                    <TemplateThumbnail template={t.key} active={active} />
                    <span className="min-w-0">
                        <span className="block text-xs font-medium text-neutral-800">{t.name}</span>
                        <span className="block text-caption text-neutral-500">{t.hint}</span>
                    </span>
                </button>
            );
        })}
    </div>
);

interface RecommendedCoursesFieldProps {
    ids: string[];
    onChange: (ids: string[]) => void;
    courses: Array<{ id: string; name: string }>;
    /** Institute details (the course list) not fetched yet. */
    loading: boolean;
    /** Institute details could not be fetched. */
    failed: boolean;
    disabled?: boolean;
}

/**
 * Courses shown as cards after the article. Same picking rules as the Course
 * Showcase "Hand-picked" editor: chosen by name from the institute's courses,
 * a course picked on another row is not offered again. The admin never sees a
 * raw id — an id no longer among the institute's courses is labelled as
 * removed so it can be taken out.
 */
const RecommendedCoursesField = ({
    ids,
    onChange,
    courses,
    loading,
    failed,
    disabled,
}: RecommendedCoursesFieldProps) => {
    const courseLower = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const coursesLower = coursesTerm.toLocaleLowerCase();
    const unavailableLabel = `Removed or unavailable ${courseLower}`;
    const knownIds = useMemo(() => new Set(courses.map((c) => c.id)), [courses]);
    const atMax = ids.length >= BLOG_MAX_RECOMMENDED_COURSES;

    const setAt = (i: number, next: string) => {
        if (ids[i] === next) return;
        const out = [...ids];
        out[i] = next;
        onChange(out);
    };
    const move = (i: number, delta: -1 | 1) => {
        const j = i + delta;
        if (j < 0 || j >= ids.length) return;
        const out = [...ids];
        [out[i], out[j]] = [out[j]!, out[i]!];
        onChange(out);
    };
    const remove = (i: number) => onChange(ids.filter((_, j) => j !== i));

    return (
        <div className="space-y-2">
            <p className="text-xs text-neutral-500">
                Shown as cards after the article. Clicking one opens that {courseLower}&apos;s page.
            </p>

            {failed ? (
                <p className="rounded-md bg-danger-50 px-2 py-1.5 text-caption text-danger-600">
                    Couldn&apos;t load your {coursesLower}. Close and reopen the editor to try
                    again.
                </p>
            ) : loading ? (
                <div className="space-y-2" aria-busy="true">
                    {(ids.length ? ids : ['']).map((_, i) => (
                        <div key={i} className="h-9 animate-pulse rounded-md bg-neutral-100" />
                    ))}
                    <p className="text-caption text-neutral-400">Loading {coursesLower}…</p>
                </div>
            ) : (
                <>
                    {ids.length === 0 && (
                        <p className="rounded-md border border-dashed border-neutral-200 px-3 py-2 text-caption text-neutral-500">
                            No {coursesLower} picked. The article ends without recommendations.
                        </p>
                    )}
                    {ids.map((id, i) => {
                        const taken = new Set(ids.filter((x, j) => j !== i && x));
                        const options: SearchableSelectOption[] = courses
                            .filter((c) => !taken.has(c.id))
                            .map((c) => ({ label: c.name, value: c.id }));
                        const unavailable = !!id && !knownIds.has(id);
                        if (unavailable) options.unshift({ label: unavailableLabel, value: id });
                        return (
                            <div key={i} className="space-y-1">
                                <div className="flex items-center gap-1">
                                    <div className="min-w-0 flex-1">
                                        <SearchableSelect
                                            options={options}
                                            value={id}
                                            onChange={(v) => setAt(i, v)}
                                            placeholder={`Choose a ${courseLower}`}
                                            searchPlaceholder={`Search ${coursesLower}…`}
                                            emptyText={`No ${coursesLower} found`}
                                            disabled={disabled}
                                            portal={false}
                                            triggerClassName={cn(
                                                unavailable && 'border-warning-300 text-warning-700'
                                            )}
                                        />
                                    </div>
                                    <MyButton
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={`Move ${courseLower} ${i + 1} up`}
                                        disable={disabled || i === 0}
                                        onClick={() => move(i, -1)}
                                    >
                                        <ArrowUp className="size-4" />
                                    </MyButton>
                                    <MyButton
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={`Move ${courseLower} ${i + 1} down`}
                                        disable={disabled || i === ids.length - 1}
                                        onClick={() => move(i, 1)}
                                    >
                                        <ArrowDown className="size-4" />
                                    </MyButton>
                                    <MyButton
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={`Remove ${courseLower} ${i + 1}`}
                                        disable={disabled}
                                        onClick={() => remove(i)}
                                        className="text-neutral-500 hover:text-danger-600"
                                    >
                                        <Trash className="size-4" />
                                    </MyButton>
                                </div>
                                {unavailable && (
                                    <p className="flex items-center gap-1 text-caption text-warning-700">
                                        <Warning className="size-3.5 shrink-0" />
                                        This {courseLower} was removed or isn&apos;t available any
                                        more. Remove it or pick another.
                                    </p>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={disabled || atMax}
                            onClick={() => onChange([...ids, ''])}
                        >
                            <Plus className="size-3.5" /> Add {courseLower}
                        </MyButton>
                        <span className="text-caption text-neutral-400">
                            Up to {BLOG_MAX_RECOMMENDED_COURSES}
                            {ids.length > 0 &&
                                ` · ${ids.length}/${BLOG_MAX_RECOMMENDED_COURSES} used`}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
};

const statusChip = (status?: BlogPostStatus) => {
    if (status === 'PUBLISHED') return <StatusChip text="Published" textSize="text-xs" status="SUCCESS" />;
    if (status === 'ARCHIVED') return <StatusChip text="Archived" textSize="text-xs" status="INFO" showIcon={false} />;
    return <StatusChip text="Draft" textSize="text-xs" status="WARNING" showIcon={false} />;
};

/** Every (site, page) that carries a Blog section — where a post will show. */
const useBlogPlacements = (instituteId: string | null | undefined) => {
    const { data: tags } = useQuery({
        queryKey: ['catalogueTags', instituteId],
        queryFn: () => getCatalogueTags(instituteId!),
        enabled: !!instituteId,
        staleTime: 60_000,
    });
    return useMemo(() => {
        const out: Array<{ tagName: string; route: string; status: string }> = [];
        for (const tag of tags || []) {
            try {
                const cfg = JSON.parse((tag as { catalogueJson?: string }).catalogueJson || '{}');
                for (const page of cfg?.pages || []) {
                    const hasBlog = (page?.components || []).some(
                        (c: { type?: string; enabled?: boolean }) => c?.type === 'blog' && c.enabled !== false
                    );
                    if (hasBlog) {
                        const route = String(page.route || '').replace(/^\//, '');
                        out.push({ tagName: tag.tagName, route, status: tag.status });
                    }
                }
            } catch {
                /* a site with unparsable JSON simply has no placements */
            }
        }
        return out;
    }, [tags]);
};

interface BlogPostEditorProps {
    /** 'new' creates; any other id edits that post. */
    postId: string;
    onBack: () => void;
    /** A brand-new post got its id — the host swaps to editing it. */
    onCreated: (postId: string) => void;
    onDirtyChange?: (dirty: boolean) => void;
}

export const BlogPostEditor = ({ postId, onBack, onCreated, onDirtyChange }: BlogPostEditorProps) => {
    const isNew = !postId || postId === 'new';
    const instituteId = getCurrentInstituteId();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { canWrite, canPublish } = useCataloguePermissions();
    const { instituteDetails, setInstituteDetails, getCourseFromPackage } =
        useInstituteDetailsStore();
    const [instituteLoadFailed, setInstituteLoadFailed] = useState(false);
    // The institute's courses (package id + name) for the Recommended picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const allCourses = useMemo(() => getCourseFromPackage(), [instituteDetails]);

    const authorDefault = useMemo(() => {
        const token = getTokenFromCookie(TokenKey.accessToken);
        return (token && getTokenDecodedData(token)?.fullname) || '';
    }, []);

    const [form, setForm] = useState<FormState>(() => emptyForm(authorDefault));
    const [mode, setMode] = useState<Mode>('visual');
    const [dirty, setDirty] = useState(false);
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    // Needed for "view on site" links on the institute's own learner domain.
    useEffect(() => {
        if (!instituteDetails) {
            fetchBothInstituteAPIs()
                .then(setInstituteDetails)
                .catch(() => setInstituteLoadFailed(true));
        }
    }, [instituteDetails, setInstituteDetails]);

    const { data: post, isLoading } = useQuery({
        queryKey: ['catalogue-blog-post', instituteId, postId],
        queryFn: () => getBlogPost(instituteId!, postId),
        enabled: !!instituteId && !isNew,
    });

    const { data: library } = useQuery({
        queryKey: ['catalogue-blog-posts', instituteId, 'categories'],
        queryFn: () => listBlogPosts(instituteId!, { status: 'ALL', size: 1 }),
        enabled: !!instituteId,
        staleTime: 60_000,
    });
    const categories = library?.categories ?? [];
    const placements = useBlogPlacements(instituteId);

    useEffect(() => {
        if (post) {
            setForm(formFromPost(post));
            setDirty(false);
            // A body that TipTap cannot faithfully represent opens in HTML view
            // so nothing is silently normalised on first save.
            setMode(/<(iframe|figure|table|style|div)[\s>]/i.test(post.content_html || '') ? 'html' : 'visual');
        }
    }, [post]);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((f) => ({ ...f, [key]: value }));
        setDirty(true);
    };

    const effectiveSlug = form.slugTouched && form.slug ? form.slug : slugifyTitle(form.title);

    const payload = (): BlogPostInput => ({
        title: form.title.trim(),
        slug: effectiveSlug || undefined,
        excerpt: form.excerpt,
        content_html: form.contentHtml,
        cover_image_url: form.coverImageUrl,
        author_name: form.authorName,
        category: form.category.trim(),
        tags: form.tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        published_at: fromLocalInput(form.publishedAt) ?? null,
        seo_title: form.seoTitle,
        seo_description: form.seoDescription,
        template: form.template,
        recommended_course_ids: form.recommendedCourseIds.filter(Boolean),
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['catalogue-blog-posts', instituteId] });
        queryClient.invalidateQueries({ queryKey: ['catalogue-blog-post', instituteId, postId] });
    };

    const saveMutation = useMutation({
        mutationFn: async (thenPublish: boolean) => {
            const body = payload();
            const saved = isNew
                ? await createBlogPost(instituteId!, body)
                : await updateBlogPost(instituteId!, postId, body);
            return thenPublish && saved.status !== 'PUBLISHED' ? publishBlogPost(instituteId!, saved.id) : saved;
        },
        onSuccess: (saved, thenPublish) => {
            setDirty(false);
            invalidate();
            toast({
                title: thenPublish ? 'Published' : 'Saved',
                description: thenPublish ? 'The post is live on every site with a Blog section.' : undefined,
            });
            if (isNew) {
                onCreated(saved.id);
            }
        },
        onError: (err: unknown) => {
            const message =
                (err as { response?: { data?: { ex?: string; message?: string } } })?.response?.data?.ex ||
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                'The post could not be saved';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        },
    });

    const unpublishMutation = useMutation({
        mutationFn: () => unpublishBlogPost(instituteId!, postId),
        onSuccess: () => {
            invalidate();
            toast({ title: 'Moved to drafts' });
        },
        onError: () => toast({ title: 'Error', description: 'The post could not be unpublished', variant: 'destructive' }),
    });

    const switchMode = (next: Mode) => {
        if (next === mode) return;
        if (
            next === 'visual' &&
            /<(iframe|figure|table|style|div)[\s>]/i.test(form.contentHtml) &&
            !window.confirm(
                'The visual editor may simplify embeds, tables or custom markup in this HTML. Switch anyway? (Your HTML is kept until you edit in visual mode.)'
            )
        ) {
            return;
        }
        setMode(next);
    };

    if (!instituteId) return <div className="p-6 text-neutral-500">No institute selected</div>;
    if (!isNew && isLoading) return <DashboardLoader />;
    if (!isNew && !post) return <div className="p-6 text-neutral-500">Post not found</div>;

    const status = post?.status;
    const canSave = canWrite && form.title.trim().length > 0 && !saveMutation.isPending;
    const liveLinks =
        status === 'PUBLISHED' && post
            ? placements
                  .filter((p) => p.status === 'ACTIVE' || p.status === 'active')
                  .map((p) => {
                      const base = getCatalogueSiteUrl(p.tagName, instituteDetails?.learner_portal_base_url);
                      const isHome = p.route === '' || p.route === 'home' || p.route === 'homepage';
                      return {
                          label: `${p.tagName}${isHome ? '' : `/${p.route}`}`,
                          href: isHome
                              ? `${base}?post=${encodeURIComponent(post.slug)}`
                              : `${base}/${p.route}/${encodeURIComponent(post.slug)}`,
                      };
                  })
            : [];

    return (
        <div className="flex min-h-full flex-col bg-neutral-50">
            {/* Top bar */}
            {/* pr-14 keeps the actions clear of the dialog's close button. */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white py-3 pl-4 pr-14 lg:pl-6">
                <button
                    type="button"
                    onClick={() => {
                        if (dirty && !window.confirm('Discard unsaved changes?')) return;
                        onBack();
                    }}
                    className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                >
                    <ArrowLeft className="size-4" /> Blog
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-neutral-800">
                        {isNew ? 'New post' : form.title || 'Untitled post'}
                    </span>
                    {!isNew && statusChip(status)}
                    {dirty && <span className="text-xs text-neutral-400">Unsaved changes</span>}
                </div>
                <div className="flex items-center gap-2">
                    {liveLinks.map((l) => (
                        <a
                            key={l.href}
                            href={l.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline"
                            title="Open the live article"
                        >
                            <ArrowSquareOut className="size-3.5" /> {l.label}
                        </a>
                    ))}
                    {canPublish && status === 'PUBLISHED' && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={unpublishMutation.isPending}
                            onClick={() => unpublishMutation.mutate()}
                        >
                            Unpublish
                        </MyButton>
                    )}
                    <MyButton buttonType="secondary" scale="small" disable={!canSave} onClick={() => saveMutation.mutate(false)}>
                        {status === 'PUBLISHED' ? 'Save changes' : 'Save draft'}
                    </MyButton>
                    {canPublish && status !== 'PUBLISHED' && (
                        <MyButton buttonType="primary" scale="small" disable={!canSave} onClick={() => saveMutation.mutate(true)}>
                            {isNew ? 'Save & publish' : 'Publish'}
                        </MyButton>
                    )}
                </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-6">
                {/* Body */}
                <div className="flex min-w-0 flex-col gap-4">
                    <div className="space-y-2">
                        <Label>Title</Label>
                        <Input
                            value={form.title}
                            onChange={(e) => set('title', e.target.value)}
                            placeholder="e.g. How to plan your last 30 days before NEET"
                            className="text-base font-semibold"
                        />
                        <p className="text-xs text-neutral-500">
                            Address:{' '}
                            <span className="font-mono">
                                …/{'<blog page>'}/{effectiveSlug || 'your-title'}
                            </span>
                        </p>
                    </div>

                    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
                        <div className="space-y-3 border-b border-neutral-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-neutral-800">
                                    Article content
                                </h3>
                                <p className="text-xs text-neutral-500">
                                    Choose how to write the article. Both save the same content, so
                                    you can switch any time.
                                </p>
                            </div>
                            <div
                                role="radiogroup"
                                aria-label="Content editor"
                                className="grid gap-2 sm:grid-cols-2"
                            >
                                {(
                                    [
                                        {
                                            key: 'visual',
                                            icon: TextAa,
                                            title: 'Write it here',
                                            hint: 'Headings, text, images, links and lists, like a document.',
                                        },
                                        {
                                            key: 'html',
                                            icon: Code,
                                            title: 'Custom HTML',
                                            hint: 'Paste or code your own HTML: an AI draft, an old site, a YouTube embed.',
                                        },
                                    ] as const
                                ).map(({ key, icon: Icon, title, hint }) => {
                                    const active = mode === key;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            onClick={() => switchMode(key)}
                                            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                                                active
                                                    ? 'border-primary-500 bg-primary-50'
                                                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                                            }`}
                                        >
                                            <span
                                                className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                                                    active
                                                        ? 'bg-primary-500 text-white'
                                                        : 'bg-neutral-100 text-neutral-600'
                                                }`}
                                            >
                                                <Icon className="size-4" />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-sm font-medium text-neutral-800">
                                                    {title}
                                                </span>
                                                <span className="block text-xs text-neutral-500">
                                                    {hint}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {mode === 'visual' ? (
                            <div className="p-3">
                                <TipTapEditor
                                    value={form.contentHtml}
                                    onChange={(html) => set('contentHtml', html)}
                                    placeholder="Write your article…"
                                    minHeight={480}
                                    stickyToolbar
                                />
                            </div>
                        ) : (
                            <div className="flex flex-1 flex-col">
                                {/* Grows with the column (the meta rail sets the row height), never below a token height. */}
                                <div className="min-h-96 flex-1 bg-neutral-900">
                                    <MonacoHtmlEditor value={form.contentHtml} onChange={(html) => set('contentHtml', html)} />
                                </div>
                                <p className="border-t border-neutral-200 px-3 py-2 text-caption text-neutral-500">
                                    Paste any HTML — from an AI, a document export, an old site. Scripts, forms and
                                    unknown embeds are removed when the article renders; YouTube and Vimeo embeds are kept.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Meta */}
                <aside className="flex flex-col gap-5">
                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">Card & listing</h3>
                        <ImageUploadField slot="card" label="Cover image" value={form.coverImageUrl} onChange={(url) => set('coverImageUrl', url)} />
                        <div className="space-y-2">
                            <Label>Excerpt</Label>
                            <Textarea
                                rows={3}
                                value={form.excerpt}
                                onChange={(e) => set('excerpt', e.target.value)}
                                placeholder="One or two sentences shown on the card and as the default description."
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Input
                                list="blog-categories"
                                value={form.category}
                                onChange={(e) => set('category', e.target.value)}
                                placeholder="e.g. Study tips"
                            />
                            <datalist id="blog-categories">
                                {categories.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                            <p className="text-xs text-neutral-500">A Blog section can be pinned to one category.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Tags</Label>
                            <Input
                                value={form.tagsText}
                                onChange={(e) => set('tagsText', e.target.value)}
                                placeholder="Comma-separated, e.g. NEET, Biology"
                            />
                            {form.tagsText.trim() && (
                                <div className="flex flex-wrap gap-1.5">
                                    {form.tagsText
                                        .split(',')
                                        .map((t) => t.trim())
                                        .filter(Boolean)
                                        .map((tag) => (
                                            <span
                                                key={tag}
                                                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700"
                                            >
                                                {tag}
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${tag}`}
                                                    onClick={() =>
                                                        set(
                                                            'tagsText',
                                                            form.tagsText
                                                                .split(',')
                                                                .map((t) => t.trim())
                                                                .filter((t) => t && t !== tag)
                                                                .join(', ')
                                                        )
                                                    }
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            </span>
                                        ))}
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Author</Label>
                            <Input value={form.authorName} onChange={(e) => set('authorName', e.target.value)} />
                        </div>
                    </section>

                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">Article layout</h3>
                        <LayoutPicker
                            value={form.template}
                            onChange={(t) => set('template', t)}
                            disabled={!canWrite}
                        />
                    </section>

                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">
                            Recommended{' '}
                            {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
                        </h3>
                        <RecommendedCoursesField
                            ids={form.recommendedCourseIds}
                            onChange={(ids) => set('recommendedCourseIds', ids)}
                            courses={allCourses}
                            loading={!instituteDetails && !instituteLoadFailed}
                            failed={!instituteDetails && instituteLoadFailed}
                            disabled={!canWrite}
                        />
                    </section>

                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">Address & schedule</h3>
                        <div className="space-y-2">
                            <Label>Slug</Label>
                            <Input
                                value={form.slugTouched ? form.slug : effectiveSlug}
                                onChange={(e) => {
                                    setForm((f) => ({ ...f, slug: slugifyTitle(e.target.value) || e.target.value, slugTouched: true }));
                                    setDirty(true);
                                }}
                                className="font-mono text-xs"
                            />
                            <p className="text-xs text-neutral-500">
                                Made from the title until you edit it. Changing a published slug breaks links already shared.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Publish date</Label>
                            <Input
                                type="datetime-local"
                                value={form.publishedAt}
                                onChange={(e) => set('publishedAt', e.target.value)}
                            />
                            <p className="text-xs text-neutral-500">
                                Leave empty to use the moment you publish. A future date keeps a published post
                                hidden until then; a past date back-dates it.
                            </p>
                        </div>
                    </section>

                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">Search & sharing</h3>
                        <div className="space-y-2">
                            <Label>SEO title</Label>
                            <Input value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} placeholder={form.title || 'Defaults to the title'} />
                        </div>
                        <div className="space-y-2">
                            <Label>Meta description</Label>
                            <Textarea
                                rows={3}
                                value={form.seoDescription}
                                onChange={(e) => set('seoDescription', e.target.value)}
                                placeholder={form.excerpt || 'Defaults to the excerpt'}
                            />
                            <p className="text-xs text-neutral-500">{form.seoDescription.length}/160 recommended</p>
                        </div>
                    </section>

                    <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-neutral-800">Where it appears</h3>
                        {placements.length === 0 ? (
                            <p className="text-xs text-neutral-500">
                                No website page has a Blog section yet. Open a site in Manage Pages and add
                                “Blog” from Answers &amp; text to a page (a dedicated page such as /blog gives
                                every article its own clean URL).
                            </p>
                        ) : (
                            <ul className="space-y-1 text-xs text-neutral-600">
                                {placements.map((p) => (
                                    <li key={`${p.tagName}/${p.route}`} className="font-mono">
                                        {p.tagName}/{p.route || ''}
                                        {p.status !== 'ACTIVE' && p.status !== 'active' && (
                                            <span className="ml-1 font-sans text-neutral-400">(site not published)</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {post?.source === 'MCP' && (
                            <p className="rounded-md bg-primary-50 px-2 py-1.5 text-caption text-primary-500">
                                Written by an AI app connected over MCP. Review before publishing.
                            </p>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
};
