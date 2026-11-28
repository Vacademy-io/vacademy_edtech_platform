/**
 * Side-by-side comparison of a slide's SAVED content vs the CURRENT (unsaved,
 * browser-local) edits — so an author who stashed changes days ago can see
 * what they changed before deciding to save or discard.
 *
 * v1 is deliberately render-only (two sandboxed iframes, same pattern as the
 * version-history preview): no diff dependency, no highlight marks. If clients
 * still struggle to spot small edits, the planned upgrade is word-level
 * red/green highlighting on top of these panes.
 */
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface UnsavedCompareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Last saved content (data / published_data — whatever the editor loaded from). */
    savedHtml: string;
    /** The unsaved local draft content. */
    currentHtml: string;
}

const Pane = ({
    label,
    html,
    accent,
    emptyLabel,
}: {
    label: string;
    html: string;
    accent: string;
    emptyLabel: string;
}) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={`text-caption font-semibold uppercase tracking-wide ${accent}`}>{label}</p>
        {html ? (
            <iframe
                title={label}
                sandbox=""
                srcDoc={html}
                className="h-96 w-full rounded-md border border-neutral-200 bg-white"
            />
        ) : (
            <div className="flex h-96 w-full items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                <p className="text-body text-neutral-400">{emptyLabel}</p>
            </div>
        )}
    </div>
);

export const UnsavedCompareDialog = ({
    open,
    onOpenChange,
    savedHtml,
    currentHtml,
}: UnsavedCompareDialogProps) => {
    const { t } = useTranslation('studyLibraryUnsavedCompareDialog');
    if (!open) return null;
    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-5xl"
        >
            <div className="flex flex-col gap-3">
                <p className="text-caption text-neutral-500">
                    {t('description', {
                        slide: getTerminology(ContentTerms.Slide, SystemTerms.Slide).toLowerCase(),
                    })}
                </p>
                <div className="flex flex-col gap-3 md:flex-row">
                    <Pane
                        label={t('saved')}
                        html={savedHtml}
                        accent="text-neutral-500"
                        emptyLabel={t('noSavedVersion')}
                    />
                    <Pane
                        label={t('currentUnsaved')}
                        html={currentHtml}
                        accent="text-warning-600"
                        emptyLabel={t('noSavedVersion')}
                    />
                </div>
            </div>
        </MyDialog>
    );
};
