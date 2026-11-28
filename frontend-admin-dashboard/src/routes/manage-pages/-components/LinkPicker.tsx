import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    ArrowSquareOut as ExternalLink,
    FileText,
    MagnifyingGlass as Search,
    ArrowDown,
} from '@phosphor-icons/react';
import { useEditorStore } from '../-stores/editor-store';
import { componentLabel } from '../-utils/component-labels';
import type { Component } from '../-types/editor-types';

interface LinkPickerProps {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    /** Show same-tab / new-tab toggle */
    showTarget?: boolean;
    target?: string;
    onTargetChange?: (target: string) => void;
    placeholder?: string;
}

// Header/footer are page chrome, not a scroll destination.
const NON_SECTION_TYPES = new Set(['header', 'footer']);

const stripHtml = (v: unknown) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : '');

/** A short human hint for a section ("Hero Section — Learn Something New"). */
const sectionTitle = (c: Component): string => {
    const p = (c.props || {}) as Record<string, any>;
    const text = [p.headerText, p.heading, p.title, p.left?.title, p.text]
        .map(stripHtml)
        .find(Boolean);
    return text ? `${componentLabel(c.type)} — ${text}` : componentLabel(c.type);
};

const slugify = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * Smart link picker that lets users:
 * 1. Pick from existing pages (internal routes)
 * 2. Pick a section on the current page (scrolls down to it)
 * 3. Enter an external URL
 *
 * Internal pages are stored as the route slug (e.g. "about-us").
 * Sections are stored as "#anchorId"; picking a section with no anchor ID gives it one.
 * External URLs are stored as full URLs (e.g. "https://example.com").
 */
export const LinkPicker = ({
    label = 'Link',
    value,
    onChange,
    showTarget = false,
    target,
    onTargetChange,
    placeholder = 'Select a page or enter URL',
}: LinkPickerProps) => {
    const config = useEditorStore((s) => s.config);
    const selectedPageId = useEditorStore((s) => s.selectedPageId);
    const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
    const updateComponent = useEditorStore((s) => s.updateComponent);
    const editingSiteChrome = useEditorStore((s) => s.selectedGlobalSettings || !!s.selectedGlobalLayout);
    const pages = config?.pages || [];
    // The site-wide header/footer/settings are on every page, so "a section on this page" has no
    // single meaning there — those pickers keep the plain Page / URL behaviour.
    const currentPage = editingSiteChrome ? undefined : pages.find((p) => p.id === selectedPageId);
    const sections = (currentPage?.components || []).filter(
        (c) => !NON_SECTION_TYPES.has(c.type) && c.id !== selectedComponentId,
    );

    const isExternal = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('mailto:') || value.startsWith('tel:');
    const isSection = !!currentPage && value.startsWith('#');
    const [mode, setMode] = useState<'page' | 'section' | 'url'>(isExternal ? 'url' : isSection ? 'section' : 'page');
    const [search, setSearch] = useState('');

    const anchorTarget = isSection ? sections.find((c) => c.anchorId === value.slice(1)) : undefined;

    const pickSection = (c: Component) => {
        let anchor = c.anchorId;
        if (!anchor && currentPage) {
            // Give the section a readable, page-unique anchor ID so the button can scroll to it.
            const taken = new Set(currentPage.components.map((x) => x.anchorId).filter(Boolean));
            const base = slugify(componentLabel(c.type)) || 'section';
            anchor = base;
            for (let n = 2; taken.has(anchor); n++) anchor = `${base}-${n}`;
            updateComponent(currentPage.id, c.id, { anchorId: anchor });
        }
        if (anchor) onChange(`#${anchor}`);
    };

    // Find currently selected page
    const selectedPage = pages.find(
        (p) => p.route === value || p.id === value || value === 'homepage' && (p.id === 'home' || p.route === 'homepage' || p.route === '/' || p.route === ''),
    );

    const filteredPages = search
        ? pages.filter((p) => {
              const q = search.toLowerCase();
              return (p.title || '').toLowerCase().includes(q) || p.route.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
          })
        : pages;

    return (
        <div className="space-y-2">
            {label && <Label className="text-xs">{label}</Label>}

            {/* Mode toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                    type="button"
                    onClick={() => { setMode('page'); if (isExternal || isSection) onChange(''); }}
                    className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors ${
                        mode === 'page' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    <FileText className="size-3" />
                    Page
                </button>
                {currentPage && (
                    <button
                        type="button"
                        onClick={() => setMode('section')}
                        className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors ${
                            mode === 'section' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500 hover:bg-gray-50'
                        }`}
                    >
                        <ArrowDown className="size-3" />
                        Section
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => setMode('url')}
                    className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors ${
                        mode === 'url' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    <ExternalLink className="size-3" />
                    External URL
                </button>
            </div>

            {mode === 'section' ? (
                <div className="space-y-1.5">
                    <p className="text-2xs text-gray-400">
                        Scrolls down to a section on this page.
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded border border-gray-100 bg-gray-50">
                        {sections.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-gray-400">
                                No other sections on this page yet
                            </div>
                        ) : (
                            sections.map((c) => {
                                const isSelected = !!c.anchorId && value === `#${c.anchorId}`;
                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => pickSection(c)}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                            isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-700'
                                        }`}
                                    >
                                        <ArrowDown className="size-3 shrink-0 text-gray-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium">{sectionTitle(c)}</div>
                                            {c.anchorId && (
                                                <div className="truncate text-2xs text-gray-400">#{c.anchorId}</div>
                                            )}
                                        </div>
                                        {isSelected && (
                                            <span className="text-2xs font-medium text-blue-500">Selected</span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                    {isSection && (
                        <div className="flex items-center justify-between rounded bg-blue-50 px-2 py-1">
                            <span className="text-2xs text-blue-600">
                                {anchorTarget
                                    ? <>Scrolls to: <strong>{sectionTitle(anchorTarget)}</strong></>
                                    : <>No section on this page has ID <strong>{value}</strong> — pick one above</>}
                            </span>
                            <button
                                type="button"
                                onClick={() => onChange('')}
                                className="text-2xs text-blue-400 hover:text-blue-600"
                            >
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            ) : mode === 'page' ? (
                <div className="space-y-1.5">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-gray-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search pages..."
                            className="h-7 pl-7 text-xs"
                        />
                    </div>

                    {/* Page list */}
                    <div className="max-h-48 overflow-y-auto rounded border border-gray-100 bg-gray-50">
                        {filteredPages.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-gray-400">
                                {search ? 'No pages match your search' : 'No pages created yet'}
                            </div>
                        ) : (
                            filteredPages.map((page) => {
                                const isHome = page.id === 'home' || page.route === 'homepage' || page.route === '/' || page.route === '';
                                const routeSlug = isHome ? 'homepage' : (page.route || page.id);
                                const isSelected = value === routeSlug || value === page.route || value === page.id || (isHome && value === 'homepage');

                                return (
                                    <button
                                        key={page.id}
                                        type="button"
                                        onClick={() => onChange(routeSlug)}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                            isSelected
                                                ? 'bg-blue-50 text-blue-700'
                                                : 'hover:bg-gray-100 text-gray-700'
                                        }`}
                                    >
                                        <FileText className="size-3 shrink-0 text-gray-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium">
                                                {page.title || page.route || page.id}
                                                {isHome && <span className="ml-1 text-2xs text-gray-400">(Home)</span>}
                                            </div>
                                            <div className="truncate text-2xs text-gray-400">
                                                /{routeSlug}
                                            </div>
                                        </div>
                                        {page.published && (
                                            <span className="size-1.5 shrink-0 rounded-full bg-green-500" title="Published" />
                                        )}
                                        {isSelected && (
                                            <span className="text-2xs font-medium text-blue-500">Selected</span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Current value display */}
                    {value && !isExternal && (
                        <div className="flex items-center justify-between rounded bg-blue-50 px-2 py-1">
                            <span className="text-2xs text-blue-600">
                                {value === 'get-started'
                                    ? <>Opens: <strong>Get Started (lead form)</strong></>
                                    : <>Links to: <strong>/{value}</strong></>}
                            </span>
                            <button
                                type="button"
                                onClick={() => onChange('')}
                                className="text-2xs text-blue-400 hover:text-blue-600"
                            >
                                Clear
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                /* External URL mode */
                <div className="space-y-1.5">
                    <Input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder || 'https://example.com'}
                        className="h-8 text-xs"
                    />
                    <p className="text-2xs text-gray-400">
                        Enter a full URL (https://...) or mailto:/tel: link
                    </p>
                </div>
            )}

            {/* Target selector */}
            {showTarget && onTargetChange && (
                <div className="flex gap-1">
                    {[
                        { label: 'Same Tab', value: '_self' },
                        { label: 'New Tab', value: '_blank' },
                    ].map((t) => (
                        <button
                            key={t.value}
                            type="button"
                            onClick={() => onTargetChange(t.value)}
                            className={`rounded px-2.5 py-1 text-2xs font-medium transition-colors ${
                                (target || '_self') === t.value
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
