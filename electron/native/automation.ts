/**
 * Native desktop automation for cross-app task dispatch.
 *
 * On Windows, simulates Ctrl+V via Win32 `keybd_event` so that the task title
 * (already written to the clipboard in the renderer's dragstart) is pasted
 * into the target application that received the drop.
 *
 * On macOS / Linux this is a no-op for now — the user can still Ctrl/Cmd+V
 * manually since the clipboard already contains the title.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface PasteResult {
  ok: boolean;
  reason?: 'unsupported-platform' | 'ffi-error';
  message?: string;
}

/**
 * Simulate Ctrl+V (Windows) / Cmd+V (Mac) keystroke to paste clipboard content
 * into whatever window currently has focus. Must be called AFTER the target
 * application has received foreground focus (i.e. after the drag-end drop).
 */
export function simulatePaste(): PasteResult {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'unsupported-platform' };
  }

  try {
    // Load koffi lazily so the main process doesn't pay the cost at boot.
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');

    // keybd_event is the simplest API for simulating a single key combo.
    // SendInput is the modern recommendation, but keybd_event is sufficient
    // for a 4-event Ctrl+V sequence and avoids INPUT struct marshalling.
    const keybd_event = user32.func(
      'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
    );

    const VK_CONTROL = 0x11;
    const VK_V = 0x56;
    const KEYEVENTF_KEYUP = 0x0002;

    // Ctrl down → V down → V up → Ctrl up
    keybd_event(VK_CONTROL, 0, 0, 0);
    keybd_event(VK_V, 0, 0, 0);
    keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);

    return { ok: true };
  } catch (err) {
    console.error('[automation] simulatePaste failed:', err);
    return { ok: false, reason: 'ffi-error', message: (err as Error).message };
  }
}
