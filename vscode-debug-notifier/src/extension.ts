import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { DebugEventDebouncer } from './debugEventDebouncer';
import { DebugReminder } from './debugReminder';

export function activate(context: vscode.ExtensionContext) {
    console.log('Debug Webhook Notifier is now active!');

    // Initialize Helpers
    const debouncer = new DebugEventDebouncer(sendNotification);
    const reminder = new DebugReminder(sendNotification);

    // Command: Configure Webhook URL
    context.subscriptions.push(
        vscode.commands.registerCommand('debugWebhook.configure', async () => {
            const config = vscode.workspace.getConfiguration('debugWebhook');
            const currentUrl = config.get<string>('url') || 'http://127.0.0.1:62222/hook';

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
        })
    );

    // 1. Listen for Window Focus Change
    context.subscriptions.push(
        vscode.window.onDidChangeWindowState((state) => {
            reminder.onWindowStateChanged(state.focused);
        })
    );

    // 2. Listen for Debug Session Termination
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
            // Clear debouncer and reminder state
            debouncer.clearSession(session.name);
            reminder.updateState(session.id, false); // No longer paused (it's dead)
            
            sendNotification('Debug Ended', `Debug session "${session.name}" has ended.`);
        })
    );

    // 4. Listen for Terminal Command Completion (Requires VS Code 1.93+)
    // Note: Depends on Shell Integration being enabled.
    if (vscode.window.onDidEndTerminalShellExecution) {
        context.subscriptions.push(
            vscode.window.onDidEndTerminalShellExecution((event: vscode.TerminalShellExecutionEndEvent) => {
                const config = vscode.workspace.getConfiguration('debugWebhook');
                const notifyTerminal = config.get<boolean>('notifyTerminalCommands', true);

                if (!notifyTerminal) {
                    return;
                }

                const execution = event.execution;
                const commandLine = execution.commandLine?.value || 'Unknown Command';
                const exitCode = event.exitCode;

                // Simple check: ignore empty commands or very short ones?
                if (!commandLine || commandLine.trim().length === 0) {
                    return;
                }

                const status = exitCode === 0 ? 'Success' : `Failed (Exit Code: ${exitCode})`;
                const title = `Terminal Command Finished: ${status}`;
                const message = `Command: ${commandLine}\nExit Code: ${exitCode}`;

                sendNotification(title, message);
            })
        );
    } else {
        console.warn('onDidEndTerminalShellExecution API not available. Update VS Code to 1.93+.');
    }
}

function sendNotification(title: string, message: string) {
    const config = vscode.workspace.getConfiguration('debugWebhook');
    const webhookUrl = config.get<string>('url');

    if (!webhookUrl) {
        console.warn('Debug Webhook URL is not configured.');
        return;
    }

    try {
        const parsedUrl = new URL(webhookUrl);
        const payload = JSON.stringify({
            title: title,
            message: message
        });

        const options: http.RequestOptions = {
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

    } catch (e: any) {
        console.error(`Failed to send webhook: ${e.message}`);
        vscode.window.showErrorMessage(`Failed to send debug webhook: ${e.message}`);
    }
}

export function deactivate() {}
