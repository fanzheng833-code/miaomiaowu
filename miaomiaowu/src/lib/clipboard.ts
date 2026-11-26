export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Continue to the selection-based fallback when the browser rejects the write.
  }

  if (typeof document === 'undefined' || !document.body) return false

  const activeElement = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px'

  // A modal focus trap must allow the temporary field to receive focus.
  const container =
    activeElement?.closest('[role="dialog"], [role="alertdialog"]') ??
    document.body
  container.append(field)

  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, field.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    if (activeElement instanceof HTMLElement && activeElement.isConnected) {
      activeElement.focus({ preventScroll: true })
    }
  }
}
