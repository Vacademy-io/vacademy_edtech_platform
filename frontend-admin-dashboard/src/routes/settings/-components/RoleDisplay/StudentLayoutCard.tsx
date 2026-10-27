import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowDown,
    ArrowUp,
    CircleNotch,
    Plus,
    Star,
    Trash,
    UploadSimple,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { STUDENT_NAV_ICONS, STUDENT_NAV_ICON_KEYS } from '@/constants/student-nav-icons';
import type {
    StudentBottomBarItem,
    StudentBottomBarStyle,
    StudentHeaderSettings,
    StudentLayoutDevice,
    StudentLayoutSettings,
    StudentNavPlacement,
    StudentSidebarTabConfig,
    StudentWallpaperSettings,
} from '@/types/student-display-settings';

const DEVICES: StudentLayoutDevice[] = ['mobile', 'tablet', 'desktop'];
const PLACEMENTS: StudentNavPlacement[] = ['auto', 'sidebar', 'bottomBar', 'both', 'rail'];
/** A left rail has no room on a phone (the learner app would show the bar). */
const placementsFor = (device: StudentLayoutDevice) =>
    device === 'mobile' ? PLACEMENTS.filter((p) => p !== 'rail') : PLACEMENTS;
const HEADER_KEYS: (keyof StudentHeaderSettings)[] = [
    'showLogo',
    'showPageTitle',
    'showBackHome',
    'showAchievements',
    'showLanguage',
    'showHelp',
    'showNotifications',
];
/** Learner routes offered as suggestions in the footer-tab route field. */
const KNOWN_ROUTES = [
    '/dashboard',
    '/study-library/courses',
    '/study-library/live-class',
    '/learning-centre/attendance',
    '/assessment/examination',
    '/assessment/reports',
    '/homework/list',
    '/referral',
    '/my-files',
    '/leaderboard',
];
/** Default icon for the built-in sidebar tabs when seeding the footer bar. */
const TAB_ICON: Record<string, string> = {
    dashboard: 'home',
    'learning-center': 'book',
    homework: 'notebook',
    'assessment-center': 'exam',
    referral: 'gift',
    attendance: 'calendar',
    planning: 'calendar',
};
const TAB_ROUTE: Record<string, string> = {
    dashboard: '/dashboard',
    referral: '/referral',
    attendance: '/learning-centre/attendance',
};

/** Footer tabs seeded from the visible sidebar tabs — what the bar shows today. */
export function seedBottomBarFromSidebar(tabs: StudentSidebarTabConfig[]): StudentBottomBarItem[] {
    return tabs
        .filter((tab) => tab.visible !== false)
        .map((tab, i) => ({
            id: tab.id,
            label: tab.label,
            route:
                tab.route ||
                TAB_ROUTE[tab.id] ||
                (tab.subTabs || []).find((s) => s.visible !== false)?.route ||
                '/dashboard',
            icon: TAB_ICON[tab.id],
            order: i + 1,
            visible: true,
        }));
}

/** Icon that fits a known learner page, for tabs left on the default icon. */
const ROUTE_ICONS: [RegExp, string][] = [
    [/live-class/, 'live'],
    [/attendance/, 'calendar'],
    [/assessment\/reports|my-reports|reports/, 'chart'],
    [/assessment|exam/, 'exam'],
    [/homework/, 'notebook'],
    [/courses|study-library/, 'books'],
    [/referral/, 'gift'],
    [/leaderboard/, 'trophy'],
    [/my-files|downloads/, 'files'],
    [/dashboard/, 'home'],
    [/^https?:\/\//, 'globe'],
];
const iconForRoute = (route: string) => ROUTE_ICONS.find(([re]) => re.test(route))?.[1];

const BAR_STYLES: StudentBottomBarStyle[] = ['classic', 'floating'];

/** Scale model of a phone bottom edge with the bar in that style. */
function BarStylePreview({ barStyle }: { barStyle: StudentBottomBarStyle }) {
    const floating = barStyle === 'floating';
    return (
        <div className="relative flex h-16 w-full items-end overflow-hidden rounded-md bg-neutral-100">
            <div
                className={cn(
                    'flex w-full items-center justify-around bg-white py-2',
                    floating
                        ? 'mx-2 mb-2 rounded-xl border border-neutral-200 shadow-md'
                        : 'border-t border-neutral-200'
                )}
            >
                <span className="size-2 rounded-full bg-neutral-300" />
                <span className="size-2 rounded-full bg-neutral-300" />
                <span className="-mt-5 size-6 rounded-full bg-primary-500 ring-2 ring-white" />
                <span className="size-2 rounded-full bg-neutral-300" />
                <span className="size-2 rounded-full bg-neutral-300" />
            </div>
        </div>
    );
}

function IconPreview({ item }: { item: StudentBottomBarItem }) {
    if (item.iconUrl) {
        return <img src={item.iconUrl} alt="" className="size-5 object-contain" />;
    }
    const PhIcon = item.icon ? STUDENT_NAV_ICONS[item.icon] : undefined;
    if (PhIcon) return <PhIcon className="size-5" />;
    return (
        <span className="text-caption font-semibold">
            {(item.label || item.id || '?').charAt(0).toUpperCase()}
        </span>
    );
}

interface StudentLayoutCardProps {
    value: StudentLayoutSettings | undefined;
    onChange: (next: StudentLayoutSettings) => void;
    sidebarTabs: StudentSidebarTabConfig[];
}

export function StudentLayoutCard({ value, onChange, sidebarTabs }: StudentLayoutCardProps) {
    const { t } = useTranslation('settingsStudentDisplay');
    const layout = value ?? {};
    const { uploadFile, getPublicUrl } = useFileUpload();
    const [uploading, setUploading] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ key: string; apply: (url: string) => void } | null>(null);

    // Edits build on the LATEST layout, not this render's: an upload finishes
    // after its click handler's render is gone, and must not undo what the
    // admin changed meanwhile (or a second upload's icon).
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const sortedItems = (l: StudentLayoutSettings) =>
        [...(l.bottomBar?.items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const set = (patch: Partial<StudentLayoutSettings>) =>
        onChange({ ...layoutRef.current, ...patch });
    const bottomItems = sortedItems(layout);
    const customBar = bottomItems.length > 0;
    const wallpaper: StudentWallpaperSettings = layout.wallpaper ?? {};

    const setItems = (items: StudentBottomBarItem[]) =>
        set({
            bottomBar: {
                ...layoutRef.current.bottomBar,
                items: items.map((item, i) => ({ ...item, order: i + 1 })),
            },
        });
    const patchItem = (id: string, patch: Partial<StudentBottomBarItem>) =>
        setItems(
            sortedItems(layoutRef.current).map((item) =>
                item.id === id ? { ...item, ...patch } : item
            )
        );
    const moveItem = (index: number, dir: -1 | 1) => {
        const next = [...bottomItems];
        const target = index + dir;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target]!, next[index]!];
        setItems(next);
    };
    const setWallpaper = (patch: Partial<StudentWallpaperSettings>) =>
        set({ wallpaper: { ...(layoutRef.current.wallpaper ?? {}), ...patch } });

    const pickImage = (key: string, onUrl: (url: string) => void) => {
        // `uploading` is set once a file is actually chosen — a cancelled
        // file dialog fires no event, so setting it here could stick.
        uploadTargetRef.current = { key, apply: onUrl };
        fileInputRef.current?.click();
    };
    const onFileChosen = async (file: File | undefined) => {
        const target = uploadTargetRef.current;
        if (!file || !target) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('layoutBuilder.upload.notImage'));
            return;
        }
        setUploading(target.key);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'STUDENT_DISPLAY_LAYOUT',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            const url = fileId ? await getPublicUrl(fileId as string) : '';
            if (!url) throw new Error('no url');
            target.apply(url);
        } catch {
            toast.error(t('layoutBuilder.upload.failed'));
        } finally {
            setUploading(null);
            uploadTargetRef.current = null;
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('layoutBuilder.cardTitle')}</CardTitle>
                <CardDescription>{t('layoutBuilder.cardDescription')}</CardDescription>
            </CardHeader>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
            <div className="space-y-8 p-4 pt-0">
                {/* Navigation placement per device */}
                <section className="space-y-3">
                    <div>
                        <h4 className="text-sm font-semibold">
                            {t('layoutBuilder.navigation.title')}
                        </h4>
                        <p className="text-xs text-neutral-500">
                            {t('layoutBuilder.navigation.description')}
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {DEVICES.map((device) => (
                            <div key={device} className="space-y-1">
                                <Label className="text-xs">
                                    {t(`layoutBuilder.devices.${device}`)}
                                </Label>
                                <Select
                                    value={layout.navigation?.[device] ?? 'auto'}
                                    onValueChange={(v) =>
                                        set({
                                            navigation: {
                                                ...layout.navigation,
                                                [device]: v as StudentNavPlacement,
                                            },
                                        })
                                    }
                                >
                                    <SelectTrigger className="h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {placementsFor(device).map((p) => (
                                            <SelectItem key={p} value={p}>
                                                {t(`layoutBuilder.placements.${p}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Header items */}
                <section className="space-y-3">
                    <div>
                        <h4 className="text-sm font-semibold">{t('layoutBuilder.header.title')}</h4>
                        <p className="text-xs text-neutral-500">
                            {t('layoutBuilder.header.description')}
                        </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {HEADER_KEYS.map((key) => (
                            <label
                                key={key}
                                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2"
                            >
                                <span className="text-sm">
                                    {t(`layoutBuilder.header.items.${key}`)}
                                </span>
                                <Switch
                                    checked={layout.header?.[key] !== false}
                                    onCheckedChange={(checked) =>
                                        set({ header: { ...layout.header, [key]: checked } })
                                    }
                                />
                            </label>
                        ))}
                    </div>
                    <p className="text-xs text-neutral-500">
                        {t('layoutBuilder.header.avatarNote')}
                    </p>
                </section>

                {/* Footer (bottom) bar */}
                <section className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-semibold">
                                {t('layoutBuilder.bottomBar.title')}
                            </h4>
                            <p className="text-xs text-neutral-500">
                                {t('layoutBuilder.bottomBar.description')}
                            </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <Switch
                                checked={customBar}
                                onCheckedChange={(checked) =>
                                    setItems(checked ? seedBottomBarFromSidebar(sidebarTabs) : [])
                                }
                            />
                            {t('layoutBuilder.bottomBar.customTabs')}
                        </label>
                    </div>

                    {customBar ? (
                        <div className="space-y-2">
                            {bottomItems.map((item, index) => (
                                <div
                                    key={item.id}
                                    className="space-y-2 rounded-md border border-neutral-200 p-2"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-700">
                                            <IconPreview item={item} />
                                        </div>
                                        <Select
                                            disabled={uploading !== null}
                                            value={
                                                item.iconUrl ? '__upload' : item.icon ?? '__letter'
                                            }
                                            onValueChange={(v) => {
                                                if (v === '__upload') {
                                                    pickImage(item.id, (url) =>
                                                        patchItem(item.id, { iconUrl: url })
                                                    );
                                                    return;
                                                }
                                                patchItem(item.id, {
                                                    icon: v === '__letter' ? undefined : v,
                                                    iconUrl: undefined,
                                                });
                                            }}
                                        >
                                            <SelectTrigger className="h-8 w-32 shrink-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-72">
                                                <SelectItem value="__letter">
                                                    {t('layoutBuilder.bottomBar.iconLetter')}
                                                </SelectItem>
                                                <SelectItem value="__upload">
                                                    {t('layoutBuilder.bottomBar.iconUpload')}
                                                </SelectItem>
                                                {STUDENT_NAV_ICON_KEYS.map((key) => {
                                                    const PhIcon = STUDENT_NAV_ICONS[key]!;
                                                    return (
                                                        <SelectItem key={key} value={key}>
                                                            <span className="flex items-center gap-2">
                                                                <PhIcon className="size-4" />
                                                                {key}
                                                            </span>
                                                        </SelectItem>
                                                    );
                                                })}
                                            </SelectContent>
                                        </Select>
                                        {uploading === item.id && (
                                            <CircleNotch className="size-4 animate-spin text-neutral-500" />
                                        )}
                                        <Input
                                            className="h-8 min-w-0 flex-1"
                                            placeholder={t('layoutBuilder.bottomBar.label')}
                                            value={item.label ?? ''}
                                            onChange={(e) =>
                                                patchItem(item.id, { label: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            className="h-8 min-w-0 flex-1"
                                            placeholder={t('layoutBuilder.bottomBar.route')}
                                            list="vx-student-routes"
                                            value={item.route}
                                            onChange={(e) => {
                                                const route = e.target.value;
                                                // A tab still on the default icon picks
                                                // up a matching one from its page.
                                                const suggested = iconForRoute(route);
                                                patchItem(item.id, {
                                                    route,
                                                    ...(suggested &&
                                                    !item.iconUrl &&
                                                    (!item.icon || item.icon === 'star')
                                                        ? { icon: suggested }
                                                        : {}),
                                                });
                                            }}
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className={cn(
                                                'h-8 shrink-0',
                                                item.highlight &&
                                                    'border-primary-500 bg-primary-50 text-primary-500'
                                            )}
                                            aria-pressed={!!item.highlight}
                                            title={t('layoutBuilder.bottomBar.centerHelp')}
                                            onClick={() =>
                                                // One center button at most: picking
                                                // a tab clears it from the others.
                                                setItems(
                                                    bottomItems.map((x) => ({
                                                        ...x,
                                                        highlight:
                                                            x.id === item.id
                                                                ? !item.highlight
                                                                : false,
                                                    }))
                                                )
                                            }
                                        >
                                            <Star
                                                className="size-4"
                                                weight={item.highlight ? 'fill' : 'regular'}
                                            />
                                            {t('layoutBuilder.bottomBar.center')}
                                        </Button>
                                        <Switch
                                            checked={item.visible !== false}
                                            onCheckedChange={(checked) =>
                                                patchItem(item.id, { visible: checked })
                                            }
                                            aria-label={t('common.visible')}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-8"
                                            disabled={index === 0}
                                            onClick={() => moveItem(index, -1)}
                                            aria-label={t('layoutBuilder.moveUp')}
                                        >
                                            <ArrowUp className="size-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-8"
                                            disabled={index === bottomItems.length - 1}
                                            onClick={() => moveItem(index, 1)}
                                            aria-label={t('layoutBuilder.moveDown')}
                                        >
                                            <ArrowDown className="size-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-8 text-danger-600"
                                            onClick={() =>
                                                setItems(
                                                    bottomItems.filter((x) => x.id !== item.id)
                                                )
                                            }
                                            aria-label={t('common.remove')}
                                        >
                                            <Trash className="size-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            <datalist id="vx-student-routes">
                                {KNOWN_ROUTES.map((r) => (
                                    <option key={r} value={r} />
                                ))}
                            </datalist>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    setItems([
                                        ...bottomItems,
                                        {
                                            id: `custom-${Date.now()}`,
                                            label: t('layoutBuilder.bottomBar.newTab'),
                                            route: '/dashboard',
                                            icon: 'star',
                                            order: bottomItems.length + 1,
                                            visible: true,
                                            isCustom: true,
                                        },
                                    ])
                                }
                            >
                                <Plus className="size-4" />
                                {t('layoutBuilder.bottomBar.addTab')}
                            </Button>
                        </div>
                    ) : (
                        <p className="rounded-md bg-neutral-50 p-3 text-xs text-neutral-600">
                            {t('layoutBuilder.bottomBar.mirrorsSidebar')}
                        </p>
                    )}

                    <div className="space-y-2">
                        <Label className="text-xs">{t('layoutBuilder.bottomBar.style')}</Label>
                        <div
                            role="radiogroup"
                            aria-label={t('layoutBuilder.bottomBar.style')}
                            className="grid grid-cols-2 gap-3 sm:max-w-md"
                        >
                            {BAR_STYLES.map((barStyle) => {
                                const selected =
                                    (layout.bottomBar?.style ?? 'classic') === barStyle;
                                return (
                                    <button
                                        key={barStyle}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() =>
                                            set({
                                                bottomBar: { ...layout.bottomBar, style: barStyle },
                                            })
                                        }
                                        className={cn(
                                            'flex flex-col gap-2 rounded-lg border-2 p-3 text-start transition-colors',
                                            selected
                                                ? 'border-primary-500 bg-primary-50'
                                                : 'border-neutral-200 bg-white hover:border-neutral-300'
                                        )}
                                    >
                                        <BarStylePreview barStyle={barStyle} />
                                        <span className="text-sm font-medium">
                                            {t(`layoutBuilder.bottomBar.styles.${barStyle}`)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Label className="text-xs">
                                {t('layoutBuilder.bottomBar.maxVisible')}
                            </Label>
                            <Select
                                value={String(layout.bottomBar?.maxVisible ?? 4)}
                                onValueChange={(v) =>
                                    set({
                                        bottomBar: { ...layout.bottomBar, maxVisible: Number(v) },
                                    })
                                }
                            >
                                <SelectTrigger className="h-8 w-20">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[3, 4, 5].map((n) => (
                                        <SelectItem key={n} value={String(n)}>
                                            {n}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <Switch
                                checked={layout.bottomBar?.showLabels !== false}
                                onCheckedChange={(checked) =>
                                    set({ bottomBar: { ...layout.bottomBar, showLabels: checked } })
                                }
                            />
                            {t('layoutBuilder.bottomBar.showLabels')}
                        </label>
                    </div>
                </section>

                {/* Wallpaper */}
                <section className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-semibold">
                                {t('layoutBuilder.wallpaper.title')}
                            </h4>
                            <p className="text-xs text-neutral-500">
                                {t('layoutBuilder.wallpaper.description')}
                            </p>
                        </div>
                        <Switch
                            checked={!!wallpaper.enabled}
                            onCheckedChange={(checked) => setWallpaper({ enabled: checked })}
                            aria-label={t('layoutBuilder.wallpaper.title')}
                        />
                    </div>
                    {wallpaper.enabled && (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {(['imageUrl', 'mobileImageUrl'] as const).map((key) => (
                                <div key={key} className="space-y-2">
                                    <Label className="text-xs">
                                        {t(`layoutBuilder.wallpaper.${key}`)}
                                    </Label>
                                    {wallpaper[key] ? (
                                        <img
                                            src={wallpaper[key]}
                                            alt=""
                                            className="h-24 w-full rounded-md border border-neutral-200 object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-500">
                                            {t('layoutBuilder.wallpaper.none')}
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={uploading !== null}
                                            onClick={() =>
                                                pickImage(key, (url) =>
                                                    setWallpaper({ [key]: url })
                                                )
                                            }
                                        >
                                            {uploading === key ? (
                                                <CircleNotch className="size-4 animate-spin" />
                                            ) : (
                                                <UploadSimple className="size-4" />
                                            )}
                                            {t('layoutBuilder.wallpaper.upload')}
                                        </Button>
                                        {wallpaper[key] && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setWallpaper({ [key]: undefined })}
                                            >
                                                {t('common.remove')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            <div className="space-y-1">
                                <Label className="text-xs">
                                    {t('layoutBuilder.wallpaper.overlay')}
                                </Label>
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="color"
                                        className="h-8 w-14 p-1"
                                        value={wallpaper.overlayColor ?? '#000000'} // design-lint-ignore: colour input needs a hex value
                                        onChange={(e) =>
                                            setWallpaper({ overlayColor: e.target.value })
                                        }
                                    />
                                    <input
                                        type="range"
                                        min={0}
                                        max={90}
                                        step={5}
                                        className="flex-1 accent-primary-500"
                                        value={wallpaper.overlayOpacity ?? 0}
                                        onChange={(e) =>
                                            setWallpaper({ overlayOpacity: Number(e.target.value) })
                                        }
                                        aria-label={t('layoutBuilder.wallpaper.opacity')}
                                    />
                                    <span className="w-10 text-right text-xs text-neutral-600">
                                        {wallpaper.overlayOpacity ?? 0}%
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">
                                    {t('layoutBuilder.wallpaper.scope')}
                                </Label>
                                <Select
                                    value={wallpaper.scope ?? 'all'}
                                    onValueChange={(v) =>
                                        setWallpaper({
                                            scope: v as StudentWallpaperSettings['scope'],
                                        })
                                    }
                                >
                                    <SelectTrigger className="h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">
                                            {t('layoutBuilder.wallpaper.scopeAll')}
                                        </SelectItem>
                                        <SelectItem value="dashboard">
                                            {t('layoutBuilder.wallpaper.scopeDashboard')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </Card>
    );
}
