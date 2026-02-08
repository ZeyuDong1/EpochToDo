
export interface DebugEvent {
    sessionName: string;
    reason: string;
    description: string;
    threadId?: number;
}

export type NotificationCallback = (title: string, message: string) => void;

export class DebugEventDebouncer {
    private timer: NodeJS.Timeout | null = null;
    private pendingEvents: DebugEvent[] = [];
    private readonly DELAY_MS = 150; 
    private sendNotification: NotificationCallback;

    constructor(sendNotification: NotificationCallback) {
        this.sendNotification = sendNotification;
    }

    public addEvent(sessionName: string, reason: string, description: string, threadId?: number) {
        this.pendingEvents.push({ sessionName, reason, description, threadId });

        if (this.timer) {
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(() => {
            this.flush();
        }, this.DELAY_MS);
    }

    public clearSession(sessionName: string) {
        // Remove events for this session
        this.pendingEvents = this.pendingEvents.filter(e => e.sessionName !== sessionName);
        
        // If no events left, clear timer
        if (this.pendingEvents.length === 0 && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private flush() {
        if (this.pendingEvents.length === 0) return;

        const sessionGroups = new Map<string, DebugEvent[]>();
        
        this.pendingEvents.forEach(evt => {
            if (!sessionGroups.has(evt.sessionName)) {
                sessionGroups.set(evt.sessionName, []);
            }
            sessionGroups.get(evt.sessionName)!.push(evt);
        });

        sessionGroups.forEach((events, sessionName) => {
            // Priority: exception > breakpoint > step > pause > others
            const priority = ['exception', 'breakpoint', 'step', 'pause'];
            
            events.sort((a, b) => {
                const idxA = priority.indexOf(a.reason);
                const idxB = priority.indexOf(b.reason);
                const pA = idxA === -1 ? 999 : idxA;
                const pB = idxB === -1 ? 999 : idxB;
                return pA - pB;
            });

            const primaryEvent = events[0];
            // Count unique threads
            const uniqueThreads = new Set(events.filter(e => e.threadId !== undefined).map(e => e.threadId));
            const threadCount = uniqueThreads.size;
            
            let message = `Debug session "${sessionName}" paused. Reason: ${primaryEvent.reason}`;
            if (primaryEvent.description) {
                message += ` (${primaryEvent.description})`;
            }
            
            if (threadCount > 1) {
                message += ` [Paused on ${threadCount} threads]`;
            }

            this.sendNotification('Debug Paused', message);
        });

        this.pendingEvents = [];
        this.timer = null;
    }
}
