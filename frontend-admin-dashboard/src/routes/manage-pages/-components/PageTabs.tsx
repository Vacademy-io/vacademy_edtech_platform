import { useEditorStore } from '../-stores/editor-store';
import { Button } from '@/components/ui/button';
import { Settings, Plus, Copy, Trash2, MoreVertical } from 'lucide-react'; // design-lint-ignore: legacy icon set, migrated incrementally
import { PencilSimple, Sparkle } from '@phosphor-icons/react';
import { AiPageWizard } from './AiPageWizard';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getComponentTemplate } from '../-utils/component-templates';
import { HOME_ROUTES } from '../-utils/rename-page';

// Converts arbitrary text into a safe URL slug: lowercase, hyphens, no special chars
const toSlug = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

const pageLabel = (page: { title?: string; route: string }) => page.title || page.route;

export const PageTabs = () => {
    const { t: tTemplates } = useTranslation('managePagesComponentTemplates');
    const {
        config,
        selectPage,
        selectedPageId,
        selectGlobalSettings,
        selectedGlobalSettings,
        addPage,
        deletePage,
        duplicatePage,
        renamePage,
    } = useEditorStore();

    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showAiWizard, setShowAiWizard] = useState(false);
    const [newPageRoute, setNewPageRoute] = useState('');
    const [newPageTitle, setNewPageTitle] = useState('');
    // A page is either built from components or pasted as HTML — never both,
    // so the choice is made here at creation rather than being a mode you can
    // flip later and lose work to.
    const [newPageIsHtml, setNewPageIsHtml] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [renameTitle, setRenameTitle] = useState('');
    const [renameRoute, setRenameRoute] = useState('');

    if (!config) return null;

    // Two pages with the same title ("Courses | Courses") are told apart by route.
    const labelCounts = new Map<string, number>();
    config.pages.forEach((p) =>
        labelCounts.set(pageLabel(p), (labelCounts.get(pageLabel(p)) ?? 0) + 1)
    );

    const slugPreview = toSlug(newPageRoute);
    const isRouteConflict = !!slugPreview && config.pages.some((p) => p.route === slugPreview);

    const handleAddPage = () => {
        if (!slugPreview || isRouteConflict) return;
        const newPage = {
            id: `page-${Date.now()}`,
            route: slugPreview,
            title: newPageTitle.trim() || undefined,
            components: newPageIsHtml
                ? [{ ...getComponentTemplate('htmlPage', tTemplates), id: `htmlpage-${Date.now()}` }]
                : [],
            // A pasted page nearly always brings its own nav and footer.
            ...(newPageIsHtml ? { hideSiteChrome: true } : {}),
        };
        addPage(newPage);
        setNewPageRoute('');
        setNewPageTitle('');
        setNewPageIsHtml(false);
        setShowAddDialog(false);
    };

    const renamingPage = config.pages.find((p) => p.id === renameTarget);
    // The home page is the site root: its slug stays, only its title changes.
    const renamingHome = HOME_ROUTES.has(
        (renamingPage?.route ?? '').replace(/^\//, '').toLowerCase()
    );
    const renameSlug = toSlug(renameRoute);
    const isRenameConflict =
        !!renameSlug && config.pages.some((p) => p.id !== renameTarget && p.route === renameSlug);
    const canRename = !!renamingPage && (renamingHome || (!!renameSlug && !isRenameConflict));

    const openRename = (pageId: string) => {
        const target = config.pages.find((p) => p.id === pageId);
        if (!target) return;
        setRenameTitle(target.title ?? '');
        setRenameRoute(target.route ?? '');
        setRenameTarget(pageId);
    };

    const handleRename = () => {
        if (!renamingPage || !canRename) return;
        renamePage(renamingPage.id, renameTitle, renamingHome ? renamingPage.route : renameSlug);
        setRenameTarget(null);
    };

    const handleDeletePage = (pageId: string) => {
        if (config.pages.length <= 1) return; // button is disabled, but guard anyway
        setDeleteTarget(pageId);
    };

    const confirmDelete = () => {
        if (deleteTarget) deletePage(deleteTarget);
        setDeleteTarget(null);
    };

    return (
        <>
            <div className="flex gap-1 overflow-x-auto p-1">
                <Button
                    variant={selectedGlobalSettings ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => selectGlobalSettings()}
                    className="gap-1"
                >
                    <Settings className="size-4" />
                    Global Settings
                </Button>
                <div className="mx-2 h-8 w-px bg-gray-300" />
                {config.pages.map((page) => (
                    <div key={page.id} className="group flex items-center">
                        <Button
                            variant={selectedPageId === page.id ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => selectPage(page.id)}
                            className="gap-1.5 pr-1"
                        >
                            {(labelCounts.get(pageLabel(page)) ?? 0) > 1 ? (
                                <span className="flex flex-col items-start leading-tight">
                                    <span>{pageLabel(page)}</span>
                                    <span className="font-mono text-2xs text-gray-400">
                                        /{(page.route ?? '').replace(/^\//, '')}
                                    </span>
                                </span>
                            ) : (
                                pageLabel(page)
                            )}
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0 opacity-0 group-hover:opacity-100"
                                >
                                    <MoreVertical className="size-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            {/* Per-page publish toggle removed: the flag was never
                                enforced on the learner side — the site-level
                                Draft/Publish in the header is the single gate. */}
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => openRename(page.id)}>
                                    <PencilSimple className="mr-2 size-4" />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => duplicatePage(page.id)}>
                                    <Copy className="mr-2 size-4" />
                                    Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => handleDeletePage(page.id)}
                                    className="text-red-600"
                                    disabled={config.pages.length <= 1}
                                >
                                    <Trash2 className="mr-2 size-4" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ))}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddDialog(true)}
                    className="gap-1 text-gray-500 hover:text-gray-700"
                >
                    <Plus className="size-4" />
                    Add Page
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAiWizard(true)}
                    className="gap-1 text-primary-500 hover:text-primary-400"
                >
                    <Sparkle className="size-4" weight="duotone" />
                    AI Page
                </Button>
            </div>

            {/* AI Page Wizard */}
            <AiPageWizard open={showAiWizard} onOpenChange={setShowAiWizard} />

            {/* Delete confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete page?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove the page and all its components. This
                            action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Rename Page Dialog */}
            <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename Page</DialogTitle>
                    </DialogHeader>
                    <div
                        className="space-y-4 py-4"
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="rename-title">Page Title</Label>
                            <Input
                                id="rename-title"
                                value={renameTitle}
                                onChange={(e) => setRenameTitle(e.target.value)}
                                placeholder="e.g., Courses"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rename-route">Route Slug</Label>
                            <Input
                                id="rename-route"
                                value={renamingHome ? renamingPage?.route ?? '' : renameRoute}
                                onChange={(e) => setRenameRoute(e.target.value)}
                                disabled={renamingHome}
                                className={isRenameConflict ? 'border-red-400' : ''}
                            />
                            {renamingHome ? (
                                <p className="text-xs text-gray-400">
                                    The home page&apos;s address can&apos;t change.
                                </p>
                            ) : isRenameConflict ? (
                                <p className="text-xs text-red-500">
                                    A page with this route already exists.
                                </p>
                            ) : renameSlug && renameSlug !== renamingPage?.route ? (
                                <p className="text-xs text-gray-400">
                                    New address: <span className="font-mono">/{renameSlug}</span>.
                                    Menu items and buttons linking to this page are updated too.
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameTarget(null)}>
                            Cancel
                        </Button>
                        <Button onClick={handleRename} disabled={!canRename}>
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add Page Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add New Page</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="route">Route Slug *</Label>
                            <Input
                                id="route"
                                value={newPageRoute}
                                onChange={(e) => setNewPageRoute(e.target.value)}
                                placeholder="e.g., about-us"
                                className={isRouteConflict ? 'border-red-400' : ''}
                            />
                            {slugPreview && slugPreview !== newPageRoute && (
                                <p className="text-xs text-gray-400">
                                    Slug: <span className="font-mono">{slugPreview}</span>
                                </p>
                            )}
                            {isRouteConflict && (
                                <p className="text-xs text-red-500">
                                    A page with this route already exists.
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="title">Page Title (Optional)</Label>
                            <Input
                                id="title"
                                value={newPageTitle}
                                onChange={(e) => setNewPageTitle(e.target.value)}
                                placeholder="e.g., About Us"
                            />
                        </div>
                        <div className="space-y-2 rounded border bg-gray-50 p-3">
                            <Label className="text-xs">How will you build it?</Label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setNewPageIsHtml(false)}
                                    className={`flex-1 rounded border p-2 text-left text-caption ${
                                        !newPageIsHtml
                                            ? 'border-primary-400 bg-primary-50 text-primary-500'
                                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                    }`}
                                >
                                    <span className="block text-xs font-medium">Visual builder</span>
                                    Drag in sections and edit them
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNewPageIsHtml(true)}
                                    className={`flex-1 rounded border p-2 text-left text-caption ${
                                        newPageIsHtml
                                            ? 'border-primary-400 bg-primary-50 text-primary-500'
                                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                    }`}
                                >
                                    <span className="block text-xs font-medium">HTML page</span>
                                    Paste HTML you built elsewhere
                                </button>
                            </div>
                            {newPageIsHtml && (
                                <p className="text-caption text-gray-500">
                                    You&apos;ll paste HTML and CSS instead of using the canvas. Scripts and
                                    forms are removed for safety — use the action attributes to link,
                                    scroll, or open a lead form. This choice can&apos;t be changed later.
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleAddPage} disabled={!slugPreview || isRouteConflict}>
                            Add Page
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
