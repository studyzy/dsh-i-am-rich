import type { WasteId } from './types.ts'

/**
 * Brand an implementation-minted discard identity.
 * @param id - opaque discard identity.
 * @returns the same string, branded; no validation is performed.
 */
export function WasteId(id: string): WasteId {
  return id as WasteId
}