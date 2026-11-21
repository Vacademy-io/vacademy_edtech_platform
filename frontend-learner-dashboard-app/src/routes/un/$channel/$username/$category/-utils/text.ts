import type { TFunction } from "i18next";

export const formatCategoryTitle = (value: string | null | undefined, t: TFunction) => {
  if (!value) {
    return t("unsubscribe.generalUpdates");
  }

  return value
    .split(/[-_]/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(
      (segment) => segment[0]?.toUpperCase() + segment.slice(1).toLowerCase()
    )
    .join(" ");
};

export const normalizeCategoryKey = (value: string | null | undefined) => {
  if (!value) {
    return "GENERAL";
  }

  return value.toUpperCase().replace(/\s+/g, "_");
};

export const maskIdentifier = (value: string | null | undefined, t: TFunction) => {
  if (!value) {
    return t("unsubscribe.yourAccount");
  }

  const trimmed = value.trim();

  if (trimmed.includes("@")) {
    const [name, domain] = trimmed.split("@");
    if (!domain) {
      return `${name.slice(0, 2)}***`;
    }
    const visible = name.slice(0, Math.min(3, name.length));
    return `${visible}${name.length > 3 ? "***" : ""}@${domain}`;
  }

  if (trimmed.length <= 3) {
    return `${trimmed.slice(0, 1)}***`;
  }

  return `${trimmed.slice(0, 3)}***`;
};

