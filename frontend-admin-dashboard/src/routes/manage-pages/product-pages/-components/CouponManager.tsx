import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { createProductPageCoupon, deleteProductPageCoupon } from '../-services/product-pages-service';
import { Trash2, Plus, Tag } from 'lucide-react';
import { MyButton } from '@/components/design-system/button';
import type { ProductPageCouponRequest } from '../-types/product-page-types';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface LocalCoupon {
    id: string;
    code: string;
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    maxDiscountValue?: number;
    maxUses?: number;
    minItems?: number;
    redeemEndDate?: string;
}

interface CouponManagerProps {
    productPageId: string;
}

export const CouponManager = ({ productPageId }: CouponManagerProps) => {
    const { toast } = useToast();
    const [coupons, setCoupons] = useState<LocalCoupon[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<{
        code: string;
        discountType: 'PERCENTAGE' | 'FIXED';
        discountValue: string;
        maxDiscountValue: string;
        maxUses: string;
        minItems: string;
        redeemEndDate: string;
    }>({
        code: '',
        discountType: 'PERCENTAGE',
        discountValue: '',
        maxDiscountValue: '',
        maxUses: '',
        minItems: '',
        redeemEndDate: '',
    });

    const createMutation = useMutation({
        mutationFn: (data: ProductPageCouponRequest) =>
            createProductPageCoupon(productPageId, data),
        onSuccess: (_data, variables) => {
            toast({ title: 'Coupon created', description: `Code "${variables.code}" is live` });
            setCoupons((prev) => [
                ...prev,
                {
                    id: `local-${Date.now()}`,
                    code: variables.code,
                    discountType: variables.discount_type as 'PERCENTAGE' | 'FIXED',
                    discountValue: variables.discount_value,
                    maxDiscountValue: variables.max_discount_value,
                    maxUses: variables.max_uses,
                    minItems: variables.min_items,
                    redeemEndDate: variables.redeem_end_date,
                },
            ]);
            setForm({ code: '', discountType: 'PERCENTAGE', discountValue: '', maxDiscountValue: '', maxUses: '', minItems: '', redeemEndDate: '' });
            setShowForm(false);
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to create coupon', variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (couponCodeId: string) => deleteProductPageCoupon(couponCodeId),
        onSuccess: (_, couponCodeId) => {
            toast({ title: 'Deleted', description: 'Coupon deleted' });
            setCoupons((prev) => prev.filter((c) => c.id !== couponCodeId));
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to delete coupon', variant: 'destructive' });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.code.trim() || !form.discountValue) return;
        const payload: ProductPageCouponRequest = {
            code: form.code.trim().toUpperCase(),
            discount_type: form.discountType,
            discount_value: parseFloat(form.discountValue),
            max_discount_value: form.maxDiscountValue ? parseFloat(form.maxDiscountValue) : undefined,
            max_uses: form.maxUses ? parseInt(form.maxUses, 10) : undefined,
            min_items: form.minItems ? parseInt(form.minItems, 10) : undefined,
            redeem_end_date: form.redeemEndDate || undefined,
        };
        createMutation.mutate(payload);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-neutral-500">
                    Coupons are validated at checkout. Learners enter the code in the cart step.
                </p>
                <MyButton
                    scale="small"
                    buttonType="secondary"
                    onClick={() => setShowForm(true)}
                >
                    <Plus className="size-3.5" />
                    Add Coupon
                </MyButton>
            </div>

            {/* Add form */}
            {showForm && (
                <div className="rounded-xl border border-primary-100 bg-primary-50/30 p-4">
                    <h4 className="mb-4 text-sm font-semibold text-neutral-800">New Coupon</h4>
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-xs text-neutral-500">Coupon Code</Label>
                                <Input
                                    placeholder="SAVE20"
                                    value={form.code}
                                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                    className="font-mono uppercase focus:border-primary-400 focus:ring-primary-300"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-neutral-500">Discount Type</Label>
                                <select
                                    value={form.discountType}
                                    onChange={(e) =>
                                        setForm({ ...form, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })
                                    }
                                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-300"
                                >
                                    <option value="PERCENTAGE">Percentage (%)</option>
                                    <option value="FIXED">Fixed Amount</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-neutral-500">
                                    Value{form.discountType === 'PERCENTAGE' ? ' (%)' : ''}
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={form.discountType === 'PERCENTAGE' ? 100 : undefined}
                                    step="0.01"
                                    placeholder={form.discountType === 'PERCENTAGE' ? '20' : '500'}
                                    value={form.discountValue}
                                    onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                                    className="focus:border-primary-400 focus:ring-primary-300"
                                />
                            </div>
                            {form.discountType === 'PERCENTAGE' && (
                                <div className="space-y-1">
                                    <Label className="text-xs text-neutral-500">Max Cap</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        placeholder="1000"
                                        value={form.maxDiscountValue}
                                        onChange={(e) => setForm({ ...form, maxDiscountValue: e.target.value })}
                                        className="focus:border-primary-400 focus:ring-primary-300"
                                    />
                                </div>
                            )}
                            <div className="space-y-1">
                                <Label className="text-xs text-neutral-500">Max Uses</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder="Unlimited"
                                    value={form.maxUses}
                                    onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                                    className="focus:border-primary-400 focus:ring-primary-300"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-neutral-500">
                                    Minimum{' '}
                                    {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
                                </Label>
                                <Input
                                    type="number"
                                    min={2}
                                    placeholder="No minimum"
                                    value={form.minItems}
                                    onChange={(e) => setForm({ ...form, minItems: e.target.value })}
                                    className="focus:border-primary-400 focus:ring-primary-300"
                                />
                                <p className="text-caption text-neutral-400">
                                    Only usable once the cart holds this many{' '}
                                    {getTerminologyPlural(
                                        ContentTerms.Course,
                                        SystemTerms.Course
                                    ).toLocaleLowerCase()}
                                    .
                                </p>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs text-neutral-500">Expiry Date (optional)</Label>
                            <Input
                                type="datetime-local"
                                value={form.redeemEndDate}
                                onChange={(e) => setForm({ ...form, redeemEndDate: e.target.value })}
                                className="focus:border-primary-400 focus:ring-primary-300"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowForm(false)}
                            >
                                Cancel
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                disable={!form.code.trim() || !form.discountValue || createMutation.isPending}
                            >
                                {createMutation.isPending ? 'Creating...' : 'Create Coupon'}
                            </MyButton>
                        </div>
                    </form>
                </div>
            )}

            {/* Coupon list */}
            {coupons.length === 0 && !showForm ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-white py-12 text-center">
                    <Tag className="mb-2 size-8 text-neutral-300" />
                    <p className="text-sm text-neutral-400">No coupons yet. Add one above.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {coupons.map((coupon) => (
                        <div
                            key={coupon.id}
                            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3"
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="rounded bg-primary-50 px-2 py-0.5 font-mono text-sm font-semibold text-primary-700">
                                    {coupon.code}
                                </span>
                                <span className="text-sm text-neutral-600">
                                    {coupon.discountType === 'PERCENTAGE'
                                        ? `${coupon.discountValue}% off`
                                        : `${coupon.discountValue} off`}
                                    {coupon.maxDiscountValue ? ` (max ${coupon.maxDiscountValue})` : ''}
                                </span>
                                {coupon.minItems && (
                                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-caption text-neutral-500">
                                        min {coupon.minItems}{' '}
                                        {getTerminologyPlural(
                                            ContentTerms.Course,
                                            SystemTerms.Course
                                        ).toLocaleLowerCase()}
                                    </span>
                                )}
                                {coupon.maxUses && (
                                    <span className="text-xs text-neutral-400">
                                        max {coupon.maxUses} uses
                                    </span>
                                )}
                                {coupon.redeemEndDate && (
                                    <span className="text-xs text-neutral-400">
                                        expires {new Date(coupon.redeemEndDate).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                disable={deleteMutation.isPending}
                                onClick={() => deleteMutation.mutate(coupon.id)}
                            >
                                <Trash2 className="size-3.5 text-danger-500" />
                            </MyButton>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
