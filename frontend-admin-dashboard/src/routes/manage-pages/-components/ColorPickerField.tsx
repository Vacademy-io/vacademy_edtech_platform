import { useState, useEffect, useId } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** A colour value the field starts from, not a UI colour. */
const BLANK_COLOUR = '#ffffff'; // design-lint-ignore: authored colour value, not UI styling

interface ColorPickerFieldProps {
    label: string;
    value: string;
    onChange: (color: string) => void;
}

export const ColorPickerField = ({ label, value, onChange }: ColorPickerFieldProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    // The label names the hex box, the swatch and the picker's own box, so a
    // screen reader says which colour each one is.
    const inputId = useId();
    const [localValue, setLocalValue] = useState(value || BLANK_COLOUR);

    // Sync when external value changes
    useEffect(() => {
        setLocalValue(value || BLANK_COLOUR);
    }, [value]);

    const handlePickerChange = (color: string) => {
        setLocalValue(color);
        onChange(color);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setLocalValue(v);
        // Only call onChange when hex is complete and valid
        if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
            onChange(v);
        }
    };

    return (
        <div className="space-y-2">
            <Label htmlFor={inputId}>{label}</Label>
            <div className="flex items-center gap-2">
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="size-9 shrink-0 rounded border border-gray-300 shadow-sm transition-shadow hover:shadow-md"
                            style={{ backgroundColor: localValue || BLANK_COLOUR }}
                            title={t('actions.pickColor')}
                            aria-label={`${t('actions.pickColor')}: ${label}`}
                        />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="start">
                        <HexColorPicker color={localValue} onChange={handlePickerChange} />
                        <div className="mt-2">
                            <Input
                                value={localValue}
                                onChange={handleInputChange}
                                placeholder={BLANK_COLOUR}
                                className="font-mono text-sm"
                                aria-label={label}
                            />
                        </div>
                    </PopoverContent>
                </Popover>
                <Input
                    id={inputId}
                    value={localValue}
                    onChange={handleInputChange}
                    placeholder={BLANK_COLOUR}
                    className="font-mono text-sm"
                />
            </div>
        </div>
    );
};
