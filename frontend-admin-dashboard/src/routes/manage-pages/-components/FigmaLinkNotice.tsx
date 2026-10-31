import { WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * Shown where the AI page wizard is given a figma.com link (reference site,
 * rebuild URL, intake chat). Nothing here can open Figma: the link is kept out
 * of the request, and the admin is pointed at the two routes that work —
 * screenshots of the frames, or Claude with the Figma connector and the
 * Vacademy MCP (which follows the design playbook).
 */
export const FigmaLinkNotice = ({ className = '' }: { className?: string }) => {
    const { t } = useTranslation('managePagesAiPageWizard');
    return (
        <div
            role="note"
            data-testid="figma-link-notice"
            className={`flex gap-2 rounded-lg border border-warning-200 bg-warning-50 p-2.5 ${className}`}
        >
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" weight="fill" />
            <p className="text-caption text-neutral-700">{t('figmaLink.message')}</p>
        </div>
    );
};
