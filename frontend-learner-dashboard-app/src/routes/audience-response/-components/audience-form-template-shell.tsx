/**
 * The page body for every `formAppearance.template` except `standard`.
 *
 * The response form hands over its already-built pieces — heading block, form
 * card and footer note — and this only decides where they sit and what is
 * painted behind them. The form card itself (fields, validation, submit) is
 * the same component for every template, so a template can never change what
 * a visitor is asked or what gets submitted.
 */
import { useEffect, useState, type ReactNode } from "react";
import { getPublicUrl } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/excalidrawUtils";
import { cn } from "@/lib/utils";
import type { ShellTemplate } from "../-utils/form-template-styles";

interface AudienceFormTemplateShellProps {
  template: ShellTemplate;
  /** Content column width from the template's look. */
  columnClass: string;
  /** Painted behind the heading by banner / split / framed. Blank = brand colour. */
  coverImageUrl: string;
  /** The institute logo's file id, drawn behind the form by `logo`. */
  logoFileId?: string | null;
  /** Null when every heading block is switched off. */
  hero: ReactNode | null;
  formCard: ReactNode;
  footer: ReactNode;
}

/**
 * What sits behind a heading on a brand-coloured surface: the cover image under
 * a dark scrim when there is one, else two soft rings so a flat brand colour
 * does not read as an empty box. The parent must be `relative` and clip.
 */
const BrandBackdrop = ({ coverImageUrl }: { coverImageUrl: string }) => {
  // A dead URL falls back to the rings — the scrim alone would just muddy the
  // brand colour.
  const [failedUrl, setFailedUrl] = useState("");
  if (coverImageUrl && failedUrl !== coverImageUrl) {
    return (
      <>
        <img
          src={coverImageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedUrl(coverImageUrl)}
        />
        <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      </>
    );
  }
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-white/5"
      />
    </>
  );
};

/**
 * The institute logo, large and faded, centred behind the form. The image
 * itself is NOT blurred — the card's light backdrop blur is the only
 * softening, so the logo reads crisply around the form and gently behind it. Same
 * resolver as the header's InstituteBrandingComponent (its response is cached),
 * so this costs no extra round trip. No logo, or one that fails to resolve or
 * load, falls back to a soft brand-colour glow so the page is never bare.
 */
const LogoBackdrop = ({ logoFileId }: { logoFileId?: string | null }) => {
  const [logoUrl, setLogoUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLogoUrl("");
    setFailed(false);
    if (!logoFileId) return;
    getPublicUrl(logoFileId)
      .then((url) => {
        if (!cancelled) setLogoUrl(typeof url === "string" ? url : "");
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [logoFileId]);

  if (logoUrl && !failed) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center p-page"
      >
        <img
          src={logoUrl}
          alt=""
          // multiply: a logo saved on a white (JPG) background drops that
          // background instead of showing a pale box behind the form.
          className="max-h-full w-4/5 max-w-3xl object-contain opacity-50 mix-blend-multiply"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-10 size-96 rounded-full bg-primary-300 opacity-30 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-1/3 size-96 rounded-full bg-primary-200 opacity-40 blur-3xl"
      />
    </>
  );
};

export const AudienceFormTemplateShell = ({
  template,
  columnClass,
  coverImageUrl,
  logoFileId,
  hero,
  formCard,
  footer,
}: AudienceFormTemplateShellProps) => {
  switch (template) {
    case "banner":
      return (
        <>
          <section className="relative overflow-hidden bg-primary-500">
            <BrandBackdrop coverImageUrl={coverImageUrl} />
            <div
              className={cn(
                "relative mx-auto w-full px-page pb-28 pt-10 sm:pb-36 sm:pt-14",
                columnClass
              )}
            >
              {hero}
            </div>
          </section>
          <main className="px-page pb-12">
            <div className={cn("relative mx-auto -mt-20 w-full sm:-mt-28", columnClass)}>
              {formCard}
              {footer}
            </div>
          </main>
        </>
      );

    case "split":
      return (
        // No min-h-screen here: useEmbedHeight reports the sum of the page's
        // children, so a viewport-tall child inside an auto-sized iframe would
        // grow the frame by the header's height on every report.
        <div className={cn(hero && "lg:grid lg:grid-cols-12")}>
          {hero && (
            // lg:overflow-clip, not hidden: hidden makes the panel a scroll
            // container and the sticky heading inside it stops sticking. Below
            // lg nothing is sticky, and `hidden` also clips on Safari < 16,
            // which ignores `clip` and would scroll the page sideways.
            <aside className="relative overflow-hidden bg-primary-500 lg:col-span-5 lg:overflow-clip">
              <BrandBackdrop coverImageUrl={coverImageUrl} />
              <div className="relative px-page py-10 sm:py-14 lg:sticky lg:top-16 lg:px-10 lg:py-16">
                {hero}
              </div>
            </aside>
          )}
          <main className="px-page py-8 sm:py-12 lg:col-span-7 lg:px-12">
            <div className="mx-auto w-full max-w-xl">
              {formCard}
              {footer}
            </div>
          </main>
        </div>
      );

    case "framed":
      return (
        <main className="px-page py-8 sm:py-12">
          <div
            className={cn(
              "mx-auto w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl",
              columnClass
            )}
          >
            {hero && (
              <div className="relative overflow-hidden bg-primary-500">
                <BrandBackdrop coverImageUrl={coverImageUrl} />
                <div className="relative px-6 py-8 sm:px-8 sm:py-10">{hero}</div>
              </div>
            )}
            {formCard}
          </div>
          {footer}
        </main>
      );

    case "minimal":
      return (
        <main className="px-page py-10 sm:py-16">
          <div className={cn("mx-auto flex w-full flex-col gap-8", columnClass)}>
            {hero}
            {hero && <hr className="border-border" />}
            {formCard}
            {footer}
          </div>
        </main>
      );

    case "gradient":
      return (
        <main className="relative overflow-hidden px-page py-10 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-white/15 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 top-1/3 size-96 rounded-full bg-white/10 blur-3xl"
          />
          <div className={cn("relative mx-auto flex w-full flex-col gap-section", columnClass)}>
            {hero}
            <div>
              {formCard}
              {footer}
            </div>
          </div>
        </main>
      );

    case "dark":
      return (
        // Same overflow split as the split panel: the heading is sticky on lg.
        <main className="relative overflow-hidden px-page py-10 sm:py-16 lg:overflow-clip">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 size-96 -translate-x-1/2 rounded-full bg-primary-500 opacity-30 blur-3xl"
          />
          <div
            className={cn(
              "relative mx-auto grid w-full gap-section lg:grid-cols-12 lg:items-start",
              columnClass
            )}
          >
            {hero && <div className="lg:sticky lg:top-24 lg:col-span-5 lg:pt-6">{hero}</div>}
            <div className={hero ? "lg:col-span-7" : "lg:col-span-8 lg:col-start-3"}>
              {formCard}
              {footer}
            </div>
          </div>
        </main>
      );

    case "logo":
      return (
        <main className="relative overflow-hidden px-page py-10 sm:py-16">
          <LogoBackdrop logoFileId={logoFileId} />
          <div className={cn("relative mx-auto flex w-full flex-col gap-section", columnClass)}>
            {hero}
            <div>
              {formCard}
              {footer}
            </div>
          </div>
        </main>
      );
  }
};

export default AudienceFormTemplateShell;
