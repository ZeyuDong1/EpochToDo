"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugReminder = void 0;
const vscode = require("vscode");
class DebugReminder {
    constructor(sendNotification) {
        this.pausedSessions = new Map(); // ID -> Name
        this.reminderTimer = null;
        this.REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
        this.sendNotification = sendNotification;
    }
    updateState(sessionId, isPaused, sessionName) {
        if (isPaused) {
            this.pausedSessions.set(sessionId, sessionName || 'Unknown Session');
        }
        else {
            this.pausedSessions.delete(sessionId);
        }
        this.checkAndScheduleReminder();
    }
    onWindowStateChanged(focused) {
        this.checkAndScheduleReminder();
    }
    checkAndScheduleReminder() {
        const isWindowFocused = vscode.window.state.focused;
        const hasPausedSessions = this.pausedSessions.size > 0;
        // Condition: Paused AND Window NOT Focused
        const shouldRemind = hasPausedSessions && !isWindowFocused;
        if (shouldRemind) {
            if (!this.reminderTimer) {
                console.log('Starting debug reminder timer...');
                // Start timer
                this.reminderTimer = setInterval(() => {
                    this.sendReminders();
                }, this.REMINDER_INTERVAL_MS);
            }
        }
        else {
            if (this.reminderTimer) {
                console.log('Stopping debug reminder timer...');
                // Stop timer
                clearInterval(this.reminderTimer);
                this.reminderTimer = null;
            }
        }
    }
    sendReminders() {
        // Double check condition before sending
        if (vscode.window.state.focused || this.pausedSessions.size === 0) {
            this.checkAndScheduleReminder();
            return;
        }
        const count = this.pausedSessions.size;
        const sessionNames = Array.from(this.pausedSessions.values()).join(', ');
        this.sendNotification('Debug Still Paused', `You have ${count} debug session(s) paused in background: ${sessionNames}. Please check VS Code.`);
    }
}
exports.DebugReminder = DebugReminder;
//# sourceMappingURL=debugReminder.js.map