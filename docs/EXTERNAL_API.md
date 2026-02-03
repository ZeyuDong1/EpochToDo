# EpochToDo 外部通知接口集成指南

本功能允许外部程序（如训练脚本、CI/CD 流水线、定时任务）通过 HTTP 请求直接唤起 EpochToDo 的全屏/弹窗提醒。这对于长时间运行的任务（如深度学习模型训练）非常有用，能够在任务结束时第一时间通知您。

## 🔌 接口规范 (API Specification)

- **Base URL**: `http://<YOUR_IP>:62222` (本地测试使用 `127.0.0.1`)
- **Endpoint**: `/hook`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 请求参数 (Payload)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `title` | `string` | **是** | 提醒弹窗的主标题 (例如: "Training Finished") |
| `message` | `string` | 否 | 详细信息或备注 (目前主要用于存储，未来可展示更多细节) |

---

## 💻 集成示例 (Code Examples)

### 1. Shell / Terminal (测试用)

最简单的测试方法，用于验证服务是否运行。

```bash
curl -X POST http://127.0.0.1:62222/hook \
  -H "Content-Type: application/json" \
  -d '{"title": "Task Completed", "message": "Your script has finished execution."}'
```

### 2. Python (通用)

适用于任何 Python 脚本，例如数据处理或简单的自动化任务。

```python
import requests

def notify_epoch_todo(title, message=""):
    """
    发送通知到 EpochToDo。
    如果不成功（例如 App 未启动），会静默失败以免影响主程序。
    """
    try:
        url = "http://127.0.0.1:62222/hook"
        payload = {"title": title, "message": message}
        requests.post(url, json=payload, timeout=1)
    except Exception:
        # 忽略连接错误
        pass

# 使用示例
if __name__ == "__main__":
    # ... 您的耗时任务 ...
    notify_epoch_todo("Data Preprocessing Done", "Processed 50k images.")
```

### 3. MMCV / PyTorch Lightning Hook (深度学习)

如果您在使用 OpenMMLab (MMCV) 系列框架，可以将其注册为一个 Hook。

```python
from mmcv.runner import HOOKS, Hook
import requests

@HOOKS.register_module()
class EpochToDoNotificationHook(Hook):
    def __init__(self, endpoint="http://127.0.0.1:62222/hook"):
        self.endpoint = endpoint

    def _send(self, title, msg=""):
        try:
            requests.post(
                self.endpoint, 
                json={"title": title, "message": msg}, 
                timeout=0.5
            )
        except:
            pass

    def after_run(self, runner):
        """训练结束时触发"""
        exp_name = runner.meta.get('exp_name', 'Model Training')
        self._send(
            title=f"Training Completed: {exp_name}",
            msg=f"Epochs: {runner.epoch}"
        )

# 在配置文件中使用:
# custom_hooks = [
#     dict(type='EpochToDoNotificationHook')
# ]
```

### 4. Node.js / JavaScript

```javascript
const sendNotification = async (title, message = "") => {
  try {
    await fetch("http://127.0.0.1:62222/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message }),
    });
  } catch (err) {
    // 忽略错误
  }
};

// 使用示例
sendNotification("Build Successful", "Deployment completed.");
```

---

## ⚠️ 注意事项

1.  **网络访问**: 该接口监听 `0.0.0.0`，这意味着它接受来自同一局域网或虚拟专网（如 Tailscale）的所有请求。
2.  **安全性**: 建议仅在受信网络（如 Tailscale 或家庭局域网）中使用。如果您的设备暴露在公网，请务必使用防火墙关闭 62222 端口。
3.  **应用状态**: 必须保持 EpochToDo 应用处于运行状态（可以是最小化到托盘），接口才能工作。
4.  **异常处理**: 建议在客户端代码中捕获请求异常（如示例所示），以免因为 EpochToDo 未启动而导致您的主要任务抛出错误或崩溃。
