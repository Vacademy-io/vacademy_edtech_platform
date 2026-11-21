import { useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    MoreHorizontal,
    Edit,
    Plus,
    Minus,
    Infinity as InfinityIcon,
    AlertTriangle,
    Loader2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import { PackageSessionInventory } from '../-types/inventory-types';
import { UpdateCapacityDialog } from './update-capacity-dialog';
import { HeldSlots } from './held-slots';
import { useReserveSlot, useReleaseSlot } from '../-hooks/use-inventory-data';
import { toast } from 'sonner';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface InventoryTableViewProps {
    items: PackageSessionInventory[];
    isLoading: boolean;
    page: number;
    totalPages: number;
    totalElements: number;
    onPageChange: (page: number) => void;
}

export const InventoryTableView = ({
    items,
    isLoading,
    page,
    totalPages,
    totalElements,
    onPageChange,
}: InventoryTableViewProps) => {
    const [selectedItem, setSelectedItem] = useState<PackageSessionInventory | null>(null);
    const [isCapacityDialogOpen, setIsCapacityDialogOpen] = useState(false);

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

        try {
            await reserveSlot.mutateAsync(item.id);
            toast.success('Slot reserved successfully');
        } catch (error) {
            toast.error('Failed to reserve slot');
        }
    };

    const handleRelease = async (item: PackageSessionInventory) => {
        if (item.isUnlimited) {
            toast.info('This session has unlimited capacity');
            return;
        }

        try {
            await releaseSlot.mutateAsync(item.id);
            toast.success('Slot released successfully');
        } catch (error) {
            toast.error('Failed to release slot');
        }
    };

    const getAvailabilityBadge = (item: PackageSessionInventory) => {
        if (item.isLoadingInventory || item.isUnlimited === undefined) {
            return <Skeleton className="h-6 w-20" />;
        }

        if (item.isUnlimited) {
            return (
                <Badge
                    variant="outline"
                    className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                    <InfinityIcon className="size-3" />
                    Unlimited
                </Badge>
            );
        }

        const available = item.availableSlots ?? 0;
        const max = item.maxSeats ?? 0;
        const percentage = max > 0 ? (available / max) * 100 : 0;

        if (percentage <= 10) {
            return (
                <Badge variant="destructive" className="animate-pulse gap-1">
                    <AlertTriangle className="size-3" />
                    Critical ({available}/{max})
                </Badge>
            );
        }

        if (percentage <= 20) {
            return (
                <Badge className="gap-1 border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                    <AlertTriangle className="size-3" />
                    Low ({available}/{max})
                </Badge>
            );
        }

        return (
            <Badge
                variant="secondary"
                className="gap-1 border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
            >
                {available}/{max} available
            </Badge>
        );
    };

    const getCapacityDisplay = (item: PackageSessionInventory) => {
        if (item.isLoadingInventory || item.maxSeats === undefined) {
            return <Skeleton className="h-4 w-12" />;
        }

        if (item.isUnlimited) {
            return <span className="text-muted-foreground">∞</span>;
        }

        return item.maxSeats?.toLocaleString() ?? '-';
    };

    const getAvailableDisplay = (item: PackageSessionInventory) => {
        if (item.isLoadingInventory || item.availableSlots === undefined) {
            return <Skeleton className="h-4 w-12" />;
        }

        if (item.isUnlimited) {
            return <span className="text-muted-foreground">∞</span>;
        }

        const available = item.availableSlots ?? 0;
        const max = item.maxSeats ?? 0;
        const percentage = max > 0 ? (available / max) * 100 : 100;

        if (percentage <= 10) {
            return (
                <span className="animate-pulse font-bold text-red-600 dark:text-red-400">
                    {available.toLocaleString()}
                </span>
            );
        }

        return (
            <span
                className={
                    percentage <= 20 ? 'font-semibold text-orange-600 dark:text-orange-400' : ''
                }
            >
                {available.toLocaleString()}
            </span>
        );
    };

    if (isLoading && items.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{`${getTerminologyPlural(ContentTerms.Package, SystemTerms.Package)} ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)} ${getTerminology(OtherTerms.Inventory, SystemTerms.Inventory)}`}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <Card className="border-0 shadow-lg">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-semibold">
                        {`${getTerminologyPlural(ContentTerms.Package, SystemTerms.Package)} ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)} ${getTerminology(OtherTerms.Inventory, SystemTerms.Inventory)}`}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                            ({totalElements} {getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {items.length === 0 ? (
                        <div className="p-10 text-center text-muted-foreground">
                            {`No ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()} match the current filters.`}
                        </div>
                    ) : (
                        <div className="rounded-md border-t">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead className="font-semibold">{getTerminology(ContentTerms.Course, SystemTerms.Course)}</TableHead>
                                        <TableHead className="font-semibold">{getTerminology(ContentTerms.Level, SystemTerms.Level)}</TableHead>
                                        <TableHead className="font-semibold">{getTerminology(ContentTerms.Session, SystemTerms.Session)}</TableHead>
                                        <TableHead className="text-center font-semibold">
                                            Max Seats
                                        </TableHead>
                                        <TableHead className="text-center font-semibold">
                                            Available
                                        </TableHead>
                                        <TableHead className="font-semibold">Status</TableHead>
                                        <TableHead className="text-right font-semibold">
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item) => (
                                        <TableRow
                                            key={item.id}
                                            className="transition-colors hover:bg-muted/30"
                                        >
                                            <TableCell className="max-w-[200px] truncate font-medium">
                                                {item.packageName}
                                            </TableCell>
                                            <TableCell className="max-w-[150px] truncate">
                                                {item.levelName}
                                            </TableCell>
                                            <TableCell className="max-w-[150px] truncate">
                                                {item.sessionName}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {getCapacityDisplay(item)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    {getAvailableDisplay(item)}
                                                    <HeldSlots item={item} />
                                                </div>
                                            </TableCell>
                                            <TableCell>{getAvailabilityBadge(item)}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            disabled={
                                                                reserveSlot.isPending ||
                                                                releaseSlot.isPending
                                                            }
                                                        >
                                                            {reserveSlot.isPending ||
                                                            releaseSlot.isPending ? (
                                                                <Loader2 className="size-4 animate-spin" />
                                                            ) : (
                                                                <MoreHorizontal className="size-4" />
                                                            )}
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        className="w-48"
                                                    >
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedItem(item);
                                                                setIsCapacityDialogOpen(true);
                                                            }}
                                                        >
                                                            <Edit className="mr-2 size-4" />
                                                            Update Capacity
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => handleReserve(item)}
                                                            disabled={
                                                                item.isUnlimited ||
                                                                item.availableSlots === 0
                                                            }
                                                        >
                                                            <Minus className="mr-2 size-4" />
                                                            Reserve Slot
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => handleRelease(item)}
                                                            disabled={item.isUnlimited}
                                                        >
                                                            <Plus className="mr-2 size-4" />
                                                            Release Slot
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t px-4 py-3">
                            <p className="text-sm text-muted-foreground">
                                Page {page + 1} of {totalPages}
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => onPageChange(0)}
                                    disabled={page === 0}
                                >
                                    <ChevronsLeft className="size-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => onPageChange(page - 1)}
                                    disabled={page === 0}
                                >
                                    <ChevronLeft className="size-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => onPageChange(page + 1)}
                                    disabled={page >= totalPages - 1}
                                >
                                    <ChevronRight className="size-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => onPageChange(totalPages - 1)}
                                    disabled={page >= totalPages - 1}
                                >
                                    <ChevronsRight className="size-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

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
