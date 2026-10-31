import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getFilePublicUrlQuery } from "@/services/file-url-cache";

function initials(name?: string | null): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return (
        (parts[0]?.[0] ?? "").concat(parts.length > 1 ? (parts[1]?.[0] ?? "") : "").toUpperCase() ||
        "?"
    );
}

/**
 * Mentor avatar: profile photo when one is set, initials otherwise. Resolves the
 * media-service file id through the shared public-URL cache.
 */
export function MentorAvatar({
    fileId,
    name,
    className,
}: {
    fileId?: string | null;
    name?: string | null;
    className?: string;
}) {
    const { t } = useTranslation("miscRoutesA");
    const { data: url } = useQuery(getFilePublicUrlQuery(fileId ?? null));
    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 font-semibold text-primary-600",
                className
            )}
        >
            {url ? (
                <img
                    src={url}
                    alt={name || t("myMentors.common.mentor")}
                    className="size-full object-cover"
                />
            ) : (
                initials(name)
            )}
        </div>
    );
}
