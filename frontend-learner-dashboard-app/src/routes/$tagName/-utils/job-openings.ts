/**
 * Job openings (the `jobOpenings` section): pure helpers shared by the
 * section (cards vs. one job's page) and CourseCataloguePage (which shows only
 * this section while a job's page is open, as it does for a blog article).
 *
 * Jobs live in the page JSON (props.jobs), not in a table: a careers page is a
 * handful of hand-written posts the admin edits in Manage Pages. Each job has
 * its own address, /<site>/<page>/<job-slug>, read exactly like a blog post's
 * (blogPostSlugFor); on the home page it is ?job=<slug>.
 */
import { blogPostSlugFor } from "./blog-route";

/** The looks an admin can pick. Each one styles BOTH the cards and the job page. */
export const JOB_TEMPLATES = [
  "classic",
  "poster",
  "list",
  "editorial",
  "dark",
  "minimal",
  "spotlight",
  "split",
] as const;
export type JobOpeningsTemplate = (typeof JOB_TEMPLATES)[number];

export const DEFAULT_JOB_TEMPLATE: JobOpeningsTemplate = "classic";

export const readJobTemplate = (value: unknown): JobOpeningsTemplate =>
  (JOB_TEMPLATES as readonly string[]).includes(String(value)) ? (value as JobOpeningsTemplate) : DEFAULT_JOB_TEMPLATE;

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
  /** Extra label/value rows, e.g. "Exam focus: NEET". */
  details?: JobDetailPair[];
  /** Rich text (HTML), sanitised at render time like a blog post body. */
  description?: string;
  /** External application form (Google Form etc.). */
  applyUrl?: string;
  applyLabel?: string;
  /** Optional second button: a site page, #anchor or full URL. */
  secondaryLabel?: string;
  secondaryUrl?: string;
  enabled?: boolean;
}

export type ResolvedJob = JobItem & { slug: string; title: string };

/**
 * "Educator Vacancy (NEET)" → "educator-vacancy-neet". Letters of any script
 * survive (a Hindi title keeps its words), so the slug matches what an admin
 * reads. Mirrored by ai_service's job slug helper — keep the two in step.
 */
export const slugifyJobTitle = (text: unknown): string =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

/**
 * The jobs a visitor sees, in order, each with a unique slug: disabled and
 * untitled jobs are dropped, an empty slug is made from the title, a repeated
 * one gets -2, -3…
 *
 * `baseJobs` are the AUTHORED jobs (before site-language translation): slugs
 * come from them so a job keeps one address in every language. Aligned by
 * index with `jobs`.
 */
export const resolveJobs = (jobs: unknown, baseJobs?: unknown): ResolvedJob[] => {
  const list: JobItem[] = Array.isArray(jobs) ? jobs : [];
  const base: JobItem[] = Array.isArray(baseJobs) ? baseJobs : list;
  const used = new Set<string>();
  const out: ResolvedJob[] = [];
  list.forEach((job, i) => {
    if (!job || typeof job !== "object" || job.enabled === false) return;
    const title = String(job.title ?? "").trim();
    if (!title) return;
    const authored = base[i] && typeof base[i] === "object" ? base[i] : job;
    const root =
      slugifyJobTitle(authored.slug) || slugifyJobTitle(authored.title) || slugifyJobTitle(title) || `job-${i + 1}`;
    let slug = root;
    for (let n = 2; used.has(slug); n++) slug = `${root}-${n}`;
    used.add(slug);
    out.push({ ...job, title, slug });
  });
  return out;
};

/** Which job (if any) this URL addresses, for the section on `pageRoute`. */
export const jobSlugFor = (pathname: string, searchStr: string, tagName: string, pageRoute: string): string | null =>
  blogPostSlugFor(pathname, searchStr, tagName, pageRoute, "job");

/** An apply link only ever leaves for a web form: http(s), nothing else. */
export const safeExternalUrl = (url: unknown): string | null => {
  const s = String(url ?? "").trim();
  if (!/^https?:\/\/[^\s/]+/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
};

/** The meta row: compensation, location, job type, then the extra pairs. */
export const jobMetaPairs = (job: JobItem): Array<{ key: string; label?: string; value: string }> => {
  const pairs: Array<{ key: string; label?: string; value: string }> = [];
  if (job.compensation?.trim()) pairs.push({ key: "compensation", value: job.compensation.trim() });
  if (job.location?.trim()) pairs.push({ key: "location", value: job.location.trim() });
  if (job.jobType?.trim()) pairs.push({ key: "jobType", value: job.jobType.trim() });
  (Array.isArray(job.details) ? job.details : []).forEach((d, i) => {
    const value = String(d?.value ?? "").trim();
    if (value) pairs.push({ key: `detail-${i}`, label: String(d?.label ?? "").trim() || undefined, value });
  });
  return pairs;
};

/** Does `slug` address one of this section's visible jobs? */
export const pageHasJob = (props: { jobs?: unknown } | undefined, slug: string | null): boolean =>
  !!slug && resolveJobs(props?.jobs).some((j) => j.slug === slug);
