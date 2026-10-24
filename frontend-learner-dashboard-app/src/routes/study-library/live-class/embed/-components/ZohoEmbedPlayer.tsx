import React from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface ZohoEmbedPlayerProps {
    /** The statelessStart URL with signature & frameOrigin from the backend (provider_host_url) */
    providerHostUrl?: string | null;
    /** Fallback join URL — opens in a new tab if providerHostUrl is unavailable */
    meetingUrl?: string;
}

const ZohoEmbedPlayer: React.FC<ZohoEmbedPlayerProps> = ({
    providerHostUrl,
    meetingUrl = "",
}) => {
    const { t } = useTranslation("studyContent");
    // If we have the providerHostUrl (statelessStart with frameOrigin), embed it directly
    if (providerHostUrl) {
        return (
            <div className="relative w-full h-full flex-1 min-h-96 bg-black rounded-lg overflow-hidden">
                <iframe
                    title="Zoho Meeting AV SDK"
                    src={providerHostUrl}
                    className="absolute inset-0 w-full h-full"
                    style={{ border: 0 }}
                    allow="camera; microphone; clipboard-read; clipboard-write"
                />
            </div>
        );
    }

    // Fallback: no providerHostUrl — show join button with generic meetingUrl
    if (!meetingUrl) {
        return (
            <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
                {t("liveClass.noMeetingUrl")}
            </div>
        );
    }

    return (
        <div className="relative w-full h-full flex-1 min-h-96 flex flex-col items-center justify-center gap-4 bg-neutral-950 rounded-lg">
            <div className="flex flex-col items-center gap-stack text-center px-6">
                <div className="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center">
                    <ArrowSquareOut size={32} className="text-primary-400" />
                </div>
                <h3 className="text-white text-xl font-semibold">Zoho Meeting</h3>
                <p className="text-neutral-400 text-sm max-w-xs">
                    {t("liveClass.zohoClickToJoin")}
                </p>
                <button
                    className="mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary-500 hover:bg-primary-600 text-white font-medium text-sm transition-colors"
                    onClick={() => window.open(meetingUrl, "_blank", "noopener,noreferrer")}
                >
                    {t("liveClass.joinMeeting")}
                    <ArrowSquareOut size={16} weight="bold" />
                </button>
            </div>
        </div>
    );
};

export default ZohoEmbedPlayer;
