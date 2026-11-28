import { useCallback, useEffect } from "react"
import { isInsideCbeWorkspace } from "@/lib/cbe/workspace-dom"

type Props = {
  disabled?: boolean
}

/**
 * Prevent Copy-Paste
 *
 * Copy and cut stay allowed inside a CBE answer workspace (`data-cbe-workspace`):
 * moving figures between cells is part of answering. Pastes into the workspace
 * are policed separately (useCbeClipboardGuard) so outside text cannot get in.
 */
export function useCopyDisable({ disabled }: Props = { disabled: false }) {
  const handleCopy = useCallback((e: ClipboardEvent) => {
    if (isInsideCbeWorkspace(e.target)) return
    e.preventDefault()
  }, [])

  useEffect(() => {
    const removeListener = () => {
      document.removeEventListener("copy", handleCopy)
    }
    if (disabled) return removeListener

    document.addEventListener("copy", handleCopy)
    return removeListener
  }, [disabled, handleCopy])

  return
}
