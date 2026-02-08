import * as vscode from 'vscode';

export type NotificationCallback = (title: string, message: string) => void;

export class DebugReminder {
    private pausedSessions: Map<string, string> = new Map(); // ID -> Name
    private reminderTimer: NodeJS.Timeout | null = null;
    private readonly REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    private sendNotification: NotificationCallback;

    constructor(sendNotification: NotificationCallback) {
        this.sendNotification = sendNotification;
    }

    public updateState(sessionId: string, isPaused: boolean, sessionName?: string) {
        if (isPaused) {
            this.pausedSessions.set(sessionId, sessionName || 'Unknown Session');
        } else {
            this.pausedSessions.delete(sessionId);
        }
        this.checkAndScheduleReminder();
    }

    public onWindowStateChanged(focused: boolean) {
        this.checkAndScheduleReminder();
    }

    private checkAndScheduleReminder() {
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
        } else {
            if (this.reminderTimer) {
                console.log('Stopping debug reminder timer...');
                // Stop timer
                clearInterval(this.reminderTimer);
                this.reminderTimer = null;
            }
        }
    }

    private sendReminders() {
        // Double check condition before sending
        if (vscode.window.state.focused || this.pausedSessions.size === 0) {
            this.checkAndScheduleReminder();
            return;
        }

        const count = this.pausedSessions.size;
        const sessionNames = Array.from(this.pausedSessions.values()).join(', ');

        this.sendNotification(
            'Debug Still Paused', 
            `You have ${count} debug session(s) paused in background: ${sessionNames}. Please check VS Code.`
        );
    }
}
