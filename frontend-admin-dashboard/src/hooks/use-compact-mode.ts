/**
 * Compact Mode Hook
 *
 * Provides unified detection and control of compact mode across the application.
 * Supports multiple methods:
 * 1. Route prefix: /cm/
 * 2. Query parameter: ?compact=true
 * 3. User preference: saved in localStorage or backend
 */

// ============================================================================
// COMPACT MODE DETECTION HOOK
// ============================================================================

export interface CompactModeHook {
    /**
     * Whether compact mode is currently active
     */
    isCompact: boolean;

    /**
     * The method by which compact mode is activated
     */
    compactSource: 'route' | 'query' | 'preference' | null;

    /**
     * Toggle compact mode on/off
     */
    toggleCompactMode: () => void;

    /**
     * Set user's permanent preference
     */
    setCompactPreference: (enabled: boolean) => void;

    /**
     * Clear user's preference (fall back to other methods)
     */
    clearCompactPreference: () => void;

    /**
     * Navigate to the compact version of current route
     */
    navigateToCompact: () => void;

    /**
     * Navigate to the default version of current route
     */
    navigateToDefault: () => void;
}

/**
 * Main hook for compact mode detection and control
 *
 * Priority order:
 * 1. Route prefix (/cm/)
 * 2. Query parameter (?compact=true)
 * 3. User preference (localStorage/backend)
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isCompact, toggleCompactMode } = useCompactMode();
 *
 *   return (
 *     <div className={cn(isCompact ? 'p-2' : 'p-6')}>
 *       <button onClick={toggleCompactMode}>
 *         Toggle Compact Mode
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCompactMode(): CompactModeHook {
    // Compact mode is always on — the user-facing toggle/settings have been removed.
    return {
        isCompact: true,
        compactSource: 'preference',
        toggleCompactMode: () => {},
        setCompactPreference: () => {},
        clearCompactPreference: () => {},
        navigateToCompact: () => {},
        navigateToDefault: () => {},
    };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get compact-aware class names for a component
 *
 * @example
 * ```tsx
 * const { isCompact } = useCompactMode();
 * const padding = getCompactClass(isCompact, 'p-6', 'p-3');
 * ```
 */
export function getCompactClass(
    isCompact: boolean,
    defaultClass: string,
    compactClass: string
): string {
    return isCompact ? compactClass : defaultClass;
}

/**
 * Get multiple compact-aware classes
 *
 * @example
 * ```tsx
 * const { isCompact } = useCompactMode();
 * const classes = getCompactClasses(isCompact, {
 *   padding: ['p-6', 'p-3'],
 *   gap: ['gap-4', 'gap-2'],
 *   text: ['text-base', 'text-sm']
 * });
 * // Returns: 'p-6 gap-4 text-base' or 'p-3 gap-2 text-sm'
 * ```
 */
export function getCompactClasses(
    isCompact: boolean,
    classMap: Record<string, [string, string]>
): string {
    return Object.values(classMap)
        .map(([defaultClass, compactClass]) =>
            isCompact ? compactClass : defaultClass
        )
        .join(' ');
}

/**
 * Check if a specific route should show compact mode toggle
 */
export function shouldShowCompactToggle(pathname: string): boolean {
    // Don't show on public routes
    const publicRoutes = ['/login', '/signup', '/landing', '/pricing'];
    if (publicRoutes.some(route => pathname.startsWith(route))) {
        return false;
    }

    // Don't show on full-screen routes
    const fullScreenRoutes = ['/slides'];
    if (fullScreenRoutes.some(route => pathname.includes(route))) {
        return false;
    }

    return true;
}

// ============================================================================
// COMPACT MODE CONSTANTS
// ============================================================================

export const COMPACT_MODE = {
    /**
     * Sidebar widths
     */
    SIDEBAR: {
        EXPANDED: {
            default: 307,
            compact: 220,
        },
        COLLAPSED: {
            default: 112,
            compact: 56,
        },
    },

    /**
     * Navbar heights
     */
    NAVBAR: {
        HEIGHT: {
            default: 72,
            compact: 48,
        },
    },

    /**
     * Spacing scales
     */
    SPACING: {
        CARD_PADDING: {
            default: 'p-6',
            compact: 'p-3',
        },
        CARD_GAP: {
            default: 'gap-6',
            compact: 'gap-3',
        },
        CONTENT_PADDING: {
            default: 'p-4 md:p-6 lg:m-7',
            compact: 'p-2 md:p-4 lg:m-4',
        },
        SECTION_SPACING: {
            default: 'mb-8',
            compact: 'mb-4',
        },
    },

    /**
     * Typography scales
     */
    TYPOGRAPHY: {
        H1: {
            default: 'text-3xl',
            compact: 'text-2xl',
        },
        H2: {
            default: 'text-2xl',
            compact: 'text-xl',
        },
        H3: {
            default: 'text-xl',
            compact: 'text-lg',
        },
        BODY: {
            default: 'text-base',
            compact: 'text-sm',
        },
        SMALL: {
            default: 'text-sm',
            compact: 'text-xs',
        },
    },

    /**
     * Component sizes
     */
    COMPONENTS: {
        BUTTON: {
            small: {
                default: 'px-4 py-2 text-sm',
                compact: 'px-3 py-1.5 text-xs',
            },
            medium: {
                default: 'px-6 py-3 text-base',
                compact: 'px-4 py-2 text-sm',
            },
            large: {
                default: 'px-8 py-4 text-lg',
                compact: 'px-5 py-2.5 text-base',
            },
        },
        INPUT: {
            height: {
                default: 'h-12',
                compact: 'h-9',
            },
            padding: {
                default: 'px-4 py-3',
                compact: 'px-3 py-2',
            },
            text: {
                default: 'text-base',
                compact: 'text-sm',
            },
        },
        AVATAR: {
            size: {
                default: 'size-10',
                compact: 'size-8',
            },
        },
        ICON: {
            size: {
                default: 'size-5',
                compact: 'size-4',
            },
        },
    },
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CompactModeConstants = typeof COMPACT_MODE;
