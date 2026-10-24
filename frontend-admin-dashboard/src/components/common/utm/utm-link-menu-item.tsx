import { useTranslation } from 'react-i18next';
import { LinkSimple } from '@phosphor-icons/react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';

export interface UtmLinkMenuItemProps {
    /** Opens the builder. The dialog itself is rendered by the parent. */
    onSelect: () => void;
    /** Hidden when the surface has no shareable link yet (unsaved, no code…). */
    hidden?: boolean;
    className?: string;
}

/**
 * "Generate UTM link" entry for a share surface's ⋮ menu.
 *
 * Renders NOTHING unless the institute has switched the UTM builder on in
 * Settings → GTM & UTM. Six surfaces carry this item, so the gate lives here
 * rather than being re-implemented (and eventually mis-implemented) at each.
 *
 * The dialog is deliberately NOT rendered here: a Radix dropdown unmounts its
 * content on close, which would take the dialog with it the instant the item
 * is chosen. Parents keep the open state and render {@link UtmBuilderDialog}
 * as a sibling of the DropdownMenu — the same shape the QR and embed dialogs
 * already use on the audience card.
 */
export function UtmLinkMenuItem({ onSelect, hidden, className }: UtmLinkMenuItemProps) {
    const { t } = useTranslation('commonUtmBuilder');
    const { enabled } = useUtmBuilderEnabled();

    if (!enabled || hidden) return null;

    return (
        // stopPropagation, because several of the six surfaces render this menu
        // inside a CLICKABLE CARD (the assessment row navigates to the detail
        // page on click). Without it the click bubbles to the card, the route
        // changes, and the dialog unmounts before the admin ever sees it.
        <DropdownMenuItem
            className={className ?? 'cursor-pointer'}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
        >
            <LinkSimple className="mr-2 size-4" />
            {t('menuItem')}
        </DropdownMenuItem>
    );
}

export default UtmLinkMenuItem;
