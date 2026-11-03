/**
 * Markup for the structured `{{course.*}}` tokens of an HTML course template.
 *
 * The admin fills plain text, lists and images in Add / Edit Course → Course page →
 * "Page template content" (stored in course_page_json.template), plus the FAQs and the
 * course's authors. A template cannot loop, so the cards / reviews / FAQs / instructors
 * are rendered here into fixed markup the template's CSS styles:
 *
 *   framework_html            h2, p…, div.course-framework-grid >
 *                               article.course-framework-card (span.course-card-number, h3, p, ul, p.course-card-takeaway)
 *   learning_experience_html  h2, p…, div.course-learning-grid > article.course-learning-card (h3, p),
 *                               div.course-callout
 *   testimonials_html         blockquote.course-testimonial (p.course-testimonial-quote, cite > span, p…)
 *   instructors_html          article.course-instructor (img, h3, p.course-instructor-role, div.course-instructor-bio)
 *   inclusions_html           h3, ul
 *   faqs_html                 div.course-faq-item (h3, div.course-faq-answer)
 *
 * `labels` are the template's own words (headings, button text) the admin types per course;
 * each becomes `{{course.label_<key>}}`.
 *
 * Plain text is escaped; rich text (FAQ answers, author bios, callout, enrolment
 * description) is the admin's editor HTML and goes through the page sanitiser with the
 * rest of the page. A section with nothing to show renders '' so `{{#course.x}}` hides it.
 */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Editor HTML with no visible text (TipTap's empty value is `<p></p>`). */
const blankHtml = (html: string): boolean =>
  !/<img\b/i.test(html) && html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim().length === 0;
const richOrEmpty = (v: unknown): string => {
  const html = str(v);
  return html && !blankHtml(html) ? html : "";
};

/** Plain text → paragraphs: a blank line starts a new one, a single newline is a line break. */
const paragraphs = (text: string, cls?: string): string =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const ul = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

export interface CourseTemplateContent {
  tagline: string;
  shortDescription: string;
  frameworkHtml: string;
  learningExperienceHtml: string;
  testimonialsHtml: string;
  enrolmentDescription: string;
  /** media-service id (or URL) — resolved by the host like the other image tokens. */
  enrolmentImage: string;
  inclusionsHtml: string;
  /** Label key → text, e.g. { about: "About the course" } → {{course.label_about}}. */
  labels: Record<string, string>;
}

const EMPTY: CourseTemplateContent = {
  tagline: "",
  shortDescription: "",
  frameworkHtml: "",
  learningExperienceHtml: "",
  testimonialsHtml: "",
  enrolmentDescription: "",
  enrolmentImage: "",
  inclusionsHtml: "",
  labels: {},
};

const readJson = (raw: unknown): Record<string, unknown> | null => {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const renderFramework = (fw: Record<string, unknown>): string => {
  const cards = list(fw.cards)
    .map((c, i) => {
      const title = str(c.title);
      const body = str(c.body);
      const points = strings(c.points);
      const takeaway = str(c.takeaway);
      if (!title && !body && !points.length && !takeaway) return "";
      return (
        `<article class="course-framework-card"><span class="course-card-number">${i + 1}</span>` +
        (title ? `<h3>${esc(title)}</h3>` : "") +
        paragraphs(body) +
        ul(points) +
        (takeaway ? `<p class="course-card-takeaway">${esc(takeaway)}</p>` : "") +
        `</article>`
      );
    })
    .filter(Boolean);
  const intro = paragraphs(str(fw.intro));
  if (!cards.length && !intro) return "";
  const heading = str(fw.heading);
  return (
    (heading ? `<h2>${esc(heading)}</h2>` : "") +
    intro +
    (cards.length ? `<div class="course-framework-grid">${cards.join("")}</div>` : "")
  );
};

const renderLearning = (le: Record<string, unknown>): string => {
  const cards = list(le.cards)
    .map((c) => {
      const title = str(c.title);
      const body = str(c.body);
      if (!title && !body) return "";
      return `<article class="course-learning-card">${title ? `<h3>${esc(title)}</h3>` : ""}${paragraphs(body)}</article>`;
    })
    .filter(Boolean);
  const intro = paragraphs(str(le.intro));
  const callout = richOrEmpty(le.callout);
  if (!cards.length && !intro && !callout) return "";
  const heading = str(le.heading);
  return (
    (heading ? `<h2>${esc(heading)}</h2>` : "") +
    intro +
    (cards.length ? `<div class="course-learning-grid">${cards.join("")}</div>` : "") +
    (callout ? `<div class="course-callout">${callout}</div>` : "")
  );
};

const renderTestimonials = (items: unknown): string =>
  list(items)
    .map((r) => {
      const quote = str(r.quote);
      const name = str(r.name);
      if (!quote || !name) return "";
      const details = str(r.details);
      return (
        `<blockquote class="course-testimonial">` +
        `<p class="course-testimonial-quote">${esc(quote)}</p>` +
        `<cite>${esc(name)}${details ? `<span>${esc(details)}</span>` : ""}</cite>` +
        paragraphs(str(r.review)) +
        `</blockquote>`
      );
    })
    .join("");

// Starts with a letter: token names only, never `__proto__` and the like.
const LABEL_KEY_RE = /^[a-z][a-z_]{0,39}$/;
const LABEL_MAX_LENGTH = 120;

const readLabels = (raw: unknown): Record<string, string> => {
  if (!isObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = str(value).slice(0, LABEL_MAX_LENGTH);
    if (LABEL_KEY_RE.test(key) && text) out[key] = text;
  }
  return out;
};

const renderInclusions = (inc: Record<string, unknown>): string => {
  const items = strings(inc.items);
  if (!items.length) return "";
  const heading = str(inc.heading);
  return `${heading ? `<h3>${esc(heading)}</h3>` : ""}${ul(items)}`;
};

/** course_page_json → the template tokens' values. Malformed input reads as empty. */
export const courseTemplateContent = (coursePageJson: unknown): CourseTemplateContent => {
  const data = readJson(coursePageJson);
  const t = data && isObject(data.template) ? data.template : null;
  if (!t) return EMPTY;
  const enrolment = isObject(t.enrolment) ? t.enrolment : {};
  return {
    tagline: str(t.tagline),
    shortDescription: str(t.short_description),
    frameworkHtml: renderFramework(isObject(t.framework) ? t.framework : {}),
    learningExperienceHtml: renderLearning(isObject(t.learning_experience) ? t.learning_experience : {}),
    testimonialsHtml: renderTestimonials(t.testimonials),
    enrolmentDescription: richOrEmpty(enrolment.description),
    enrolmentImage: str(enrolment.image_id),
    inclusionsHtml: renderInclusions(isObject(t.inclusions) ? t.inclusions : {}),
    labels: readLabels(t.labels),
  };
};

/** FAQs from course_page_json (admin "Course page" → FAQs). */
export const renderFaqsHtml = (coursePageJson: unknown): string => {
  const data = readJson(coursePageJson);
  return list(data?.faqs)
    .map((f) => {
      const q = str(f.q);
      const a = richOrEmpty(f.a);
      if (!q || !a) return "";
      return `<div class="course-faq-item"><h3>${esc(q)}</h3><div class="course-faq-answer">${a}</div></div>`;
    })
    .join("");
};

/** One author as the course page has them (see course-authors.ts). */
export interface TemplateInstructor {
  name: string;
  subtitle?: string;
  role?: string;
  /** Rich text from the author profile. */
  description?: string;
  profilePicId?: string;
}

/** Authors → instructor cards. `photos` maps a profile-pic id to its resolved URL. */
export const renderInstructorsHtml = (
  instructors: ReadonlyArray<TemplateInstructor> | null | undefined,
  photos: Record<string, string> = {},
): string =>
  (instructors ?? [])
    .map((inst) => {
      const name = str(inst.name);
      if (!name) return "";
      const photo = inst.profilePicId ? photos[inst.profilePicId] || "" : "";
      const role = str(inst.subtitle) || str(inst.role);
      const bio = richOrEmpty(inst.description);
      return (
        `<article class="course-instructor">` +
        (photo ? `<img src="${esc(photo)}" alt="${esc(name)}" loading="lazy">` : "") +
        `<h3>${esc(name)}</h3>` +
        (role ? `<p class="course-instructor-role">${esc(role)}</p>` : "") +
        (bio ? `<div class="course-instructor-bio">${bio}</div>` : "") +
        `</article>`
      );
    })
    .join("");

/** True when the markup lists instructors ({{course.instructors_html}}). */
export const usesInstructorsToken = (html: string): boolean => /\{\{\s*course\.instructors_html\s*\}\}/.test(html);

/** Profile-pic ids the instructor cards need resolved (only when the markup uses them). */
export const instructorPhotoIds = (
  html: string,
  instructors: ReadonlyArray<TemplateInstructor> | null | undefined,
): string[] =>
  usesInstructorsToken(html)
    ? [...new Set((instructors ?? []).map((i) => i.profilePicId || "").filter(Boolean))]
    : [];
