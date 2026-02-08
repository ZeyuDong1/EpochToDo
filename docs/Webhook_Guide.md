# EpochToDo Webhook Integration Guide

EpochToDo provides a local webhook server for seamless integrations with external tools. You can use this to trigger system notifications or update training task statuses directly from your scripts, CI/CD pipelines, or other applications.

## Server Information

- **URL**: `http://127.0.0.1:62222/hook`
- **Method**: `POST`
- **Content-Type**: `application/json`

---

## 1. General Notifications (Pop-up Alerts)

Use this format to display a system notification. This is useful for alerting you when a long-running process (like a build or download) completes.

### JSON Payload
```json
{
  "title": "Notification Title",
  "message": "Notification body content."
}
```

### Curl Example
```bash
curl -X POST http://127.0.0.1:62222/hook \
     -H "Content-Type: application/json" \
     -d '{"title": "Build Success", "message": "Project compilation finished in 45s."}'
```

---

## 2. Training Status Updates (GPU Tasks)

If you are running deep learning tasks tracked in EpochToDo, you can update their status (ETA, Loss, Accuracy) in real-time.

### JSON Payload
```json
{
  "task_id": 123,
  "eta": "1h 30m",
  "metrics": {
    "loss": 0.045,
    "accuracy": 0.982
  }
}
```

*   **task_id**: The ID of the task in EpochToDo (you can find this in the task list or database).
*   **eta**: Estimated time remaining (string).
*   **metrics**: An object containing key-value pairs of metrics to display.

### Curl Example
```bash
curl -X POST http://127.0.0.1:62222/hook \
     -H "Content-Type: application/json" \
     -d '{"task_id": 101, "eta": "45m", "metrics": {"loss": 0.12}}'
```

---

## 3. Helper Script

The repository includes a helper script `scripts/notify_agent.sh` for easier usage in bash environments.

### Usage
```bash
# Syntax: ./scripts/notify_agent.sh "Title" "Message"

# Example
./scripts/notify_agent.sh "Deployment Done" "Successfully deployed to production."
```
