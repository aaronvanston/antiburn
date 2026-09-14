import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { SurfaceOrigin } from "./ipc"

const OVERLAY_WINDOW_LABEL = "antiburn-overlay"
const HUD_SETTINGS_EVENT = "hud:settings"
const OVERLAY_WORK_EVENT = "overlay_work_changed"

export function openOverlayWindow(origin: SurfaceOrigin): Promise<void> {
  return invoke("open_overlay_window", { origin })
}

/** Take the reason for the latest successful hidden-to-visible HUD transition. */
export function takeHudAnalyticsOrigin(): Promise<SurfaceOrigin | null> {
  return invoke<SurfaceOrigin | null>("take_hud_analytics_origin")
}

export async function hideOverlayWindow(): Promise<void> {
  await invoke("hide_overlay_window")
}

/** Subscribe to native HUD work transitions. */
export async function onOverlayWorkChanged(
  handler: (active: boolean) => void,
): Promise<() => void> {
  return listen<boolean>(OVERLAY_WORK_EVENT, (event) => handler(Boolean(event.payload)))
}

/**
 * Remember where the HUD sits, after a drag moved it.
 *
 * The shell reads the window position itself, so this carries no coordinates.
 */
export function recordHudPosition(): Promise<void> {
  return invoke("record_hud_position")
}

/** Hold native dismissal and placement while the pointer moves the HUD. */
export function setHudDragging(active: boolean): Promise<void> {
  return invoke("set_hud_dragging", { active })
}

const HUD_PREF_KEY = "antiburn.showFloatingHud"

export function isFloatingHudEnabled(): boolean {
  try {
    return localStorage.getItem(HUD_PREF_KEY) === "1"
  } catch {
    return false
  }
}

export function setFloatingHudEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HUD_PREF_KEY, enabled ? "1" : "0")
  } catch {
    // The HUD still works when preference storage is unavailable.
  }
}

export async function isCurrentWindowVisible(): Promise<boolean> {
  try {
    return await getCurrentWindow().isVisible()
  } catch {
    return false
  }
}

export async function isOverlayWindowVisible(): Promise<boolean> {
  try {
    const overlay = await WebviewWindow.getByLabel(OVERLAY_WINDOW_LABEL)
    return (await overlay?.isVisible()) ?? false
  } catch {
    return false
  }
}

export type HudEdge = "top" | "left" | "right" | "bottom"
export type HudPreferences = { enabled: boolean; dynamic: boolean; edge: HudEdge }
export type HudMotion = { dynamic: boolean; edge: HudEdge; concealing: boolean }

export function getHudPreferences(): Promise<HudPreferences> {
  return invoke("get_hud_preferences", { legacyEnabled: isFloatingHudEnabled() })
}

/** Keep enabled state separate from temporary native visibility. */
export class HudVisibilitySession {
  private listeners = new Set<() => void>()
  private generation = 0
  private revision = 0
  private preferences: HudPreferences = {
    enabled: isFloatingHudEnabled(),
    dynamic: false,
    edge: "top",
  }
  private dispose: (() => void) | null = null
  private error: string | null = null

  getSnapshot = (): boolean => this.preferences.enabled
  getPreferencesSnapshot = (): HudPreferences => this.preferences
  getError = (): string | null => this.error

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.generation += 1
        this.dispose?.()
        this.dispose = null
        window.removeEventListener("focus", this.read)
      }
    }
  }

  set = (enabled: boolean): void => this.change({ enabled })
  toggle = (): void => this.set(!this.preferences.enabled)
  reveal = (): void => {
    void openOverlayWindow("user").catch(() => this.fail())
  }

  change = (change: Partial<HudPreferences>): void => {
    const revision = ++this.revision
    void invoke<HudPreferences>("set_hud_preferences", { change })
      .then((saved) => {
        if (revision === this.revision) this.apply(saved)
      })
      .catch(() => this.fail())
  }

  private fail(): void {
    this.error = "The HUD change could not be applied. Try again."
    for (const listener of this.listeners) listener()
  }

  private apply(preferences: HudPreferences): void {
    this.error = null
    if (!preferences) return
    this.preferences = preferences
    setFloatingHudEnabled(preferences.enabled)
    for (const listener of this.listeners) listener()
  }

  private read = (): void => {
    const generation = this.generation
    const revision = ++this.revision
    void getHudPreferences()
      .then((saved) => {
        if (generation === this.generation && revision === this.revision) this.apply(saved)
      })
      .catch(() => this.fail())
  }

  private start(): void {
    const generation = ++this.generation
    void listen<HudPreferences>(HUD_SETTINGS_EVENT, (event) => {
      if (generation !== this.generation) return
      this.revision += 1
      this.apply(event.payload)
    })
      .then((dispose) => {
        if (generation !== this.generation) {
          dispose()
          return
        }
        this.dispose = dispose
        this.read()
      })
      .catch(() => this.fail())
    window.addEventListener("focus", this.read)
  }
}
