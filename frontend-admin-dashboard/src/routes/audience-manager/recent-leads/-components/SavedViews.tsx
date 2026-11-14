import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BookmarkSimple, Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

const BASE = '/audience-manager/recent-leads';
const MAX_VIEWS = 12;
/** Route-owned params (sub-tabs); a saved view never carries them. */
const ROUTE_OWNED = ['lock', 'duplicates'];

interface SavedView {
    id: string;
    name: string;
    /** The list's own URL search params: every filter, the range and the search. */
    params: Record<string, string>;
}

const storageKey = () => {
    const token = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
    const userId = (token?.user as string | undefined) ?? 'anon';
    return `crm-saved-views:recent-leads:${getCurrentInstituteId() ?? ''}:${userId}`;
};
const read = (key: string): SavedView[] => {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(v) ? v.filter((x) => x && x.id && x.name && x.params) : [];
    } catch {
        return [];
    }
};
const clean = (search: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    Object.keys(search)
        .filter((k) => !ROUTE_OWNED.includes(k) && search[k] !== undefined && search[k] !== '')
        .sort()
        .forEach((k) => {
            out[k] = String(search[k]);
        });
    return out;
};
const sameParams = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(a) === JSON.stringify(b);

/**
 * Recent Leads: save the current filters as a named view and open it again
 * in one click. Views live in this browser, per person and institute — nothing is
 * stored on the server and nothing extra is fetched.
 */
export function SavedViews() {
    const { t } = useTranslation('crmPages');
    const navigate = useNavigate();
    const location = useLocation();
    const [key] = useState(storageKey);
    const [views, setViews] = useState<SavedView[]>(() => read(key));
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const current = clean((location.search ?? {}) as Record<string, unknown>);

    useEffect(() => {
        localStorage.setItem(key, JSON.stringify(views));
    }, [key, views]);

    const save = useCallback(() => {
        const n = name.trim();
        if (!n) return;
        setViews((v) =>
            [{ id: `${Date.now()}`, name: n.slice(0, 40), params: current }, ...v].slice(
                0,
                MAX_VIEWS
            )
        );
        setName('');
        setOpen(false);
    }, [name, current]);

    const apply = (v: SavedView) => {
        void navigate({ to: BASE as never, search: v.params as never });
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-neutral-500">
                <BookmarkSimple size={14} />
                <span className="text-caption">{t('savedViews.label')}</span>
            </span>
            {views.length === 0 && (
                <span className="text-neutral-400">
                    <span className="text-caption">{t('savedViews.none')}</span>
                </span>
            )}
            {views.map((v) => (
                <span
                    key={v.id}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 transition-colors',
                        sameParams(v.params, current)
                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                            : 'border-neutral-200 bg-white text-neutral-700 hover:border-primary-300'
                    )}
                >
                    <button type="button" onClick={() => apply(v)} title={v.name}>
                        <span className="text-caption">{v.name}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setViews((all) => all.filter((x) => x.id !== v.id))}
                        aria-label={t('savedViews.remove', { name: v.name })}
                        className="rounded-full p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    >
                        <X size={10} />
                    </button>
                </span>
            ))}
            <MyDialog
                open={open}
                onOpenChange={setOpen}
                heading={t('savedViews.dialogTitle')}
                dialogWidth="max-w-md"
                trigger={
                    <MyButton buttonType="text" scale="small" disable={views.length >= MAX_VIEWS}>
                        <Plus size={12} />
                        {t('savedViews.save')}
                    </MyButton>
                }
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setOpen(false)}
                        >
                            {t('savedViews.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={!name.trim()}
                            onClick={save}
                        >
                            {t('savedViews.confirm')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-2 p-4">
                    <p className="text-neutral-600">
                        <span className="text-caption">{t('savedViews.hint')}</span>
                    </p>
                    <MyInput
                        inputType="text"
                        input={name}
                        onChangeFunction={(e) => setName(e.target.value)}
                        inputPlaceholder={t('savedViews.placeholder')}
                        className="w-full"
                        size="large"
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') save();
                        }}
                    />
                </div>
            </MyDialog>
        </div>
    );
}
