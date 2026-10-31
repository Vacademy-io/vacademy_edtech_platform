import { useState } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
    Edit,
    Plus,
    Minus,
    Infinity as InfinityIcon,
    AlertTriangle,
    Loader2,
    GraduationCap,
    Calendar,
} from 'lucide-react';
import { PackageSessionInventory } from '../-types/inventory-types';
import { UpdateCapacityDialog } from './update-capacity-dialog';
import { HeldSlots } from './held-slots';
import { useReserveSlot, useReleaseSlot } from '../-hooks/use-inventory-data';
import { toast } from 'sonner';

interface InventoryCardViewProps {
    items: PackageSessionInventory[];
    isLoading: boolean;
}

export const InventoryCardView = ({ items, isLoading }: InventoryCardViewProps) => {
    const [selectedItem, setSelectedItem] = useState<PackageSessionInventory | null>(null);
    const [isCapacityDialogOpen, setIsCapacityDialogOpen] = useState(false);
    const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

    const reserveSlot = useReserveSlot();
    const releaseSlot = useReleaseSlot();

    const handleReserve = async (item: PackageSessionInventory) => {
        if (item.isUnlimited) {
            toast.info('This session has unlimited capacity');
            return;
        }
        if (item.availableSlots === 0) {
            toast.error('No slots available to reserve');
            return;
        }

        setLoadingItemId(item.id);
        try {
            await reserveSlot.mutateAsync(item.id);
            toast.success('Slot reserved successfully');
        } catch (error) {
            toast.error('Failed to reserve slot');
        } finally {
            setLoadingItemId(null);
        }
    };

    const handleRelease = async (item: PackageSessionInventory) => {
        if (item.isUnlimited) {
            toast.info('This session has unlimited capacity');
            return;
        }

        setLoadingItemId(item.id);
        try {
            await releaseSlot.mutateAsync(item.id);
            toast.success('Slot released successfully');
        } catch (error) {
            toast.error('Failed to release slot');
        } finally {
            setLoadingItemId(null);
        }
    };

    const getAvailabilityInfo = (item: PackageSessionInventory) => {
        if (item.isUnlimited) {
            return {
                percentage: 100,
                color: 'bg-emerald-500',
                textColor: 'text-emerald-600 dark:text-emerald-400',
                label: 'Unlimited',
                isLow: false,
            };
        }

        const available = item.availableSlots ?? 0;
        const max = item.maxSeats ?? 0;
        const percentage = max > 0 ? (available / max) * 100 : 0;

        if (percentage <= 10) {
            return {
                percentage,
                color: 'bg-red-500',
                textColor: 'text-red-600 dark:text-red-400',
                label: 'Critical',
                isLow: true,
            };
        }

        if (percentage <= 20) {
            return {
                percentage,
                color: 'bg-orange-500',
                textColor: 'text-orange-600 dark:text-orange-400',
                label: 'Low',
                isLow: true,
            };
        }

        if (percentage <= 50) {
            return {
                percentage,
                color: 'bg-yellow-500',
                textColor: 'text-yellow-600 dark:text-yellow-400',
                label: 'Moderate',
                isLow: false,
            };
        }

        return {
            percentage,
            color: 'bg-emerald-500',
            textColor: 'text-emerald-600 dark:text-emerald-400',
            label: 'Good',
            isLow: false,
        };
    };

    if (isLoading && items.length === 0) {
        return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Card key={i} className="overflow-hidden">
                        <CardContent className="space-y-4 p-6">
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-2 w-full" />
                        </CardContent>
                        <CardFooter className="p-4 pt-0">
                            <Skeleton className="h-9 w-full" />
                        </CardFooter>
                    </Card>
                ))}
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-muted-foreground">No sessions match the current filters.</p>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                    const availabilityInfo = getAvailabilityInfo(item);
                    const isItemLoading = loadingItemId === item.id;

                    return (
                        <Card
                            key={item.id}
                            className="group overflow-hidden border shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                        >
                            {/* Gradient Header Bar */}
                            <div
                                className={`h-1.5 ${
                                    item.isUnlimited
                                        ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
                                        : availabilityInfo.isLow
                                          ? 'bg-gradient-to-r from-orange-400 to-red-500'
                                          : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                                }`}
                            />

                            <CardContent className="space-y-4 p-5">
                                {/* Course Name */}
                                <div>
                                    <h3 className="group-hover:text-primary line-clamp-1 text-lg font-semibold text-foreground transition-colors">
                                        {item.packageName}
                                    </h3>
                                </div>

                                {/* Level & Session Info */}
                                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                        <GraduationCap className="size-4 shrink-0" />
                                        <span className="truncate">{item.levelName}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Calendar className="size-4 shrink-0" />
                                        <span className="truncate">{item.sessionName}</span>
                                    </div>
                                </div>

                                {/* Availability Section */}
                                <div className="space-y-2 border-t pt-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">
                                            Availability
                                        </span>
                                        {item.isLoadingInventory ? (
                                            <Skeleton className="h-5 w-20" />
                                        ) : item.isUnlimited ? (
                                            <Badge
                                                variant="outline"
                                                className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                            >
                                                <InfinityIcon className="size-3" />
                                                Unlimited
                                            </Badge>
                                        ) : (
                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                <span
                                                    className={`text-sm font-semibold ${availabilityInfo.textColor}`}
                                                >
                                                    {item.availableSlots?.toLocaleString()} /{' '}
                                                    {item.maxSeats?.toLocaleString()}
                                                </span>
                                                <HeldSlots item={item} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Progress Bar */}
                                    {!item.isUnlimited && !item.isLoadingInventory && (
                                        <div className="space-y-1">
                                            <Progress
                                                value={availabilityInfo.percentage}
                                                className="h-2"
                                            />
                                            <div className="flex items-center justify-between text-xs">
                                                <span className={availabilityInfo.textColor}>
                                                    {availabilityInfo.label}
                                                </span>
                                                <span className="text-muted-foreground">
                                                    {Math.round(availabilityInfo.percentage)}%
                                                    available
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {item.isLoadingInventory && !item.isUnlimited && (
                                        <Skeleton className="h-2 w-full" />
                                    )}
                                </div>

                                {/* Warning Badge */}
                                {availabilityInfo.isLow && !item.isLoadingInventory && (
                                    <div className="flex items-center gap-2 rounded-md bg-orange-50 p-2 text-xs text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                                        <AlertTriangle className="size-4" />
                                        <span>Low availability - consider increasing capacity</span>
                                    </div>
                                )}
                            </CardContent>

                            <CardFooter className="flex gap-2 p-4 pt-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 gap-1"
                                    onClick={() => {
                                        setSelectedItem(item);
                                        setIsCapacityDialogOpen(true);
                                    }}
                                >
                                    <Edit className="size-3.5" />
                                    Capacity
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1"
                                    onClick={() => handleReserve(item)}
                                    disabled={
                                        item.isUnlimited ||
                                        item.availableSlots === 0 ||
                                        isItemLoading
                                    }
                                >
                                    {isItemLoading && reserveSlot.isPending ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <Minus className="size-3.5" />
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1"
                                    onClick={() => handleRelease(item)}
                                    disabled={item.isUnlimited || isItemLoading}
                                >
                                    {isItemLoading && releaseSlot.isPending ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <Plus className="size-3.5" />
                                    )}
                                </Button>
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>

            {/* Update Capacity Dialog */}
            <UpdateCapacityDialog
                isOpen={isCapacityDialogOpen}
                onClose={() => {
                    setIsCapacityDialogOpen(false);
                    setSelectedItem(null);
                }}
                item={selectedItem}
            />
        </>
    );
};
