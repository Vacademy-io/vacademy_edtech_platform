import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Plus, TrashSimple } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

interface InlineFieldEditorProps {
    /** Current field label. */
    name: string;
    onNameChange: (next: string) => void;
    /** Show a "name already used" warning under the input. */
    duplicateName?: boolean;
    /**
     * Option labels, as plain strings — the one shape every caller shares.
     * Callers own the mapping back into their own option object shape
     * ({id,value} / {id,value,disabled} / {label,name}).
     * Omit entirely for field types that have no options.
     */
    options?: string[];
    /**
     * `removedIndex` is set when a row was deleted, so callers that keep extra
     * per-option data (index-aligned) can drop the right entry — the strings
     * alone cannot tell which of two identical options went.
     */
    onOptionsChange?: (next: string[], removedIndex?: number) => void;
    /** Extra control rendered under each option row (e.g. a dependent dropdown's parent value). */
    renderOptionAddon?: (index: number) => ReactNode;
    /** Hide the name input — for callers that already collect the label elsewhere. */
    hideName?: boolean;
    /** Drop the surrounding card border when embedded in an existing panel. */
    bare?: boolean;
}

export const InlineFieldEditor = ({
    name,
    onNameChange,
    duplicateName = false,
    options,
    onOptionsChange,
    hideName = false,
    bare = false,
    renderOptionAddon,
}: InlineFieldEditorProps) => {
    const showOptions = Array.isArray(options) && typeof onOptionsChange === 'function';

    const setOption = (index: number, value: string) =>
        // Options are persisted as one comma-joined string, so a comma inside a
        // value splits into extra bogus options when read back.
        onOptionsChange?.(
            (options ?? []).map((opt, i) => (i === index ? value.replace(/,/g, '') : opt))
        );

    return (
        <div
            className={
                bare
                    ? 'flex flex-col gap-4'
                    : 'flex flex-col gap-4 rounded-lg border border-neutral-300 p-4'
            }
        >
            {!hideName && (
            <div className="flex flex-col gap-1">
                <h1 className="text-caption text-neutral-500">Field name</h1>
                <MyInput
                    inputType="text"
                    inputPlaceholder="Field name"
                    input={name}
                    size="large"
                    className="w-full"
                    onChangeFunction={(e) => onNameChange(e.target.value)}
                />
                {duplicateName && (
                    <p className="text-caption text-danger-600">
                        Another field already uses this name
                    </p>
                )}
            </div>
            )}

            {showOptions && (
                <div className="flex flex-col gap-2">
                    <h1 className="text-caption text-neutral-500">Options</h1>
                    <p className="text-caption text-neutral-500">
                        Commas aren&apos;t allowed in option values.
                    </p>
                    {(options ?? []).map((option, index) => (
                        <div key={index} className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder="Option"
                                    input={option}
                                    size="large"
                                    className="w-full"
                                    onChangeFunction={(e) => setOption(index, e.target.value)}
                                />
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    aria-label="Delete option"
                                    onClick={() =>
                                        onOptionsChange?.(
                                            (options ?? []).filter((_, i) => i !== index),
                                            index
                                        )
                                    }
                                >
                                    <TrashSimple className="!size-4 text-danger-500" />
                                </MyButton>
                            </div>
                            {renderOptionAddon?.(index)}
                        </div>
                    ))}
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-fit"
                        onClick={() =>
                            onOptionsChange?.([
                                ...(options ?? []),
                                `Option ${(options ?? []).length + 1}`,
                            ])
                        }
                    >
                        <Plus size={16} /> Add option
                    </MyButton>
                </div>
            )}
        </div>
    );
};
