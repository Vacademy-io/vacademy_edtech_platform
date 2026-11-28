import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';

export interface MultiSelectOption {
    id: string | number;
    name: string;
    /** Optional muted second line rendered only in the dropdown list (not on chips). */
    subtitle?: string;
}

interface MultiSelectDropdownProps {
    options: MultiSelectOption[];
    selected: MultiSelectOption[];
    onChange: (selected: MultiSelectOption[]) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    emptyLabel?: string;
    searchPlaceholder?: string;
    /** Also match the search text against each option's subtitle (e.g. a staff email). */
    searchSubtitle?: boolean;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
    options,
    selected,
    onChange,
    placeholder = 'Select...',
    disabled = false,
    className = '',
    emptyLabel = 'No results',
    searchPlaceholder = 'Search…',
    searchSubtitle = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [panelPosition, setPanelPosition] = useState<{ top: number; left: number }>({
        top: 0,
        left: 0,
    });
    // Inside a modal dialog the panel has to live in the dialog's DOM: a modal
    // Radix dialog switches off pointer events and traps focus everywhere else,
    // so a panel on document.body can be seen but not clicked, typed into or scrolled.
    const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const insideRoot = dropdownRef.current?.contains(target);
            const insidePanel = panelRef.current?.contains(target);
            if (!insideRoot && !insidePanel) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen || !triggerRef.current) return;
        const updatePosition = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            if (!dialogContainer) {
                setPanelPosition({ top: rect.bottom + 4, left: rect.left });
                return;
            }
            // Positioned absolutely against the dialog box. The dialog clips its
            // overflow, so open upwards when there is no room below.
            const box = dialogContainer.getBoundingClientRect();
            const panelHeight = panelRef.current?.offsetHeight ?? 0;
            const opensUp =
                rect.bottom + 4 + panelHeight > box.bottom && rect.top - box.top > panelHeight + 4;
            const top = opensUp ? rect.top - 4 - panelHeight : rect.bottom + 4;
            setPanelPosition({
                top: top - box.top - dialogContainer.clientTop,
                left: rect.left - box.left - dialogContainer.clientLeft,
            });
        };
        updatePosition();
        // Once more after paint, when the panel height is known.
        const frame = requestAnimationFrame(updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
        // A pick adds a chip and shifts the trigger, so follow it.
    }, [isOpen, dialogContainer, selected?.length]);

    useEffect(() => {
        if (!isOpen) {
            setSearch('');
            return;
        }
        const id = requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [isOpen]);

    const handleSelect = (option: MultiSelectOption) => {
        if (!selected) {
            onChange([option]);
            return;
        }
        if (!selected.find((item) => item.id === option.id)) {
            onChange([...selected, option]);
        }
    };

    const handleRemove = (option: MultiSelectOption) => {
        onChange(selected.filter((item) => item.id !== option.id));
    };

    const availableOptions = useMemo(() => {
        const unselected = options.filter(
            (option) => !selected?.some((item) => item.id === option.id)
        );
        const needle = search.trim().toLowerCase();
        if (!needle) return unselected;
        return unselected.filter(
            (option) =>
                option.name.toLowerCase().includes(needle) ||
                (searchSubtitle && (option.subtitle ?? '').toLowerCase().includes(needle))
        );
    }, [options, selected, search, searchSubtitle]);

    const getInitials = (name: string) => {
        const cleaned = name.trim();
        if (!cleaned) return '?';
        const parts = cleaned.split(/\s+/);
        const first = parts[0]?.[0] ?? '';
        const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
        return (first + last).toUpperCase() || first.toUpperCase();
    };

    return (
        <div className={`relative flex flex-wrap items-center gap-2 ${className}`} ref={dropdownRef}>
            <div className="flex flex-wrap items-center gap-1.5">
                {selected?.map((item) => (
                    <span
                        key={item.id}
                        className="group inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-1 pr-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100"
                    >
                        <span
                            aria-hidden
                            className="flex size-5 items-center justify-center rounded-full bg-primary-500 text-[10px] font-semibold text-white"
                        >
                            {getInitials(item.name)}
                        </span>
                        <span className="pr-1">{item.name}</span>
                        <button
                            type="button"
                            className="flex size-5 items-center justify-center rounded-full text-primary-600 transition-colors hover:bg-primary-200 hover:text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (disabled) return;
                                handleRemove(item);
                            }}
                            aria-label={`Remove ${item.name}`}
                            title={`Remove ${item.name}`}
                            disabled={disabled}
                        >
                            <X size={12} weight="bold" />
                        </button>
                    </span>
                ))}
            </div>
            <div>
                <button
                    ref={triggerRef}
                    type="button"
                    className={`flex items-center gap-1 rounded bg-white text-left transition-all focus:border-none active:border-none ${
                        disabled ? 'cursor-not-allowed bg-neutral-100' : ''
                    }`}
                    onClick={() => {
                        if (disabled) return;
                        setDialogContainer(
                            triggerRef.current?.closest<HTMLElement>(
                                '[role="dialog"], [role="alertdialog"]'
                            ) ?? null
                        );
                        setIsOpen((open) => !open);
                    }}
                    disabled={disabled}
                >
                    <p className="text-sm font-medium text-primary-500">{placeholder}</p>
                </button>
                {isOpen &&
                    typeof document !== 'undefined' &&
                    createPortal(
                        <div
                            ref={panelRef}
                            style={{
                                position: dialogContainer ? 'absolute' : 'fixed',
                                top: panelPosition.top,
                                left: panelPosition.left,
                                zIndex: 9999,
                            }}
                            className="flex w-[260px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg animate-in fade-in zoom-in-95 duration-150"
                        >
                            <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
                                <MagnifyingGlass size={14} className="text-neutral-400" />
                                <input
                                    ref={searchInputRef}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={searchPlaceholder}
                                    className="w-full bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
                                />
                            </div>
                            <div className="max-h-56 overflow-auto py-1">
                                {availableOptions.length === 0 ? (
                                    <div className="px-4 py-3 text-center text-xs text-neutral-400">
                                        {emptyLabel}
                                    </div>
                                ) : (
                                    availableOptions.map((option) => (
                                        <button
                                            type="button"
                                            key={option.id}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-primary-50"
                                            onClick={() => handleSelect(option)}
                                        >
                                            <span
                                                aria-hidden
                                                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-semibold text-primary-700"
                                            >
                                                {getInitials(option.name)}
                                            </span>
                                            <span className="flex min-w-0 flex-col leading-tight">
                                                <span className="truncate">{option.name}</span>
                                                {option.subtitle && (
                                                    <span className="truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                                                        {option.subtitle}
                                                    </span>
                                                )}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>,
                        dialogContainer ?? document.body
                    )}
            </div>
        </div>
    );
};

export default MultiSelectDropdown;
