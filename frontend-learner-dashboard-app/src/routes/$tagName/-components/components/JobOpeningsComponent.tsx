import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Helmet } from "react-helmet";
import { ArrowLeft, ArrowRight, ArrowUpRight, Briefcase, MapPin, Wallet } from "@phosphor-icons/react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { cn } from "@/lib/utils";
import { RouteMatcher } from "../../-services/route-matcher";
import { isHomeRoute } from "../../-utils/blog-route";
import { blogPlainText, sanitizeBlogHtml } from "../../-utils/blog-html";
import {
  jobMetaPairs,
  jobSlugFor,
  readJobTemplate,
  resolveJobs,
  safeExternalUrl,
  type JobOpeningsTemplate,
  type ResolvedJob,
} from "../../-utils/job-openings";
import { CatalogueLink } from "../CatalogueLink";
import "./catalogue-blog.css";

/**
 * Job openings — a careers page's cards, and each job as a page of its own.
 *
 *   cards — /<site>/<page>            one card per enabled job
 *   job   — /<site>/<page>/<job-slug> the full description and an Apply button
 *
 * Like the blog section, which face shows is read from the URL (the segment
 * after this page's route; ?job= on the home page), so a job has a shareable
 * address and no popup. An unknown slug shows the cards. Jobs are authored in
 * the page JSON (props.jobs); their slugs come from the AUTHORED props
 * (baseProps) so the address is the same in every site language.
 *
 * `template` picks one of eight looks; each styles both faces from the same
 * job data. The description is admin-written HTML on the learner domain, so it
 * goes through the blog body sanitiser at render time. Apply links leave the
 * site for an external form, http(s) only, in a new tab.
 */

export interface JobOpeningsComponentProps {
  headerText?: string;
  subheading?: string;
  template?: JobOpeningsTemplate | string;
  /** 1-4 cards per row on desktop; phones always show one. */
  columns?: number;
  jobs?: unknown;
  viewButtonLabel?: string;
  applyButtonLabel?: string;
  backLabel?: string;
  emptyMessage?: string;
  /* injected by the renderer */
  baseProps?: { jobs?: unknown };
  tagName: string;
  pageRoute: string;
  isPreviewMode?: boolean;
}

interface Labels {
  view: string;
  apply: string;
  back: string;
  newTab: string;
}

/** Same click rule as the blog cards: a plain click navigates in-app, a modified one opens a tab. */
const spaClick = (onOpen: () => void) => (e: React.MouseEvent<HTMLAnchorElement>) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  onOpen();
};

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};
const gridClass = (columns: unknown) => GRID_COLS[Math.min(4, Math.max(1, Number(columns) || 2))];

/** Serif display for the editorial look: the site's heading font, else a serif stack. */
const SERIF_HEADING: React.CSSProperties = {
  fontFamily: "var(--catalogue-heading-font, ui-serif, Georgia, 'Times New Roman', serif)",
};

export const JobOpeningsComponent: React.FC<JobOpeningsComponentProps> = ({
  headerText,
  subheading,
  template: templateProp,
  columns = 2,
  jobs,
  viewButtonLabel,
  applyButtonLabel,
  backLabel,
  emptyMessage,
  baseProps,
  tagName,
  pageRoute,
  isPreviewMode = false,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const location = useLocation();
  const navigate = useNavigate();
  const template = readJobTemplate(templateProp);

  const resolved = useMemo(() => resolveJobs(jobs, baseProps?.jobs ?? jobs), [jobs, baseProps?.jobs]);
  const slug = useMemo(
    () => jobSlugFor(location.pathname, location.searchStr || "", tagName, pageRoute),
    [location.pathname, location.searchStr, tagName, pageRoute]
  );

  const onHome = isHomeRoute(pageRoute);
  const listPath = RouteMatcher.pagePath(tagName, pageRoute);
  const jobPath = (s: string) =>
    onHome ? `${listPath}?job=${encodeURIComponent(s)}` : `${listPath}/${encodeURIComponent(s)}`;
  const openJob = (s: string) => {
    // pagePath() already applied the root-mount rule. The home-page form is a
    // search param, which the router wants as an object, not in `to`.
    if (onHome) {
      navigate({ to: listPath as never, search: { job: s } as never });
      return;
    }
    navigate({ to: jobPath(s) as never });
  };

  const labels: Labels = {
    view: viewButtonLabel || t("jobOpenings.viewDetails"),
    apply: applyButtonLabel || t("jobOpenings.apply"),
    back: backLabel || t("jobOpenings.backToList"),
    newTab: t("jobOpenings.opensInNewTab"),
  };

  const active = slug ? resolved.find((j) => j.slug === slug) : undefined;
  if (active) {
    return (
      <JobDetail
        job={active}
        template={template}
        labels={labels}
        listPath={listPath}
        onBack={() => navigate({ to: listPath as never })}
      />
    );
  }

  const dark = template === "dark";
  const editorial = template === "editorial";
  const cardProps = (job: ResolvedJob) => ({
    job,
    labels,
    href: jobPath(job.slug),
    onOpen: () => openJob(job.slug),
  });

  const renderCards = () => {
    switch (template) {
      case "poster":
        return (
          <div className={cn("grid items-start gap-6", gridClass(columns))}>
            {resolved.map((job, i) => (
              <PosterCard key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </div>
        );
      case "list":
        return (
          <div className="flex flex-col gap-4">
            {resolved.map((job, i) => (
              <ListRow key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </div>
        );
      case "editorial":
        return (
          <ol className="border-t border-catalogue-border">
            {resolved.map((job, i) => (
              <EditorialRow key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </ol>
        );
      case "dark":
        return (
          <div className={cn("grid gap-6", gridClass(columns))}>
            {resolved.map((job, i) => (
              <DarkCard key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </div>
        );
      case "minimal":
        return (
          <ul className="divide-y divide-catalogue-border border-y border-catalogue-border">
            {resolved.map((job, i) => (
              <MinimalRow key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </ul>
        );
      case "spotlight": {
        const [first, ...rest] = resolved;
        return (
          <div className="flex flex-col gap-6">
            {first && <SpotlightCard index={0} {...cardProps(first)} />}
            {rest.length > 0 && (
              <div className={cn("grid gap-6", gridClass(columns))}>
                {rest.map((job, i) => (
                  <ClassicCard key={job.slug} index={i + 1} {...cardProps(job)} />
                ))}
              </div>
            )}
          </div>
        );
      }
      // classic, and split (classic cards; its job page is two columns)
      default:
        return (
          <div className={cn("grid gap-6", gridClass(columns))}>
            {resolved.map((job, i) => (
              <ClassicCard key={job.slug} index={i} {...cardProps(job)} />
            ))}
          </div>
        );
    }
  };

  return (
    <section
      className={cn("catalogue-section relative overflow-hidden", dark ? "bg-neutral-950 text-white" : "bg-catalogue-bg")}
      data-job-openings={template}
    >
      {dark && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 start-1/2 size-96 -translate-x-1/2 rounded-full bg-primary-500 opacity-25 blur-3xl"
        />
      )}
      <div className="catalogue-shell relative">
        {(headerText || subheading) && (
          <div className={cn("catalogue-section-header", editorial ? "text-start" : "text-center")}>
            {headerText && (
              <h2
                className={cn("catalogue-h2", dark ? "text-white" : "text-catalogue-text-primary")}
                style={editorial ? SERIF_HEADING : undefined}
              >
                {headerText}
              </h2>
            )}
            {subheading && (
              <p
                className={cn(
                  "catalogue-lead",
                  editorial ? "catalogue-measure-start" : "catalogue-measure",
                  dark ? "text-white/70" : "text-catalogue-text-muted"
                )}
              >
                {subheading}
              </p>
            )}
          </div>
        )}

        {isPreviewMode && onHome && resolved.length > 0 && (
          <p className="mb-6 rounded-catalogue-md border border-dashed border-warning-400 bg-warning-50 px-4 py-3 text-center text-xs text-catalogue-text-secondary">
            {t("jobOpenings.homePageHint")}
          </p>
        )}

        {resolved.length === 0 ? (
          <div
            className={cn(
              "rounded-catalogue-lg border border-dashed p-8 text-center text-sm",
              dark ? "border-white/20 text-white/70" : "catalogue-card border-catalogue-border text-catalogue-text-muted"
            )}
          >
            {isPreviewMode ? t("jobOpenings.emptyGuidance") : emptyMessage || t("jobOpenings.empty")}
          </div>
        ) : (
          renderCards()
        )}
      </div>
    </section>
  );
};

/* ─── Card pieces ──────────────────────────────────────────────────────── */

interface CardProps {
  job: ResolvedJob;
  index: number;
  labels: Labels;
  href: string;
  onOpen: () => void;
}

const META_ICONS = { compensation: Wallet, location: MapPin, jobType: Briefcase } as const;

/** Location / job type / compensation as small chips (cards show only these three). */
const MetaChips: React.FC<{ job: ResolvedJob; tone?: "default" | "inverse" | "plain"; className?: string }> = ({
  job,
  tone = "default",
  className,
}) => {
  const chips = jobMetaPairs(job).filter((p) => p.key in META_ICONS);
  if (!chips.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {chips.map((c) => {
        const Icon = META_ICONS[c.key as keyof typeof META_ICONS];
        return (
          <li
            key={c.key}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              tone === "plain"
                ? "text-catalogue-text-muted"
                : "rounded-full px-2.5 py-0.5",
              tone === "default" && "bg-primary-50 text-primary-500 ring-1 ring-primary-100",
              tone === "inverse" && "bg-white/10 text-white/85 ring-1 ring-white/15"
            )}
          >
            <Icon size={13} aria-hidden="true" /> {c.value}
          </li>
        );
      })}
    </ul>
  );
};

/** A cropped thumbnail; nothing at all when the job has no image. */
const Thumb: React.FC<{ job: ResolvedJob; className: string }> = ({ job, className }) =>
  job.image ? (
    <FitImage src={job.image} alt={job.imageAlt || ""} loading="lazy" className={cn("shrink-0 overflow-hidden", className)} />
  ) : null;

/** The whole poster, never cropped (posters carry their own text). */
const NaturalImage: React.FC<{ job: ResolvedJob; className?: string }> = ({ job, className }) =>
  job.image ? (
    <img src={job.image} alt={job.imageAlt || job.title} loading="lazy" className={cn("block h-auto w-full", className)} />
  ) : null;

const ViewButton: React.FC<{ href: string; onOpen: () => void; label: string; className?: string }> = ({
  href,
  onOpen,
  label,
  className,
}) => (
  <a href={href} onClick={spaClick(onOpen)} className={cn("catalogue-btn catalogue-btn-primary", className)}>
    {label} <ArrowRight size={16} aria-hidden="true" />
  </a>
);

const TitleLink: React.FC<{ href: string; onOpen: () => void; children: React.ReactNode }> = ({ href, onOpen, children }) => (
  <a href={href} onClick={spaClick(onOpen)} className="hover:underline">
    {children}
  </a>
);

const stagger = (i: number) => ({ "data-stagger-item": true, style: { ["--stagger-i" as string]: i } as React.CSSProperties });

const ClassicCard: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <article {...stagger(index)} className="catalogue-card-elevated flex flex-col p-5 sm:p-6" data-job-card={job.slug}>
    <div className="flex items-start gap-4">
      <Thumb job={job} className="size-16 rounded-catalogue-md" />
      <h3 className="catalogue-h3 min-w-0 text-catalogue-text-primary">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
    </div>
    <MetaChips job={job} className="mt-4" />
    {job.summary && <p className="mt-3 text-sm leading-relaxed text-catalogue-text-secondary">{job.summary}</p>}
    <div className="mt-auto pt-5">
      <ViewButton href={href} onOpen={onOpen} label={labels.view} className="w-full justify-center sm:w-auto" />
    </div>
  </article>
);

const PosterCard: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <article {...stagger(index)} className="catalogue-card-elevated group flex flex-col overflow-hidden" data-job-card={job.slug}>
    {job.image ? (
      <a href={href} onClick={spaClick(onOpen)} tabIndex={-1} aria-hidden="true" className="block bg-catalogue-bg-muted">
        <NaturalImage job={job} />
      </a>
    ) : (
      <div aria-hidden="true" className="flex h-28 items-center justify-center bg-primary-50 text-primary-500">
        <Briefcase size={40} weight="duotone" />
      </div>
    )}
    <div className="flex flex-1 flex-col p-5 sm:p-6">
      <h3 className="catalogue-h3 text-catalogue-text-primary">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
      {job.summary && <p className="mt-2 text-sm leading-relaxed text-catalogue-text-secondary">{job.summary}</p>}
      <MetaChips job={job} className="mt-4" />
      <div className="mt-auto pt-5">
        <ViewButton href={href} onOpen={onOpen} label={labels.view} className="w-full justify-center" />
      </div>
    </div>
  </article>
);

const ListRow: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <article
    {...stagger(index)}
    className="catalogue-card-elevated flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5"
    data-job-card={job.slug}
  >
    <Thumb job={job} className="aspect-video w-full rounded-catalogue-md sm:aspect-square sm:size-24 sm:w-24" />
    <div className="min-w-0 flex-1">
      <h3 className="catalogue-h3 text-catalogue-text-primary">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
      <MetaChips job={job} tone="plain" className="mt-1.5 gap-x-4" />
      {job.summary && <p className="mt-2 text-sm leading-relaxed text-catalogue-text-secondary">{job.summary}</p>}
    </div>
    <ViewButton href={href} onOpen={onOpen} label={labels.view} className="w-full shrink-0 justify-center sm:w-auto" />
  </article>
);

const EditorialRow: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <li {...stagger(index)} className="border-b border-catalogue-border py-6 sm:py-8" data-job-card={job.slug}>
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
      <span className="font-mono text-sm text-catalogue-text-muted sm:w-12 sm:pt-1.5">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-2xl leading-tight text-catalogue-text-primary sm:text-3xl" style={SERIF_HEADING}>
          <TitleLink href={href} onOpen={onOpen}>
            {job.title}
          </TitleLink>
        </h3>
        <MetaChips job={job} tone="plain" className="mt-2 gap-x-4 uppercase tracking-wide" />
        {job.summary && (
          <p className="catalogue-measure-start mt-3 text-base leading-relaxed text-catalogue-text-secondary">{job.summary}</p>
        )}
        <a
          href={href}
          onClick={spaClick(onOpen)}
          className="catalogue-link mt-4 inline-flex items-center gap-1 text-sm font-semibold"
        >
          {labels.view} <ArrowRight size={14} aria-hidden="true" />
        </a>
      </div>
      <Thumb job={job} className="hidden aspect-square w-32 rounded-catalogue-md md:block" />
    </div>
  </li>
);

const DarkCard: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <article
    {...stagger(index)}
    className="group flex flex-col overflow-hidden rounded-catalogue-lg bg-white/5 ring-1 ring-white/10 backdrop-blur-sm transition hover:ring-primary-400"
    data-job-card={job.slug}
  >
    {job.image && (
      <a href={href} onClick={spaClick(onOpen)} tabIndex={-1} aria-hidden="true" className="block bg-black/30">
        <NaturalImage job={job} />
      </a>
    )}
    <div className="flex flex-1 flex-col p-5 sm:p-6">
      <h3 className="catalogue-h3 text-white">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
      {job.summary && <p className="mt-2 text-sm leading-relaxed text-white/70">{job.summary}</p>}
      <MetaChips job={job} tone="inverse" className="mt-4" />
      <div className="mt-auto pt-5">
        <ViewButton href={href} onOpen={onOpen} label={labels.view} className="w-full justify-center" />
      </div>
    </div>
  </article>
);

const MinimalRow: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <li
    {...stagger(index)}
    className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6"
    data-job-card={job.slug}
  >
    <div className="min-w-0 flex-1">
      <h3 className="text-base font-semibold text-catalogue-text-primary">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
      {job.summary && <p className="mt-0.5 truncate text-sm text-catalogue-text-muted">{job.summary}</p>}
    </div>
    <MetaChips job={job} tone="plain" className="gap-x-4 sm:shrink-0" />
    <a
      href={href}
      onClick={spaClick(onOpen)}
      className="catalogue-link inline-flex shrink-0 items-center gap-1 text-sm font-semibold"
    >
      {labels.view} <ArrowRight size={14} aria-hidden="true" />
    </a>
  </li>
);

const SpotlightCard: React.FC<CardProps> = ({ job, index, labels, href, onOpen }) => (
  <article
    {...stagger(index)}
    className="catalogue-card-elevated grid overflow-hidden md:grid-cols-2"
    data-job-card={job.slug}
  >
    {job.image ? (
      <a href={href} onClick={spaClick(onOpen)} tabIndex={-1} aria-hidden="true" className="block bg-catalogue-bg-muted">
        <NaturalImage job={job} className="md:h-full md:object-cover" />
      </a>
    ) : (
      <div aria-hidden="true" className="hidden items-center justify-center bg-primary-50 text-primary-500 md:flex">
        <Briefcase size={64} weight="duotone" />
      </div>
    )}
    <div className="flex flex-col justify-center p-6 sm:p-8">
      <h3 className="catalogue-h2 text-catalogue-text-primary">
        <TitleLink href={href} onOpen={onOpen}>
          {job.title}
        </TitleLink>
      </h3>
      {job.summary && <p className="catalogue-lead mt-3 text-catalogue-text-secondary">{job.summary}</p>}
      <MetaChips job={job} className="mt-5" />
      <div className="mt-6">
        <ViewButton href={href} onOpen={onOpen} label={labels.view} className="w-full justify-center sm:w-auto" />
      </div>
    </div>
  </article>
);

/* ─── One job's page ───────────────────────────────────────────────────── */

const META_LABEL_KEYS: Record<string, string> = {
  compensation: "jobOpenings.compensation",
  location: "jobOpenings.location",
  jobType: "jobOpenings.jobType",
};

interface JobDetailProps {
  job: ResolvedJob;
  template: JobOpeningsTemplate;
  labels: Labels;
  listPath: string;
  onBack: () => void;
}

export const JobDetail: React.FC<JobDetailProps> = ({ job, template, labels, listPath, onBack }) => {
  const { t } = useTranslation("coursePlayerB");
  const html = useMemo(() => sanitizeBlogHtml(job.description || ""), [job.description]);
  const applyUrl = safeExternalUrl(job.applyUrl);
  const meta = jobMetaPairs(job).map((p) => ({ ...p, label: p.label || (META_LABEL_KEYS[p.key] ? t(META_LABEL_KEYS[p.key]) : "") }));
  const description = job.summary || blogPlainText(job.description || "", 160);
  const dark = template === "dark";
  const editorial = template === "editorial";
  const showImage = template !== "minimal" && !!job.image;

  // A job page starts at the top, not wherever the cards were scrolled to.
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [job.slug]);

  const seo = (
    <Helmet>
      <title>{job.title}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={job.title} />
      {description && <meta property="og:description" content={description} />}
      {job.image && <meta property="og:image" content={job.image} />}
    </Helmet>
  );

  const back = (inverse = false) => (
    <a
      href={listPath}
      onClick={spaClick(onBack)}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        inverse ? "text-white/85 hover:text-white hover:underline" : "catalogue-link"
      )}
    >
      <ArrowLeft size={16} aria-hidden="true" /> {labels.back}
    </a>
  );

  const title = (className?: string) => (
    <h1
      className={cn("catalogue-h1", dark ? "text-white" : "text-catalogue-text-primary", className)}
      style={editorial ? SERIF_HEADING : undefined}
    >
      {job.title}
    </h1>
  );

  /** "chips": a wrap of label · value pills; "list": label/value rows (sidebars, editorial). */
  const metaBlock = (variant: "chips" | "list", inverse = false) =>
    meta.length === 0 ? null : variant === "chips" ? (
      <dl className="flex flex-wrap gap-2" data-job-meta>
        {meta.map((m) => (
          <div
            key={m.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm",
              inverse ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-catalogue-bg-muted text-catalogue-text-primary"
            )}
          >
            {m.label && <dt className={inverse ? "text-white/65" : "text-catalogue-text-muted"}>{m.label}:</dt>}
            <dd className="font-medium">{m.value}</dd>
          </div>
        ))}
      </dl>
    ) : (
      <dl className="divide-y divide-catalogue-border border-y border-catalogue-border" data-job-meta>
        {meta.map((m) => (
          <div key={m.key} className="flex justify-between gap-4 py-2.5 text-sm">
            <dt className="text-catalogue-text-muted">{m.label}</dt>
            <dd className="text-end font-medium text-catalogue-text-primary">{m.value}</dd>
          </div>
        ))}
      </dl>
    );

  const hasSecondary = !!(job.secondaryLabel && job.secondaryUrl);
  const hasButtons = !!applyUrl || hasSecondary;
  const buttons = (opts: { full?: boolean } = {}) =>
    hasButtons ? (
      <div className={cn("flex flex-wrap gap-3", opts.full && "flex-col")}>
        {applyUrl && (
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("catalogue-btn catalogue-btn-primary catalogue-btn-lg", opts.full && "w-full justify-center")}
            data-job-apply
          >
            {job.applyLabel || labels.apply} <ArrowUpRight size={18} aria-hidden="true" />
            <span className="sr-only"> {labels.newTab}</span>
          </a>
        )}
        {hasSecondary && (
          <CatalogueLink
            to={job.secondaryUrl as string}
            className={cn("catalogue-btn catalogue-btn-secondary catalogue-btn-lg", opts.full && "w-full justify-center")}
          >
            {job.secondaryLabel}
          </CatalogueLink>
        )}
      </div>
    ) : null;

  const body = html ? (
    <div
      className={cn("catalogue-rich-text catalogue-blog-article max-w-none")}
      data-job-description
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : null;

  const image = (className?: string) =>
    showImage ? <NaturalImage job={job} className={cn("rounded-catalogue-lg", className)} /> : null;

  /* split: two columns, the apply card sticky beside the description. */
  if (template === "split") {
    return (
      <section className="catalogue-section bg-catalogue-bg" data-job-detail={job.slug}>
        {seo}
        <div className="catalogue-shell">
          <div className="mb-6">{back()}</div>
          {title()}
          {job.summary && <p className="catalogue-lead catalogue-measure-start mt-3 text-catalogue-text-secondary">{job.summary}</p>}
          <div className="mt-8 grid gap-8 lg:grid-cols-3 lg:gap-12">
            <div className="min-w-0 space-y-8 lg:col-span-2">
              {image()}
              {body}
            </div>
            <aside className="lg:col-span-1">
              <div className="catalogue-card-elevated space-y-5 p-5 sm:p-6 lg:sticky lg:top-24">
                <p className="catalogue-eyebrow">{t("jobOpenings.jobDetails")}</p>
                {metaBlock("list")}
                {buttons({ full: true })}
              </div>
            </aside>
          </div>
        </div>
      </section>
    );
  }

  /* dark: a dark band carries the title, meta and Apply; the description reads on the page surface. */
  if (dark) {
    return (
      <>
        {seo}
        <section className="catalogue-section relative overflow-hidden bg-neutral-950 text-white" data-job-detail={job.slug}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 start-1/2 size-96 -translate-x-1/2 rounded-full bg-primary-500 opacity-25 blur-3xl"
          />
          <div className="catalogue-shell-prose relative space-y-5">
            {back(true)}
            {title()}
            {job.summary && <p className="catalogue-lead text-white/75">{job.summary}</p>}
            {metaBlock("chips", true)}
            {buttons()}
          </div>
        </section>
        <section className="catalogue-section bg-catalogue-bg">
          <div className="catalogue-shell-prose space-y-8">
            {image()}
            {body}
            {buttons()}
          </div>
        </section>
      </>
    );
  }

  /* spotlight: the job's header as a featured card (image beside the copy). */
  if (template === "spotlight") {
    return (
      <section className="catalogue-section bg-catalogue-bg" data-job-detail={job.slug}>
        {seo}
        <div className="catalogue-shell space-y-8">
          {back()}
          <div className={cn("catalogue-card-elevated grid overflow-hidden", showImage && "md:grid-cols-2")}>
            {showImage && (
              <div className="bg-catalogue-bg-muted">
                <NaturalImage job={job} />
              </div>
            )}
            <div className="flex flex-col justify-center space-y-4 p-6 sm:p-8">
              {title()}
              {job.summary && <p className="catalogue-lead text-catalogue-text-secondary">{job.summary}</p>}
              {metaBlock("chips")}
              {buttons()}
            </div>
          </div>
          <div className="catalogue-shell-prose space-y-8 px-0">
            {body}
            {buttons()}
          </div>
        </div>
      </section>
    );
  }

  /* classic, poster, list, editorial, minimal: one reading column. */
  return (
    <section className="catalogue-section bg-catalogue-bg" data-job-detail={job.slug}>
      {seo}
      <div className="catalogue-shell-prose space-y-6">
        {back()}
        {template === "poster" && image("mx-auto")}
        <header className={cn("space-y-4", editorial && "border-b border-catalogue-border pb-6")}>
          {title(editorial ? "text-4xl sm:text-5xl" : undefined)}
          {job.summary && <p className="catalogue-lead text-catalogue-text-secondary">{job.summary}</p>}
          {metaBlock(editorial ? "list" : "chips")}
          {buttons()}
        </header>
        {template !== "poster" && image()}
        {body}
        {hasButtons && (
          <div className="rounded-catalogue-lg border border-catalogue-border bg-catalogue-bg-muted p-5 sm:p-6">
            <p className="mb-3 font-semibold text-catalogue-text-primary">{job.title}</p>
            {buttons()}
          </div>
        )}
      </div>
    </section>
  );
};

export default JobOpeningsComponent;
