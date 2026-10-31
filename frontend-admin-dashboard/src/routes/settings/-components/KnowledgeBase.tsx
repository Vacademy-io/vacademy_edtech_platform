import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    BookOpen,
    Plus,
    PencilSimple,
    Trash,
    MagnifyingGlass,
    CaretDown,
    CaretUp,
} from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KnowledgeItem {
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

const buildCategories = (t: TFunction) => [
    { value: 'event', label: t('categories.event') },
    { value: 'policy', label: t('categories.policy') },
    { value: 'process', label: t('categories.process') },
    { value: 'faq', label: t('categories.faq') },
    { value: 'announcement', label: t('categories.announcement') },
    { value: 'result', label: t('categories.result') },
    { value: 'general', label: t('categories.general') },
];

const CATEGORY_COLORS: Record<string, string> = {
    event: 'bg-blue-100 text-blue-800',
    policy: 'bg-purple-100 text-purple-800',
    process: 'bg-green-100 text-green-800',
    faq: 'bg-amber-100 text-amber-800',
    announcement: 'bg-red-100 text-red-800',
    result: 'bg-teal-100 text-teal-800',
    general: 'bg-gray-100 text-gray-800',
};

// ─── Component ───────────────────────────────────────────────────────────────

const KnowledgeBase: React.FC = () => {
    const { t } = useTranslation('settingsKnowledgeBase');
    const CATEGORIES = buildCategories(t);
    const [items, setItems] = useState<KnowledgeItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Search & filter
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState<string>('all');

    // Form dialog
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
    const [formTitle, setFormTitle] = useState('');
    const [formCategory, setFormCategory] = useState('general');
    const [formContent, setFormContent] = useState('');
    const [formTags, setFormTags] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Delete confirmation
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const instituteId = getInstituteId();

    // ─── Fetch items ─────────────────────────────────────────────────────────

    const fetchItems = useCallback(async () => {
        if (!instituteId) return;
        setIsLoading(true);
        try {
            const response = await authenticatedAxiosInstance.get<KnowledgeItem[]>(
                `${AI_SERVICE_BASE_URL}/knowledge-base/v1/institute/${instituteId}/items`
            );
            setItems(response.data || []);
        } catch (error: any) {
            if (error.response?.status !== 404) {
                console.error('Error fetching knowledge base items:', error);
                toast.error(t('toasts.loadFailed'));
            }
        } finally {
            setIsLoading(false);
        }
    }, [instituteId]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    // ─── Create / Update ─────────────────────────────────────────────────────

    const openCreateForm = () => {
        setEditingItem(null);
        setFormTitle('');
        setFormCategory('general');
        setFormContent('');
        setFormTags('');
        setIsFormOpen(true);
    };

    const openEditForm = (item: KnowledgeItem) => {
        setEditingItem(item);
        setFormTitle(item.title);
        setFormCategory(item.category);
        setFormContent(item.content);
        setFormTags(item.tags?.join(', ') || '');
        setIsFormOpen(true);
    };

    const handleSave = async () => {
        if (!instituteId) return;
        if (!formTitle.trim()) {
            toast.error(t('toasts.titleRequired'));
            return;
        }
        if (!formContent.trim()) {
            toast.error(t('toasts.contentRequired'));
            return;
        }

        setIsSaving(true);
        const tags = formTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);

        const payload = {
            title: formTitle.trim(),
            content: formContent.trim(),
            category: formCategory,
            tags,
        };

        try {
            if (editingItem) {
                await authenticatedAxiosInstance.put(
                    `${AI_SERVICE_BASE_URL}/knowledge-base/v1/institute/${instituteId}/items/${editingItem.id}`,
                    payload
                );
                toast.success(t('toasts.itemUpdated'));
            } else {
                await authenticatedAxiosInstance.post(
                    `${AI_SERVICE_BASE_URL}/knowledge-base/v1/institute/${instituteId}/items`,
                    payload
                );
                toast.success(t('toasts.itemCreated'));
            }
            setIsFormOpen(false);
            await fetchItems();
        } catch (error) {
            console.error('Error saving knowledge item:', error);
            toast.error(t('toasts.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    // ─── Toggle active ───────────────────────────────────────────────────────

    const handleToggleActive = async (item: KnowledgeItem) => {
        if (!instituteId) return;
        try {
            await authenticatedAxiosInstance.put(
                `${AI_SERVICE_BASE_URL}/knowledge-base/v1/institute/${instituteId}/items/${item.id}`,
                {
                    title: item.title,
                    content: item.content,
                    category: item.category,
                    tags: item.tags,
                    is_active: !item.is_active,
                }
            );
            setItems((prev) =>
                prev.map((i) => (i.id === item.id ? { ...i, is_active: !i.is_active } : i))
            );
            toast.success(!item.is_active ? t('toasts.itemActivated') : t('toasts.itemDeactivated'));
        } catch (error) {
            console.error('Error toggling item:', error);
            toast.error(t('toasts.toggleFailed'));
        }
    };

    // ─── Delete ──────────────────────────────────────────────────────────────

    const handleDelete = async () => {
        if (!instituteId || !deleteItemId) return;
        setIsDeleting(true);
        try {
            await authenticatedAxiosInstance.delete(
                `${AI_SERVICE_BASE_URL}/knowledge-base/v1/institute/${instituteId}/items/${deleteItemId}`
            );
            setItems((prev) => prev.filter((i) => i.id !== deleteItemId));
            toast.success(t('toasts.itemDeleted'));
        } catch (error) {
            console.error('Error deleting knowledge item:', error);
            toast.error(t('toasts.deleteFailed'));
        } finally {
            setIsDeleting(false);
            setDeleteItemId(null);
        }
    };

    // ─── Filtered items ──────────────────────────────────────────────────────

    const filteredItems = items.filter((item) => {
        const matchesSearch =
            !searchQuery ||
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesCategory = filterCategory === 'all' || item.category === filterCategory;
        return matchesSearch && matchesCategory;
    });

    // ─── Render ──────────────────────────────────────────────────────────────

    return (
        <>
            <Card className="border-indigo-100 shadow-sm">
                <CardHeader
                    className="cursor-pointer border-b border-indigo-50 bg-indigo-50/30"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                <BookOpen className="size-5" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">{t('header.title')}</CardTitle>
                                <CardDescription>{t('header.description')}</CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                {t('header.itemCount', { count: items.length })}
                            </span>
                            {isCollapsed ? (
                                <CaretDown className="size-5 text-gray-400" />
                            ) : (
                                <CaretUp className="size-5 text-gray-400" />
                            )}
                        </div>
                    </div>
                </CardHeader>

                {!isCollapsed && (
                    <CardContent className="space-y-4 pt-6">
                        {/* Toolbar: Search, Filter, Add */}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-1 gap-2">
                                <div className="relative flex-1 max-w-sm">
                                    <MagnifyingGlass className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                                    <Input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={t('toolbar.searchPlaceholder')}
                                        className="border-indigo-100 pl-9 focus:border-indigo-300"
                                    />
                                </div>
                                <Select value={filterCategory} onValueChange={setFilterCategory}>
                                    <SelectTrigger className="w-36 border-indigo-100">
                                        <SelectValue placeholder={t('toolbar.allCategories')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">{t('toolbar.allCategories')}</SelectItem>
                                        {CATEGORIES.map((cat) => (
                                            <SelectItem key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button
                                onClick={openCreateForm}
                                className="bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                                <Plus className="mr-1 size-4" />
                                {t('toolbar.addButton')}
                            </Button>
                        </div>

                        {/* Items list */}
                        {isLoading ? (
                            <div className="flex h-32 items-center justify-center">
                                <div className="size-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                            </div>
                        ) : filteredItems.length === 0 ? (
                            <div className="py-12 text-center">
                                <BookOpen className="mx-auto mb-3 size-10 text-gray-300" />
                                <p className="text-sm text-gray-500">
                                    {items.length === 0
                                        ? t('list.emptyNoItems')
                                        : t('list.emptyNoMatch')}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center justify-between rounded-lg border border-indigo-50 bg-white p-4 transition-colors hover:bg-indigo-50/30"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <h4 className="truncate text-sm font-medium text-gray-900">
                                                    {item.title}
                                                </h4>
                                                <Badge
                                                    className={`shrink-0 border-0 text-2xs ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.general}`}
                                                >
                                                    {item.category}
                                                </Badge>
                                                {!item.is_active && (
                                                    <Badge variant="outline" className="shrink-0 text-2xs text-gray-400">
                                                        {t('list.inactiveBadge')}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                                                {item.content}
                                            </p>
                                            {item.tags && item.tags.length > 0 && (
                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                    {item.tags.map((tag, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-600"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="ml-4 flex shrink-0 items-center gap-2">
                                            <Switch
                                                checked={item.is_active}
                                                onCheckedChange={() => handleToggleActive(item)}
                                            />
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="size-8 border-indigo-100 text-indigo-600 hover:bg-indigo-50"
                                                onClick={() => openEditForm(item)}
                                            >
                                                <PencilSimple className="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="size-8 border-red-200 text-red-600 hover:bg-red-50"
                                                onClick={() => setDeleteItemId(item.id)}
                                            >
                                                <Trash className="size-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                )}
            </Card>

            {/* ─── Create / Edit Dialog ─────────────────────────────────────── */}
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editingItem ? t('form.editTitle') : t('form.addTitle')}
                        </DialogTitle>
                        <DialogDescription>
                            {editingItem
                                ? t('form.editDescription')
                                : t('form.addDescription')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="kb-title" className="text-sm font-medium">
                                {t('form.titleLabel')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="kb-title"
                                value={formTitle}
                                onChange={(e) => setFormTitle(e.target.value)}
                                placeholder={t('form.titlePlaceholder')}
                                className="border-indigo-100 focus:border-indigo-300"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="kb-category" className="text-sm font-medium">
                                {t('form.categoryLabel')}
                            </Label>
                            <Select value={formCategory} onValueChange={setFormCategory}>
                                <SelectTrigger
                                    id="kb-category"
                                    className="border-indigo-100 focus:border-indigo-300"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map((cat) => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="kb-content" className="text-sm font-medium">
                                {t('form.contentLabel')} <span className="text-red-500">*</span>
                            </Label>
                            <textarea
                                id="kb-content"
                                value={formContent}
                                onChange={(e) => setFormContent(e.target.value)}
                                placeholder={t('form.contentPlaceholder')}
                                rows={6}
                                className="w-full rounded-md border border-indigo-100 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                            />
                            <p className="text-2xs text-gray-500">
                                {t('form.contentHint')}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="kb-tags" className="text-sm font-medium">
                                {t('form.tagsLabel')}
                            </Label>
                            <Input
                                id="kb-tags"
                                value={formTags}
                                onChange={(e) => setFormTags(e.target.value)}
                                placeholder={t('form.tagsPlaceholder')}
                                className="border-indigo-100 focus:border-indigo-300"
                            />
                            <p className="text-2xs text-gray-500">
                                {t('form.tagsHint')}
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsFormOpen(false)}
                            disabled={isSaving}
                        >
                            {t('form.cancel')}
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                            {isSaving ? (
                                <>
                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {t('form.saving')}
                                </>
                            ) : editingItem ? (
                                t('form.updateItem')
                            ) : (
                                t('form.addItem')
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Delete Confirmation ──────────────────────────────────────── */}
            <AlertDialog open={!!deleteItemId} onOpenChange={(open) => !open && setDeleteItemId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>{t('deleteDialog.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-red-600 text-white hover:bg-red-700"
                        >
                            {isDeleting ? (
                                <>
                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {t('deleteDialog.deleting')}
                                </>
                            ) : (
                                t('deleteDialog.confirm')
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default KnowledgeBase;
