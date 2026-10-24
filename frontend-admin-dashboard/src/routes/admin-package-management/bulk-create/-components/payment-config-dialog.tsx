import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PaymentConfig, PaymentType, PaymentOptionItem } from '../-types/bulk-create-types';
import { currencyOptions } from '@/routes/settings/-constants/payments';
import { getCurrencySymbol } from '@/routes/settings/-components/Payment/utils/utils';
import { formatPlanPrice } from '@/utils/finance-utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface PaymentConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentConfig: PaymentConfig;
    paymentOptions: PaymentOptionItem[];
    onSave: (config: PaymentConfig) => void;
}

const PAYMENT_TYPES: { value: PaymentType; label: string; description: string }[] = [
    { value: 'FREE', label: 'Free', description: 'No payment required' },
    { value: 'ONE_TIME', label: 'One-Time', description: 'Single payment for lifetime access' },
    { value: 'SUBSCRIPTION', label: 'Subscription', description: 'Recurring payment' },
    { value: 'DONATION', label: 'Donation', description: 'Pay what you want' },
];

const VALIDITY_OPTIONS = [
    { value: 30, label: '30 Days' },
    { value: 90, label: '90 Days' },
    { value: 180, label: '6 Months' },
    { value: 365, label: '1 Year' },
    { value: 730, label: '2 Years' },
    { value: 0, label: 'Lifetime' },
];

export function PaymentConfigDialog({
    open,
    onOpenChange,
    currentConfig,
    paymentOptions,
    onSave,
}: PaymentConfigDialogProps) {
    const [useExisting, setUseExisting] = useState(!!currentConfig.payment_option_id);
    const [config, setConfig] = useState<PaymentConfig>(currentConfig);

    useEffect(() => {
        if (open) {
            setConfig(currentConfig);
            setUseExisting(!!currentConfig.payment_option_id);
        }
    }, [open, currentConfig]);

    const selectedPaymentOption = paymentOptions.find((p) => p.id === config.payment_option_id);

    const handleSave = () => {
        if (useExisting && config.payment_option_id && selectedPaymentOption) {
            onSave({
                payment_option_id: config.payment_option_id,
                payment_type: selectedPaymentOption.type,
            });
        } else {
            const { payment_option_id, ...rest } = config;
            onSave(rest);
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Configure Payment</DialogTitle>
                    <DialogDescription>
                        Set up pricing and payment options for this{' '}
                        {getTerminology(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}
                        .
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Use Existing Payment Option */}
                    {paymentOptions.length > 0 && (
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <Label className="text-sm font-medium">
                                    Use Existing Payment Option
                                </Label>
                                <p className="text-xs text-neutral-500">
                                    Select from your institute's payment options
                                </p>
                            </div>
                            <Switch checked={useExisting} onCheckedChange={setUseExisting} />
                        </div>
                    )}

                    {useExisting && paymentOptions.length > 0 ? (
                        <div className="space-y-2">
                            <Label className="text-sm">Select Payment Option</Label>
                            <Select
                                value={config.payment_option_id || ''}
                                onValueChange={(value) =>
                                    setConfig({ ...config, payment_option_id: value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a payment option" />
                                </SelectTrigger>
                                <SelectContent>
                                    {paymentOptions.map((option) => (
                                        <SelectItem key={option.id} value={option.id}>
                                            <div className="flex flex-col">
                                                <span>{option.name}</span>
                                                <span className="text-xs text-neutral-500">
                                                    {option.type} -{' '}
                                                    {option.price
                                                        ? `${option.currency} ${formatPlanPrice(option.price)}`
                                                        : 'Free'}
                                                </span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedPaymentOption && (
                                <div className="rounded-lg bg-neutral-50 p-3 text-sm">
                                    <p className="font-medium">{selectedPaymentOption.name}</p>
                                    <p className="text-neutral-600">
                                        Type: {selectedPaymentOption.type}
                                    </p>
                                    {selectedPaymentOption.price && (
                                        <p className="text-neutral-600">
                                            Price: {selectedPaymentOption.currency}{' '}
                                            {formatPlanPrice(selectedPaymentOption.price)}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Payment Type */}
                            <div className="space-y-2">
                                <Label className="text-sm">Payment Type</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {PAYMENT_TYPES.map((type) => (
                                        <button
                                            key={type.value}
                                            onClick={() =>
                                                setConfig({ ...config, payment_type: type.value })
                                            }
                                            className={`rounded-lg border p-3 text-left transition-colors ${
                                                config.payment_type === type.value
                                                    ? 'border-primary-500 bg-primary-50'
                                                    : 'border-neutral-200 hover:border-neutral-300'
                                            }`}
                                        >
                                            <p className="text-sm font-medium">{type.label}</p>
                                            <p className="text-xs text-neutral-500">
                                                {type.description}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Price (for ONE_TIME and SUBSCRIPTION) */}
                            {(config.payment_type === 'ONE_TIME' ||
                                config.payment_type === 'SUBSCRIPTION') && (
                                <>
                                    {/* Currency */}
                                    <div className="space-y-2">
                                        <Label className="text-sm">Currency</Label>
                                        <Select
                                            value={config.currency || 'INR'}
                                            onValueChange={(value) =>
                                                setConfig({ ...config, currency: value })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {currencyOptions.map((opt) => (
                                                    <SelectItem key={opt.code} value={opt.code}>
                                                        {opt.symbol} - {opt.name} ({opt.code})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-sm">
                                                Price ({getCurrencySymbol(config.currency || 'INR')})
                                            </Label>
                                            <Input
                                                type="number"
                                                placeholder="Enter price"
                                                value={config.price || ''}
                                                onChange={(e) =>
                                                    setConfig({
                                                        ...config,
                                                        price: e.target.value
                                                            ? Number(e.target.value)
                                                            : undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm">
                                                Strike-through Price (optional)
                                            </Label>
                                            <Input
                                                type="number"
                                                placeholder="Original price"
                                                value={config.elevated_price || ''}
                                                onChange={(e) =>
                                                    setConfig({
                                                        ...config,
                                                        elevated_price: e.target.value
                                                            ? Number(e.target.value)
                                                            : undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>

                                    {/* Validity */}
                                    <div className="space-y-2">
                                        <Label className="text-sm">Access Validity</Label>
                                        <Select
                                            value={String(config.validity_in_days || 365)}
                                            onValueChange={(value) =>
                                                setConfig({
                                                    ...config,
                                                    validity_in_days:
                                                        value === '0' ? undefined : Number(value),
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {VALIDITY_OPTIONS.map((opt) => (
                                                    <SelectItem
                                                        key={opt.value}
                                                        value={String(opt.value)}
                                                    >
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            )}

                            {/* Subscription-specific options */}
                            {config.payment_type === 'SUBSCRIPTION' && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-sm text-amber-800">
                                        <strong>Note:</strong> Subscription billing will be set up
                                        automatically based on the validity period selected.
                                    </p>
                                </div>
                            )}

                            {/* Require Approval */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-sm">Require Approval</Label>
                                    <p className="text-xs text-neutral-500">
                                        Admin must approve enrollments
                                    </p>
                                </div>
                                <Switch
                                    checked={config.require_approval || false}
                                    onCheckedChange={(checked) =>
                                        setConfig({ ...config, require_approval: checked })
                                    }
                                />
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave}>Save Payment Config</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
