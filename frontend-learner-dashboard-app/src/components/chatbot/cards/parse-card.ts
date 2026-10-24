import type {
  CardIcon,
  CardLinkItem,
  ChatCardData,
  FlashcardItem,
  ProgressCardItem,
  StepsCardItem,
} from "../types";

/** A card is a glance, not a page; the markdown fallback carries the rest. */
const MAX_ITEMS = 20;

const CARD_ICONS: ReadonlySet<string> = new Set<CardIcon>([
  "course",
  "slide",
  "video",
  "pdf",
  "quiz",
  "question",
  "live",
  "assessment",
  "link",
]);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const parseLinkItem = (raw: unknown): CardLinkItem | null => {
  const item = asRecord(raw);
  const title = item && text(item.title);
  if (!item || !title) return null;
  const icon = text(item.icon);
  return {
    title,
    subtitle: text(item.subtitle),
    href: text(item.href),
    icon: icon && CARD_ICONS.has(icon) ? (icon as CardIcon) : undefined,
    badge: text(item.badge),
  };
};

const parseProgressItem = (raw: unknown): ProgressCardItem | null => {
  const item = asRecord(raw);
  const title = item && text(item.title);
  if (!item || !title) return null;
  const percent =
    typeof item.percent === "number" || typeof item.percent === "string"
      ? Number(item.percent)
      : NaN;
  if (!Number.isFinite(percent)) return null;
  return {
    title,
    percent: clampPercent(percent),
    subtitle: text(item.subtitle),
    href: text(item.href),
  };
};

const parseStepItem = (raw: unknown): StepsCardItem | null => {
  const item = asRecord(raw);
  const title = item && text(item.title);
  const body = item && text(item.body);
  if (!item || (!title && !body)) return null;
  return { title: title ?? "", body: body ?? "" };
};

const parseFlashcard = (raw: unknown): FlashcardItem | null => {
  const item = asRecord(raw);
  const front = item && text(item.front);
  const back = item && text(item.back);
  if (!item || !front || !back) return null;
  return { front, back };
};

/**
 * Validates card data from the stream. Returns null for an unknown kind or
 * data with nothing renderable, and the caller shows the markdown fallback.
 */
export const parseCard = (raw: unknown): ChatCardData | null => {
  const card = asRecord(raw);
  if (!card || !Array.isArray(card.items)) return null;
  const title = text(card.title);

  if (card.kind === "link_list") {
    const items = card.items
      .map(parseLinkItem)
      .filter((i): i is CardLinkItem => i !== null)
      .slice(0, MAX_ITEMS);
    return items.length ? { kind: "link_list", title, items } : null;
  }

  if (card.kind === "progress") {
    const items = card.items
      .map(parseProgressItem)
      .filter((i): i is ProgressCardItem => i !== null)
      .slice(0, MAX_ITEMS);
    return items.length ? { kind: "progress", title, items } : null;
  }

  if (card.kind === "steps") {
    const items = card.items
      .map(parseStepItem)
      .filter((i): i is StepsCardItem => i !== null)
      .slice(0, MAX_ITEMS);
    return items.length ? { kind: "steps", title, items } : null;
  }

  if (card.kind === "flashcards") {
    const items = card.items
      .map(parseFlashcard)
      .filter((i): i is FlashcardItem => i !== null)
      .slice(0, MAX_ITEMS);
    return items.length ? { kind: "flashcards", title, items } : null;
  }

  return null;
};
