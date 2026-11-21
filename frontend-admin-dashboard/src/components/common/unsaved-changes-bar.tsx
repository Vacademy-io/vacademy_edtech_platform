import { useBlocker } from '@tanstack/react-router';
import { Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

/**
 * Wires up two leave-the-page guards while `dirty` is true:
 *
 *   1. TanStack Router's `useBlocker` — synchronously intercepts in-app
 *      navigation (sidebar clicks, programmatic `router.navigate`, browser
 *      back/forward) and shows a confirm dialog. Returning `true` from
 *      `shouldBlockFn` cancels the navigation; returning `false` lets it
 *      through.
 *   2. `enableBeforeUnload` — the router's built-in hook into the browser's
 *      `beforeunload` event, so tab close / refresh / full-page navigation
 *      also surface the browser-native "Leave site?" prompt.
 *
 * Pass the current dirty flag — both guards activate and deactivate
 * automatically as it flips.
 *
 * NOTE: `router.subscribe('onBeforeNavigate', ...)` (used elsewhere in the
 * codebase) only emits an event; it does not block. `useBlocker` is the
 * documented API for actually preventing navigation in v1.x.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
    useBlocker({
        shouldBlockFn: () => {
            if (!dirty) return false;
            const ok = window.confirm(
                'You have unsaved changes. Are you sure you want to leave this page?'
            );
            // shouldBlockFn returns true to block the navigation. When the
            // user clicks Cancel on the confirm we want to stay, so block;
            // when they click OK we want to let the navigation through.
            return !ok;
        },
        enableBeforeUnload: dirty,
    });
}

interface UnsavedChangesBarProps {
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    /**
     * Revert local edits to the last loaded/saved state. Optional — if
     * omitted, the Discard button is hidden.
     */
    onDiscard?: () => void;
    saveLabel?: string;
    discardLabel?: string;
    message?: string;
}

/**
 * Sticky toolbar pinned to the bottom of the viewport that appears only
 * while there are unsaved changes. Drop it once at the bottom of any long
 * settings page; pair with `useUnsavedChangesGuard` (called internally
 * already, no extra wiring needed).
 */
export function UnsavedChangesBar({
    dirty,
    saving,
    onSave,
    onDiscard,
    saveLabel = 'Save now',
    discardLabel = 'Discard',
    message = 'You have unsaved changes',
}: UnsavedChangesBarProps) {
    useUnsavedChangesGuard(dirty);

    if (!dirty) return null;

    return (
        <div
            data-assistant-fab="avoid-phone"
            role="region"
            aria-label="Unsaved changes"
            // Compact floating pill anchored to the bottom-CENTRE of the
            // viewport. Bottom-right would collide with the global chat/AI
            // widget that lives in that corner; bottom-left would crowd the
            // sidebar. Centring avoids both and reads as an intentional
            // action bar.
            className="animate-in slide-in-from-bottom-2 fade-in fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-200 bg-white/95 px-2 py-1.5 pl-4 shadow-xl backdrop-blur duration-200"
        >
            <div className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-amber-900">
                <Warning className="size-4 shrink-0 text-amber-600" weight="fill" />
                {message}
            </div>
            <div className="ml-2 flex items-center gap-1">
                {onDiscard && (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={onDiscard}
                        disable={saving}
                    >
                        {discardLabel}
                    </MyButton>
                )}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="small"
                    onClick={onSave}
                    disable={saving}
                    className="!rounded-full"
                >
                    {saving ? 'Saving…' : saveLabel}
                </MyButton>
            </div>
        </div>
    );
}
