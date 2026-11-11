import { useId } from "react";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { ChevronIcon } from "./fun-icons";

/**
 * The institute's own dashboard card (the "custom" widget: a title, a line and a
 * link) in the Fun look: a plain card with one outline button. The link opens the
 * way the classic card opens it.
 */
export function FunCustomCard({
  title,
  subTitle,
  openLabel,
  onOpen,
}: {
  title: string;
  subTitle?: string | null;
  openLabel: string;
  onOpen?: () => void;
}) {
  const headingId = useId();
  return (
    <section className="fun-custom" aria-labelledby={headingId}>
      <h2 id={headingId} className="fun-custom__title">
        <bdi>{title}</bdi>
      </h2>
      {subTitle ? (
        <p className="fun-custom__text">
          <bdi>{subTitle}</bdi>
        </p>
      ) : null}
      {onOpen ? (
        <FunButton variant="outline" compact block className="fun-custom__cta" onClick={onOpen}>
          {openLabel}
          <ChevronIcon className="fun-custom__chevron" />
        </FunButton>
      ) : null}
    </section>
  );
}
