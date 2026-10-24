import { getComponentVariants } from '../-utils/component-variants';
import { lookForBlock } from '../-utils/design-pattern-presets';

interface VariantSwitcherProps {
    componentType: string;
    currentProps: Record<string, any>;
    onApply: (propsToMerge: Record<string, any>) => void;
}

/**
 * Shows preset layout variants for a component type.
 * Clicking a variant deep-merges its props into the current component props.
 */
export const VariantSwitcher = ({ componentType, currentProps, onApply }: VariantSwitcherProps) => {
    const variants = getComponentVariants(componentType);
    if (!variants || variants.length === 0) return null;

    // Deep merge helper — only merges one level deep (enough for our variant props)
    const deepMerge = (base: Record<string, any>, patch: Record<string, any>) => {
        const result = { ...base };
        for (const key of Object.keys(patch)) {
            if (
                typeof patch[key] === 'object' &&
                patch[key] !== null &&
                !Array.isArray(patch[key]) &&
                typeof base[key] === 'object' &&
                base[key] !== null
            ) {
                result[key] = { ...base[key], ...patch[key] };
            } else {
                result[key] = patch[key];
            }
        }
        return result;
    };

    const isActive = (variantProps: Record<string, any>) => {
        return Object.entries(variantProps).every(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
                return Object.entries(val).every(
                    ([k, v]) => currentProps[key]?.[k] === v
                );
            }
            return currentProps[key] === val;
        });
    };

    return (
        <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Layout Preset</p>
            <div className="flex flex-wrap gap-2">
                {variants.map((variant) => {
                    const look = lookForBlock(componentType, currentProps, variant.props);
                    const active = isActive(look);
                    return (
                        <button
                            key={variant.id}
                            onClick={() => onApply(deepMerge(currentProps, look))}
                            title={variant.description}
                            className={`flex flex-col items-center rounded border px-3 py-2 text-xs transition-colors ${
                                active
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                        >
                            <span className="text-2xs font-mono whitespace-pre leading-tight text-gray-400 mb-1 hidden">
                                {variant.thumbnail}
                            </span>
                            {variant.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
