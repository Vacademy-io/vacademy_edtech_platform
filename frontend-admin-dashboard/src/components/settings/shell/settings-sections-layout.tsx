import {
    Children,
    isValidElement,
    useMemo,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface SettingsSection {
    /** DOM id of the section block this tab reveals. */
    id: string;
    label: string;
    /** Optional Phosphor icon shown beside the label. */
    icon?: Icon;
}

export interface SettingsSectionGroup {
    /** Reserved for future grouping; sections render as a flat tab row today. */
    label?: string;
    sections: SettingsSection[];
}

interface SettingsSectionsLayoutProps {
    /** Section definitions, used to build the horizontal tab bar. */
    groups: SettingsSectionGroup[];
    /** Optional toolbar rendered on the right of the tab bar (e.g. Reset). */
    toolbar?: ReactNode;
    /**
     * The section blocks. Each direct child must carry an `id` matching a
     * section; only the active section is shown at a time.
     */
    children: ReactNode;
    className?: string;
    /**
     * Section to open first (e.g. from a deep link). Ignored when it is not one
     * of the sections; the first section is the default.
     */
    defaultActiveId?: string;
}

/**
 * Settings layout with a horizontal tab bar (header-style) over a full-width
 * content column. Only the active section is shown — no endless scroll — so
 * each tab reads as a focused screen. The tab strip scrolls horizontally on
 * small viewports.
 */
export function SettingsSectionsLayout({
    groups,
    toolbar,
    children,
    className,
    defaultActiveId,
}: SettingsSectionsLayoutProps) {
    const allSections = useMemo(
        () => groups.flatMap((g) => g.sections),
        [groups]
    );
    const [activeId, setActiveId] = useState(
        defaultActiveId && allSections.some((s) => s.id === defaultActiveId)
            ? defaultActiveId
            : allSections[0]?.id ?? ''
    );

    // Guard against an active id that no longer exists (e.g. groups changed).
    const resolvedActive = allSections.some((s) => s.id === activeId)
        ? activeId
        : allSections[0]?.id ?? '';

    const childPanels = Children.toArray(children).filter(
        isValidElement
    ) as ReactElement[];

    return (
        <div className={cn('space-y-6', className)}>
            {/* Horizontal tab bar */}
            <div className="flex items-end justify-between gap-4 border-b border-border">
                <nav
                    aria-label="Settings sections"
                    className="-mb-px flex gap-1 overflow-x-auto"
                >
                    {allSections.map((s) => {
                        const isActive = resolvedActive === s.id;
                        const SectionIcon = s.icon;
                        return (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setActiveId(s.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    'flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors',
                                    isActive
                                        ? 'border-primary-500 font-semibold text-neutral-900'
                                        : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-800'
                                )}
                            >
                                {SectionIcon && (
                                    <SectionIcon
                                        className="size-4 shrink-0"
                                        weight={isActive ? 'fill' : 'regular'}
                                    />
                                )}
                                {s.label}
                            </button>
                        );
                    })}
                </nav>
                {toolbar && (
                    <div className="hidden shrink-0 items-center gap-2 pb-2 sm:flex">
                        {toolbar}
                    </div>
                )}
            </div>

            {/* Content column */}
            <div>
                {toolbar && (
                    <div className="mb-4 flex items-center justify-end gap-2 sm:hidden">
                        {toolbar}
                    </div>
                )}
                {childPanels.map((child, i) => {
                    const id = (child.props as { id?: string })?.id;
                    const visible = id ? id === resolvedActive : i === 0;
                    return (
                        <div key={id ?? i} hidden={!visible}>
                            {child}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
