import React, { useState, KeyboardEvent, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';

interface MultiEmailInputProps {
    value: string[];
    onChange: (emails: string[]) => void;
    placeholder?: string;
    error?: string;
}

// Exposed to parents via ref so the containing form can flush any half-typed
// email into the committed list at submit time — without depending on the
// input's `blur` firing first (which is unreliable across browsers when a
// button click doesn't move focus, e.g. Safari/Firefox on macOS).
export interface MultiEmailInputHandle {
    /** Commit the pending text and return the final committed email list. */
    flush: () => string[];
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const MultiEmailInput = forwardRef<MultiEmailInputHandle, MultiEmailInputProps>(
    ({ value, onChange, placeholder, error }, ref) => {
        const { t } = useTranslation('audienceManagerMultiEmailInput');
        const [input, setInput] = useState('');

        // Commit whatever is currently typed into the box. Splits on commas,
        // semicolons and whitespace so pasted lists (e.g. "a@x.com, b@y.com")
        // are added as separate chips instead of being validated as one string.
        // Valid, non-duplicate emails become chips; anything invalid stays in
        // the box so the user can see and correct it rather than losing it.
        // Returns the resulting committed list synchronously (used by flush()).
        const commit = (raw: string): string[] => {
            const parts = raw
                .split(/[\s,;]+/)
                .map((email) => email.trim())
                .filter(Boolean);

            if (parts.length === 0) {
                setInput('');
                return value;
            }

            const next = [...value];
            const invalid: string[] = [];
            parts.forEach((email) => {
                if (isValidEmail(email)) {
                    if (!next.includes(email)) next.push(email);
                } else {
                    invalid.push(email);
                }
            });

            if (next.length !== value.length) onChange(next);
            setInput(invalid.join(', '));
            return next;
        };

        const addEmail = () => commit(input);

        useImperativeHandle(ref, () => ({
            flush: () => commit(input),
        }));

        const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addEmail();
            }
        };

        const removeEmail = (email: string) => {
            onChange(value.filter((e) => e !== email));
        };

        return (
            <div>
                <div className="flex w-full flex-wrap gap-2   px-3 py-2">
                    {value.map((email) => (
                        <span
                            key={email}
                            className="text-primary-700 flex items-center gap-1 rounded-md bg-primary-100 px-2 py-1 text-sm"
                        >
                            {email}
                            <button
                                type="button"
                                onClick={() => removeEmail(email)}
                                className="text-primary-700 font-bold hover:text-red-500"
                            >
                                ×
                            </button>
                        </span>
                    ))}

                    <input
                        type="text"
                        className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        placeholder={placeholder || t('placeholder')}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={addEmail}
                    />
                </div>

                {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
            </div>
        );
    }
);

MultiEmailInput.displayName = 'MultiEmailInput';

export default MultiEmailInput;
