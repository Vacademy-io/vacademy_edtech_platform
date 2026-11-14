import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Images, Check, MagicWand } from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { getLibraryByTheme, getLibraryBadge } from '../../-constants/badge-library';

/**
 * "Choose from Library" picker for the Badges & Rewards builder. Opens a dialog of
 * ready-made "Playful" tiered badges; selecting one stores its `lib:` token in the
 * badge's icon. Badge art is transparent-background, so each tile sits it on a soft
 * neutral stage that reads in both light and dark.
 */
export function BadgeLibraryPicker({
    value,
    onSelect,
}: {
    value: string;
    onSelect: (token: string) => void;
}) {
    const { t } = useTranslation('settingsBadgeLibraryPicker');
    const [open, setOpen] = useState(false);
    const groups = getLibraryByTheme();
    const current = getLibraryBadge(value);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    title={t('trigger.title')}
                    className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md border transition',
                        current
                            ? 'border-primary-300 bg-primary-50 text-primary-500'
                            : 'border-neutral-200 text-neutral-500 hover:border-primary-300 hover:bg-primary-50'
                    )}
                >
                    <Images className="size-4" weight={current ? 'fill' : 'regular'} />
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl gap-0 p-0">
                <DialogHeader className="border-b border-neutral-100 px-6 py-4">
                    <DialogTitle className="flex items-center gap-2">
                        <MagicWand className="size-5 text-primary-500" weight="fill" />
                        {t('dialog.title')}
                    </DialogTitle>
                    <p className="pt-1 text-sm text-neutral-500">{t('dialog.description')}</p>
                </DialogHeader>

                <ScrollArea className="max-h-96 px-6 py-5">
                    <div className="space-y-6">
                        {groups.map((group) => {
                            const preview =
                                group.badges.find((b) => b.tier === 'gold') ?? group.badges[0];
                            const hint = group.badges[0]?.description;
                            return (
                                <section key={group.theme} className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        {preview && (
                                            <span className="flex size-9 shrink-0 items-center justify-center">
                                                <img
                                                    src={preview.url}
                                                    alt=""
                                                    className="size-9 object-contain"
                                                />
                                            </span>
                                        )}
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-neutral-700">
                                                {group.themeLabel}
                                            </p>
                                            {hint && (
                                                <p className="truncate text-xs text-neutral-400">
                                                    {hint}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-5 gap-2 sm:gap-3">
                                        {group.badges.map((badge) => {
                                            const selected = value === badge.token;
                                            return (
                                                <button
                                                    key={badge.token}
                                                    type="button"
                                                    onClick={() => {
                                                        onSelect(badge.token);
                                                        setOpen(false);
                                                    }}
                                                    title={t('badgeOption.title', {
                                                        theme: group.themeLabel,
                                                        tier: badge.tier,
                                                    })}
                                                    className={cn(
                                                        'group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 transition',
                                                        selected
                                                            ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-100'
                                                            : 'border-neutral-200 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-sm'
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            'flex aspect-square w-full items-center justify-center rounded-lg p-1.5 transition',
                                                            selected
                                                                ? 'bg-white'
                                                                : 'bg-neutral-50 group-hover:bg-white'
                                                        )}
                                                    >
                                                        <img
                                                            src={badge.url}
                                                            alt={t('badgeOption.alt', {
                                                                theme: group.themeLabel,
                                                                tier: badge.tier,
                                                            })}
                                                            className="size-full object-contain"
                                                        />
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            'text-xs capitalize leading-none',
                                                            selected
                                                                ? 'font-medium text-primary-600'
                                                                : 'text-neutral-500'
                                                        )}
                                                    >
                                                        {badge.tier}
                                                    </span>
                                                    {selected && (
                                                        <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary-500 text-white">
                                                            <Check className="size-3" weight="bold" />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
