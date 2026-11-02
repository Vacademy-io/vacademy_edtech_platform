import type { BlogTemplate } from "../-services/blog-service";

export const BLOG_TEMPLATES: BlogTemplate[] = ["CLASSIC", "SIDEBAR_TOC", "MAGAZINE", "FOCUS", "FULL_WIDTH"];

const isBlogTemplate = (raw: unknown): raw is BlogTemplate => BLOG_TEMPLATES.includes(raw as BlogTemplate);

/**
 * The layout an article opens in: the blog section's `articleTemplate` when it
 * names one (so every post on that section looks alike, later posts too), else
 * the post's own, else Classic.
 */
export const resolveBlogTemplate = (sectionTemplate: unknown, postTemplate: unknown): BlogTemplate =>
  isBlogTemplate(sectionTemplate) ? sectionTemplate : isBlogTemplate(postTemplate) ? postTemplate : "CLASSIC";
