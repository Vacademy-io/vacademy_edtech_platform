import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Roles every institute gets; anything else is typed under "Custom". */
export const PRESET_AUTHOR_ROLES = ['Author', 'Instructor', 'Facilitator'] as const;

const DEFAULT_VALUE = '__default__';
const CUSTOM_VALUE = '__custom__';

/**
 * The words this course already uses, so a custom role typed for one author
 * ("Acharya") is one click for the next.
 */
export const authorRoleOptions = (usedRoles: ReadonlyArray<string | undefined>): string[] => {
    const seen = new Set<string>(PRESET_AUTHOR_ROLES);
    const out: string[] = [...PRESET_AUTHOR_ROLES];
    for (const role of usedRoles) {
        const r = role?.trim();
        if (r && !seen.has(r)) {
            seen.add(r);
            out.push(r);
        }
    }
    return out;
};

interface AuthorRoleFieldProps {
    /** '' or undefined = the institute default term. */
    value: string | undefined;
    onChange: (value: string) => void;
    options: string[];
    /** The institute's own term, shown on the Default option. */
    defaultTerm: string;
}

/**
 * Per-course role of one author. It replaces "Author" / "Instructor" next to
 * their name on the course page, cards and catalogue, for this course only.
 */
export function AuthorRoleField({ value, onChange, options, defaultTerm }: AuthorRoleFieldProps) {
    const current = value?.trim() ?? '';
    const [customMode, setCustomMode] = useState(() => !!current && !options.includes(current));
    const selectValue = customMode ? CUSTOM_VALUE : current || DEFAULT_VALUE;

    return (
        <div>
            <Label className="mb-1 block text-xs font-medium text-gray-700">Role in this course</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                    value={selectValue}
                    onValueChange={(next) => {
                        if (next === CUSTOM_VALUE) {
                            setCustomMode(true);
                            return;
                        }
                        setCustomMode(false);
                        onChange(next === DEFAULT_VALUE ? '' : next);
                    }}
                >
                    <SelectTrigger className="h-8 border-gray-300 text-xs sm:w-48">
                        <SelectValue />
                    </SelectTrigger>
                    {/* Edit Course is a top-tier dialog; the default z-50 menu opens behind it. */}
                    <SelectContent className="z-popover-above-top-modal">
                        <SelectItem value={DEFAULT_VALUE} className="text-xs">
                            Default ({defaultTerm})
                        </SelectItem>
                        {options.map((role) => (
                            <SelectItem key={role} value={role} className="text-xs">
                                {role}
                            </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_VALUE} className="text-xs">
                            Custom…
                        </SelectItem>
                    </SelectContent>
                </Select>
                {customMode && (
                    <Input
                        autoFocus
                        maxLength={100}
                        placeholder="e.g., Acharya"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="h-8 border-gray-300 text-xs"
                    />
                )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
                Shown instead of {defaultTerm} next to this name, for this course only.
            </p>
        </div>
    );
}
