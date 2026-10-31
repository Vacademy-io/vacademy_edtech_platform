/**
 * Job openings (`jobOpenings`) — the editor's copy of the learner contract in
 * frontend-learner-dashboard-app/src/routes/$tagName/-utils/job-openings.ts.
 * Keep the template ids and the slug rule in step with it (and with
 * ai_service's services/catalogue_summary.job_slug).
 */

export const JOB_TEMPLATES = [
    'classic',
    'poster',
    'list',
    'editorial',
    'dark',
    'minimal',
    'spotlight',
    'split',
] as const;
export type JobOpeningsTemplate = (typeof JOB_TEMPLATES)[number];

export const DEFAULT_JOB_TEMPLATE: JobOpeningsTemplate = 'classic';

export const readJobTemplate = (value: unknown): JobOpeningsTemplate =>
    (JOB_TEMPLATES as readonly string[]).includes(String(value))
        ? (value as JobOpeningsTemplate)
        : DEFAULT_JOB_TEMPLATE;

/** Templates whose cards sit in a grid, so the Columns setting applies. */
export const TEMPLATES_WITH_COLUMNS: ReadonlySet<JobOpeningsTemplate> = new Set([
    'classic',
    'poster',
    'dark',
    'spotlight',
    'split',
]);

/** "Educator Vacancy (NEET)" → "educator-vacancy-neet"; letters of any script survive. */
export const slugifyJobTitle = (text: unknown): string =>
    String(text ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '');

export interface JobDetailPair {
    label?: string;
    value?: string;
}

export interface JobItem {
    id?: string;
    slug?: string;
    title?: string;
    image?: string;
    imageAlt?: string;
    summary?: string;
    location?: string;
    jobType?: string;
    compensation?: string;
    details?: JobDetailPair[];
    description?: string;
    applyUrl?: string;
    applyLabel?: string;
    secondaryLabel?: string;
    secondaryUrl?: string;
    enabled?: boolean;
}

/**
 * The slug each job will have on the live site, in list order — the same
 * rule the learner applies (disabled/untitled jobs get none; repeats get -2…).
 */
export const liveJobSlugs = (jobs: JobItem[]): Array<string | null> => {
    const used = new Set<string>();
    return jobs.map((job, i) => {
        if (!job || job.enabled === false || !String(job.title ?? '').trim()) return null;
        const root = slugifyJobTitle(job.slug) || slugifyJobTitle(job.title) || `job-${i + 1}`;
        let slug = root;
        for (let n = 2; used.has(slug); n++) slug = `${root}-${n}`;
        used.add(slug);
        return slug;
    });
};

/** An apply link must be a web address; https is what the server keeps. */
export const isHttpsUrl = (url: unknown): boolean =>
    /^https:\/\/[^\s/]+/i.test(String(url ?? '').trim());
