import React, { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Radix sheets and popovers portal to <body>, outside the catalogue's theme
 * wrapper ([data-catalogue-theme] with the institute's --primary-* vars and
 * `dark`), so they would paint in the app's colours instead of the site's.
 * This surface copies the wrapper's catalogue attributes, its inline CSS
 * custom properties and its dark class onto the portalled content.
 *
 * The wrapper is found from `anchor` (any element inside the section) only
 * once the surface opens, so a closed sheet costs the section nothing.
 */

interface MirroredTheme {
  attrs: Record<string, string>;
  vars: Record<string, string>;
  dark: boolean;
}

const NO_THEME: MirroredTheme = { attrs: {}, vars: {}, dark: false };

const readTheme = (host: HTMLElement | null | undefined): MirroredTheme => {
  if (!host) return NO_THEME;
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  for (const name of host.getAttributeNames()) {
    if (name.startsWith("data-catalogue-") || name === "data-heading-scale") {
      attrs[name] = host.getAttribute(name) || "";
    }
  }
  for (let i = 0; i < host.style.length; i++) {
    const prop = host.style.item(i);
    if (prop.startsWith("--")) vars[prop] = host.style.getPropertyValue(prop);
  }
  return { attrs, vars, dark: host.classList.contains("dark") };
};

export const ThemedPortalSurface: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
}> = ({ anchor, className, children }) => {
  const [theme, setTheme] = useState<MirroredTheme>(NO_THEME);
  // Before paint, so the surface never flashes in the app's own colours.
  useLayoutEffect(() => {
    setTheme(readTheme(anchor.current?.closest<HTMLElement>("[data-catalogue-theme]")));
  }, [anchor]);
  return (
    <div
      {...theme.attrs}
      className={cn(theme.dark && "dark", className)}
      style={theme.vars as React.CSSProperties} // design-lint-ignore: the institute's theme vars, copied from the catalogue wrapper
    >
      {children}
    </div>
  );
};
