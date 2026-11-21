import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/design-system/states";

interface Props {
    message?: string;
    onRetry?: () => void;
}

/**
 * Backwards-compatible wrapper. Delegates to the canonical design-system
 * ErrorState (inline variant) so existing imports keep working while using
 * design tokens + Phosphor icons.
 */
export function InlineErrorState({ message, onRetry }: Props) {
    const { t } = useTranslation("courseComponentsExtra");
    return <ErrorState variant="inline" message={message ?? t("common.somethingWentWrong")} onRetry={onRetry} />;
}
