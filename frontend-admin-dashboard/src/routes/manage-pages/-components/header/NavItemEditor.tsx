import { HeaderChoice } from './HeaderEditorFields';
import { MegaMenuEditor } from './MegaMenuEditor';
import { NavDropdownEditor } from './NavDropdownEditor';
import { navItemTypePatch, type HeaderNavItemValue } from './header-editor-utils';

/**
 * What a header nav item opens: its link (as always), or a mega menu of
 * streams and categories. Shown inside the item's expanded editor; every
 * change is one patch of the item, so type + menu settings land together.
 */
export const NavItemEditor = ({
    item,
    onPatch,
}: {
    item: HeaderNavItemValue;
    onPatch: (patch: Partial<HeaderNavItemValue>) => void;
}) => {
    const isMega = item.type === 'megaMenu';
    const isDropdown = item.type === 'dropdown';
    return (
        <div className="space-y-3 border-t border-neutral-200 pt-2">
            <HeaderChoice
                label="Opens"
                value={isMega ? 'megaMenu' : isDropdown ? 'dropdown' : 'link'}
                options={[
                    { value: 'link', label: 'Its link' },
                    { value: 'dropdown', label: 'Dropdown' },
                    { value: 'megaMenu', label: 'Mega menu' },
                ]}
                onChange={(type) => onPatch(navItemTypePatch(item, type))}
            />
            {isDropdown && (
                <NavDropdownEditor
                    value={item.children || []}
                    onChange={(children) => onPatch({ children })}
                />
            )}
            {isMega && (
                <MegaMenuEditor
                    value={item.megaMenu || {}}
                    onChange={(megaMenu) => onPatch({ megaMenu })}
                />
            )}
        </div>
    );
};

export default NavItemEditor;
