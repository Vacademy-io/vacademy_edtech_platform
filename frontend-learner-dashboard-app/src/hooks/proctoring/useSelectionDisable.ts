import { useEffect } from 'react'
import { CBE_WORKSPACE_SELECTOR } from '@/lib/cbe/workspace-dom'

type Props = {
  disabled?: boolean
}

const STYLE_ID = 'proctoring-cbe-selectable'

/**
 * Prevent user select
 *
 * A CBE answer workspace (`data-cbe-workspace`) stays selectable: the learner
 * has to select their own cells and text to format, copy and move them.
 */
export function useSelectionDisable({ disabled }: Props = { disabled: false }) {
  useEffect(() => {
    if (disabled) return

    const element = document.body

    const properties = [
      'user-select',
      '-webkit-user-select',
      '-ms-user-select',
      '-moz-user-select',
    ] as const

    properties.forEach((property) => element.style.setProperty(property, 'none'))

    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      // Only the root: descendants left on \`auto\` inherit \`text\` from it,
      // while the grid's own \`user-select: none\` chrome keeps working.
      style.textContent = `${CBE_WORKSPACE_SELECTOR} { -webkit-user-select: text; user-select: text; }`
      document.head.appendChild(style)
    }

    return () => {
      properties.forEach((property) => element.style.setProperty(property, 'auto'))
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [disabled])

  return
}
