import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShareNetwork, Copy, Check, SpinnerGap } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import axios from "axios";
import { GET_OR_CREATE_SHORT_LINK } from "@/constants/urls";

interface ShareButtonProps {
    packageSessionId: string;
    destinationUrl: string;
    instituteId: string;
    title?: string; // Book title — used as hint for slug-based short codes
    className?: string;
    // Controls icon size and button padding for catalogue vs details page
    size?: "sm" | "md";
}

export const ShareButton: React.FC<ShareButtonProps> = ({
    packageSessionId,
    destinationUrl,
    instituteId,
    title,
    className = "",
    size = "sm",
}) => {
    const { t } = useTranslation("coursePlayerB");
    const [open, setOpen] = useState(false);
    const [shortUrl, setShortUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const fetchShortUrl = async () => {
        if (shortUrl) return; // already fetched, reuse
        setLoading(true);
        try {
            const res = await axios.post(GET_OR_CREATE_SHORT_LINK, {
                source: "PACKAGE_SESSION",
                sourceId: packageSessionId,
                destinationUrl,
                instituteId,
                shortCode: title || null, // used as hint for slug-based short code
            });
            setShortUrl(res.data.absoluteUrl);
        } catch {
            toast.error(t("shareButton.toast.linkError"), { duration: 2000 });
            setOpen(false);
        } finally {
            setLoading(false);
        }
    };

    const handleOpen = (next: boolean) => {
        setOpen(next);
        if (next) fetchShortUrl();
    };

    const handleCopy = async () => {
        if (!shortUrl) return;
        await navigator.clipboard.writeText(shortUrl);
        setCopied(true);
        toast.success(t("shareButton.toast.linkCopied"), { duration: 1500 });
        setTimeout(() => setCopied(false), 2000);
    };

    const handleWhatsApp = () => {
        if (!shortUrl) return;
        window.open(`https://wa.me/?text=${encodeURIComponent(shortUrl)}`, "_blank");
    };

    const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
    const btnSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";

    return (
        <Popover open={open} onOpenChange={handleOpen}>
            <PopoverTrigger asChild>
                <button
                    className={`flex items-center justify-center rounded-catalogue-md bg-white/90 backdrop-blur-sm shadow-sm border border-white/20 hover:bg-white transition-colors ${btnSize} ${className}`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t("shareButton.ariaLabel")}
                >
                    {loading ? (
                        <SpinnerGap className={`${iconSize} animate-spin text-gray-500`} />
                    ) : (
                        <ShareNetwork className={`${iconSize} text-gray-600`} />
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-48 p-2"
                side="bottom"
                align="end"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="justify-start gap-2 text-sm font-normal"
                        onClick={handleCopy}
                        disabled={!shortUrl}
                    >
                        {copied ? (
                            <Check className="h-4 w-4 text-green-500" />
                        ) : (
                            <Copy className="h-4 w-4" />
                        )}
                        {copied ? t("shareButton.copied") : t("shareButton.copyLink")}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="justify-start gap-2 text-sm font-normal"
                        onClick={handleWhatsApp}
                        disabled={!shortUrl}
                    >
                        {/* WhatsApp SVG icon */}
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-green-500" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        {t("shareButton.shareWhatsapp")}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};
