"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const http = require("http");
const https = require("https");
const url_1 = require("url");
const debugEventDebouncer_1 = require("./debugEventDebouncer");
const debugReminder_1 = require("./debugReminder");
function activate(context) {
    console.log('Debug Webhook Notifier is now active!');
    // Initialize Helpers
    const debouncer = new debugEventDebouncer_1.DebugEventDebouncer(sendNotification);
    const reminder = new debugReminder_1.DebugReminder(sendNotification);
    // Command: Configure Webhook URL
    context.subscriptions.push(vscode.commands.registerCommand('debugWebhook.configure', async () => {
        const config = vscode.workspace.getConfiguration('debugWebhook');
        const currentUrl = config.get('url') || 'http://127.0.0.1:62222/hook';
        const newUrl = await vscode.window.showInputBox({
            prompt: 'Enter the Webhook URL (e.g. http://192.168.1.10:62222/hook)',
            value: currentUrl,
            ignoreFocusOut: true
        });
        if (newUrl) {
            // Update configuration globally (User Settings)
            await config.update('url', newUrl, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Debug Webhook URL set to: ${newUrl}`);
        }
    }));
    // 1. Listen for Window Focus Change
    context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
        reminder.onWindowStateChanged(state.focused);
    }));
    // 2. Listen for Debug Session Termination
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
        // Clear debouncer and reminder state
        debouncer.clearSession(session.name);
        reminder.updateState(session.id, false); // No longer paused (it's dead)
        sendNotification('Debug Ended', `Debug session "${session.name}" has ended.`);
    }));
    // 3. Listen for Debug Events (Pause & Continue)
    context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session) {
            return {
                onDidSendMessage: (message) => {
                    // Handle 'stopped' event (PAUSE)
                    if (message.type === 'event' && message.event === 'stopped') {
                        const body = message.body || {};
                        const reason = body.reason || 'unknown';
                        const config = vscode.workspace.getConfiguration('debugWebhook');
                        const ignoreStep = config.get('ignoreStepEvents', true);
                        if (ignoreStep && reason === 'step') {
                            return;
                        }
                        const description = body.description || body.text || '';
                        const threadId = body.threadId;
                        // Notify Debouncer
                        debouncer.addEvent(session.name, reason, description, threadId);
                        // Notify Reminder (Mark as Paused)
                        reminder.updateState(session.id, true, session.name);
                    }
                    // Handle 'continued' event (RESUME)
                    if (message.type === 'event' && message.event === 'continued') {
                        reminder.updateState(session.id, false);
                    }
                },
                // Also listen for requests that imply resuming (continue, next, stepIn, stepOut)
                // This is a fallback in case 'continued' event is missing or delayed
                onWillReceiveMessage: (message) => {
                    if (message.type === 'request') {
                        const cmd = message.command;
                        if (['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue'].includes(cmd)) {
                            reminder.updateState(session.id, false);
                        }
                    }
                }
            };
        }
    }));
}
exports.activate = activate;
function sendNotification(title, message) {
    const config = vscode.workspace.getConfiguration('debugWebhook');
    const webhookUrl = config.get('url');
    if (!webhookUrl) {
        console.warn('Debug Webhook URL is not configured.');
        return;
    }
    try {
        const parsedUrl = new url_1.URL(webhookUrl);
        const payload = JSON.stringify({
            title: title,
            message: message
        });
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
        const req = requestModule.request(options, (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                console.error(`Webhook failed with status code: ${res.statusCode}`);
            }
        });
        req.on('error', (e) => {
            console.error(`Webhook request error: ${e.message}`);
            vscode.window.showErrorMessage(`Debug Webhook Error: ${e.message}`);
        });
        req.write(payload);
        req.end();
    }
    catch (e) {
        console.error(`Failed to send webhook: ${e.message}`);
        vscode.window.showErrorMessage(`Failed to send debug webhook: ${e.message}`);
    }
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map