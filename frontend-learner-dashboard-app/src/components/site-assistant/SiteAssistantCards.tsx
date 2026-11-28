import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  Broadcast,
  CalendarBlank,
  Envelope,
  MapPin,
  Megaphone,
  Phone,
  SignIn,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AssistantLink } from "./AssistantLink";
import { ContactFormCard } from "./ContactFormCard";
import type { CourseCardData, LiveClassItem, SiteAssistantCard } from "./types";

/**
 * The SPEC §4.4 cards, drawn with the site's own tokens: catalogue surfaces
 * and ink, the opt-in site palette (palette-* falls back to the catalogue
 * token when the site has none) and the brand primary for calls to action —
 * so the assistant reads as part of the institute's site, not a widget on it.
 */

const cardShell = "min-w-0 max-w-full break-words rounded-catalogue-lg border border-palette-border bg-catalogue-bg-elevated text-palette-text";
const ctaLink =
  "inline-flex items-center gap-1 text-sm font-semibold text-catalogue-brand-ink no-underline hover:underline underline-offset-2";
const chip = "rounded-full bg-palette-cream px-2 py-0.5 text-xs text-palette-body";

const useFormatDate = () => {
  const { i18n } = useTranslation();
  return (iso: string, withTime: boolean) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        weekday: withTime ? "short" : undefined,
        day: "numeric",
        month: "short",
        ...(withTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { year: "numeric" }),
      }).format(d);
    } catch {
      return d.toLocaleString(i18n.language || "en");
    }
  };
};

const CourseRow: React.FC<{ course: CourseCardData; compact?: boolean }> = ({ course, compact }) => {
  const { t } = useTranslation("siteAssistant");
  const meta = [...(course.format_labels ?? []), ...(course.languages ?? [])].slice(0, 3);
  return (
    <div className={cn(cardShell, "flex gap-3 p-3")} data-card="course">
      {course.image_url ? (
        <img
          src={course.image_url}
          alt=""
          loading="lazy"
          className="size-16 shrink-0 rounded-catalogue-md bg-palette-cream object-cover"
        />
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-catalogue-md bg-palette-cream text-palette-muted">
          <BookOpen className="size-6" aria-hidden="true" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <AssistantLink href={course.url} className="line-clamp-2 text-sm font-semibold text-palette-text no-underline hover:underline">
          {course.title}
        </AssistantLink>
        {course.subtitle && !compact && <p className="line-clamp-2 text-xs text-palette-body">{course.subtitle}</p>}
        {(meta.length > 0 || (course.badges ?? []).length > 0) && (
          <div className="flex flex-wrap gap-1">
            {(course.badges ?? []).map((b) => (
              <span key={`b-${b}`} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-catalogue-brand-ink">
                {b}
              </span>
            ))}
            {meta.map((m) => (
              <span key={`m-${m}`} className={chip}>
                {m}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-sm font-semibold text-palette-text">{course.price_label}</span>
          <AssistantLink href={course.url} className={ctaLink}>
            {t("cards.viewCourse")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </AssistantLink>
        </div>
        {course.availability && <p className="text-xs text-palette-muted">{course.availability}</p>}
      </div>
    </div>
  );
};

const LiveClassRow: React.FC<{ item: LiveClassItem }> = ({ item }) => {
  const { t } = useTranslation("siteAssistant");
  const format = useFormatDate();
  return (
    <li className="flex flex-col gap-1 border-b border-palette-border py-2 last:border-b-0">
      <span className="text-sm font-semibold">{item.title}</span>
      <span className="flex items-center gap-1 text-xs text-palette-body">
        <CalendarBlank className="size-4 shrink-0" aria-hidden="true" />
        <time dateTime={item.starts_at}>{format(item.starts_at, true)}</time>
      </span>
      <div className="flex items-center justify-between gap-2">
        <span className={chip}>{item.is_paid ? item.price_label || t("cards.paid") : t("cards.free")}</span>
        {item.registration_url && (
          <AssistantLink href={item.registration_url} className="catalogue-btn catalogue-btn-primary catalogue-btn-sm no-underline">
            {t("cards.register")}
          </AssistantLink>
        )}
      </div>
    </li>
  );
};

const emailHref = (v: string) => (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? `mailto:${v}` : null);
const telHref = (v: string) => {
  const digits = v.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? `tel:${digits}` : null;
};
const waHref = (v: string) => {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
};

const ContactRow: React.FC<{ icon: React.ReactNode; label: string; value: string; href: string | null; external?: boolean }> = ({
  icon,
  label,
  value,
  href,
  external,
}) => (
  <li className="flex items-start gap-2 text-sm">
    <span className="mt-0.5 shrink-0 text-palette-muted">{icon}</span>
    <span className="sr-only">{label}: </span>
    {href ? (
      <a
        href={href}
        className="break-all font-medium text-catalogue-brand-ink no-underline hover:underline"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {value}
      </a>
    ) : (
      <span className="text-palette-body">{value}</span>
    )}
  </li>
);

export const SiteAssistantCardView: React.FC<{ card: SiteAssistantCard; cardKey: string }> = ({ card, cardKey }) => {
  const { t } = useTranslation("siteAssistant");
  const format = useFormatDate();

  switch (card.type) {
    case "course":
      return <CourseRow course={card} />;

    case "course_list":
      return (
        <div className="flex min-w-0 flex-col gap-2" data-card="course_list">
          {card.items.map((c) => (
            <CourseRow key={c.id} course={c} compact />
          ))}
          {card.more_url && (
            <AssistantLink href={card.more_url} className={cn(ctaLink, "self-start")}>
              {t("cards.seeAll")}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </AssistantLink>
          )}
        </div>
      );

    case "compare":
      return (
        <div className={cn(cardShell, "overflow-x-auto")} data-card="compare">
          <table className="w-full border-collapse text-start text-xs">
            <caption className="sr-only">{t("cards.compare")}</caption>
            <thead>
              <tr className="bg-palette-cream">
                <th scope="col" className="p-2 text-start font-medium text-palette-muted">
                  <span className="sr-only">{t("cards.compare")}</span>
                </th>
                {card.courses.map((c) => (
                  <th key={c.id} scope="col" className="p-2 text-start align-top font-semibold">
                    <AssistantLink href={c.url} className="text-palette-text no-underline hover:underline">
                      {c.title}
                    </AssistantLink>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row) => (
                <tr key={row.label} className="border-t border-palette-border">
                  <th scope="row" className="p-2 text-start align-top font-medium text-palette-muted">
                    {row.label}
                  </th>
                  {card.courses.map((c, i) => (
                    <td key={c.id} className="p-2 align-top text-palette-body">
                      {row.values[i] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "path":
      return (
        <div className={cn(cardShell, "p-3")} data-card="path">
          <p className="mb-2 text-sm font-semibold">{card.name}</p>
          <ol className="flex flex-col gap-2">
            {card.steps.map((s, i) => (
              <li key={`${s.position}-${s.title}`} className="flex items-start gap-2">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-semibold text-primary-foreground"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="sr-only">{t("cards.step", { n: i + 1 })}: </span>
                  {s.url ? (
                    <AssistantLink href={s.url} className="text-sm font-medium text-palette-text no-underline hover:underline">
                      {s.title}
                    </AssistantLink>
                  ) : (
                    <span className="text-sm font-medium">{s.title}</span>
                  )}
                  {s.price_label && <span className="text-xs text-palette-muted">{s.price_label}</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      );

    case "page_link":
      return (
        <div className={cn(cardShell, "flex flex-col gap-2 p-3")} data-card="page_link">
          <p className="text-sm font-semibold">{card.title}</p>
          {card.snippet && <p className="line-clamp-3 text-xs text-palette-body">{card.snippet}</p>}
          <AssistantLink href={card.href} className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm self-start no-underline">
            {t("cards.takeMeThere")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </AssistantLink>
        </div>
      );

    case "live_class_list":
      return (
        <div className={cn(cardShell, "px-3 py-1")} data-card="live_class_list">
          <p className="flex items-center gap-1 pt-2 text-xs font-semibold uppercase tracking-wide text-palette-muted">
            <Broadcast className="size-4" aria-hidden="true" />
            {t("cards.liveClasses")}
          </p>
          <ul>
            {card.items.map((item) => (
              <LiveClassRow key={`${item.title}-${item.starts_at}`} item={item} />
            ))}
          </ul>
        </div>
      );

    case "notice":
      return (
        <div className={cn(cardShell, "flex gap-2 border-s-4 border-s-primary-500 p-3")} data-card="notice">
          <Megaphone className="mt-0.5 size-5 shrink-0 text-catalogue-brand-ink" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-semibold">{card.title}</p>
            <p className="whitespace-pre-line text-xs text-palette-body">{card.body}</p>
            {card.ends_at && (
              <p className="text-xs text-palette-muted">{t("cards.until", { date: format(card.ends_at, false) })}</p>
            )}
          </div>
        </div>
      );

    case "contact_info": {
      return (
        <div className={cn(cardShell, "p-3")} data-card="contact_info">
          <p className="mb-2 text-sm font-semibold">{t("cards.contactTitle")}</p>
          <ul className="flex flex-col gap-2">
            {card.phone && (
              <ContactRow icon={<Phone className="size-4" />} label={t("cards.phone")} value={card.phone} href={telHref(card.phone)} />
            )}
            {card.whatsapp && (
              <ContactRow
                icon={<WhatsappLogo className="size-4" />}
                label={t("cards.whatsapp")}
                value={card.whatsapp}
                href={waHref(card.whatsapp)}
                external
              />
            )}
            {card.email && (
              <ContactRow icon={<Envelope className="size-4" />} label={t("cards.email")} value={card.email} href={emailHref(card.email)} />
            )}
            {card.address && (
              <ContactRow icon={<MapPin className="size-4" />} label={t("cards.address")} value={card.address} href={null} />
            )}
          </ul>
          {card.login_url && (
            <AssistantLink href={card.login_url} className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-3 no-underline">
              <SignIn className="size-4" aria-hidden="true" />
              {t("cards.login")}
            </AssistantLink>
          )}
        </div>
      );
    }

    case "contact_form":
      return <ContactFormCard card={card} cardKey={cardKey} />;

    default:
      return null;
  }
};
