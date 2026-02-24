"""
MMCV Custom Hook for DayFlow Webhook Integration

This hook sends training status updates to DayFlow's webhook endpoint,
enabling real-time monitoring of your MMCV-based training jobs.

NOTE: This file is a standalone Python script meant to be copied to your
MMCV/MMEngine training project. The imports below require:
  - torch
  - mmengine (pip install mmengine)
  
These dependencies are NOT required for DayFlow itself - they are only
needed in your training environment.

Usage:
    1. Copy this file to your project (e.g., hooks/dayflow_hook.py)
    2. Add to your training config:
    
    custom_hooks = [
        dict(
            type='DayFlowWebhookHook',
            url='http://localhost:62222/hook',
            gpu_name='RTX 4090',  # Your GPU name
            model_name='MyModel',  # Model name to display
            interval=60,  # Update interval in seconds
        )
    ]
"""

import time
import requests
import torch
from mmengine.hooks import Hook
from mmengine.registry import HOOKS


@HOOKS.register_module()
class DayFlowWebhookHook(Hook):
    """
    MMCV Hook that sends training status to DayFlow webhook.
    
    Args:
        url (str): DayFlow webhook URL (default: http://localhost:62222/hook)
        gpu_name (str): Name of the GPU to display in DayFlow
        model_name (str): Name of the model being trained
        interval (int): Send update every N iterations (default: 50)
        priority (int): Hook priority (default: 'VERY_LOW')
    """
    
    priority = 'VERY_LOW'  # Run after other hooks to get latest metrics
    
    def __init__(
        self,
        url='http://localhost:62222/hook',
        gpu_name=None,
        model_name=None,
        interval=50,
    ):
        self.url = url
        self.gpu_name = gpu_name or self._auto_detect_gpu_name()
        self.model_name = model_name
        self.interval = interval
        self.last_iter = 0
        self.start_time = None
        
    def _auto_detect_gpu_name(self):
        """Auto-detect GPU name from torch.cuda."""
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
        return 'Unknown GPU'
    
    def _format_eta(self, seconds):
        """Format seconds to human-readable ETA string."""
        if seconds is None or seconds <= 0:
            return None
            
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        
        if hours > 0:
            return f"{hours}h {minutes}m"
        else:
            return f"{minutes}m"
    
    def _send_webhook(self, runner, metrics=None):
        """Send training status to DayFlow webhook."""
        try:
            # Get current iteration and max iterations
            cur_iter = runner.iter
            max_iter = runner.max_iters
            
            # Calculate ETA
            eta_seconds = None
            if self.start_time and cur_iter > 0:
                elapsed = time.time() - self.start_time
                iter_time = elapsed / cur_iter
                remaining_iters = max_iter - cur_iter
                eta_seconds = remaining_iters * iter_time
            
            # Build metrics payload
            payload = {
                'gpu_name': self.gpu_name,
                'model_name': self.model_name,
                'eta': self._format_eta(eta_seconds),
            }
            
            # Add task title - use experiment_name, model_name, or gpu_name as fallback
            if hasattr(runner, 'experiment_name') and runner.experiment_name:
                payload['title'] = runner.experiment_name
            elif self.model_name:
                payload['title'] = self.model_name
            elif self.gpu_name:
                payload['title'] = f'Training on {self.gpu_name}'
            
            # Add metrics from runner
            if metrics:
                payload['metrics'] = metrics
            
            # Send to webhook
            response = requests.post(
                self.url,
                json=payload,
                timeout=5
            )
            
            if response.status_code == 200:
                runner.logger.info(f'[DayFlow] Sent training update: iter {cur_iter}/{max_iter}')
            else:
                runner.logger.warning(f'[DayFlow] Webhook failed: {response.status_code}')
                
        except requests.exceptions.RequestException as e:
            runner.logger.warning(f'[DayFlow] Webhook error: {e}')
        except Exception as e:
            runner.logger.warning(f'[DayFlow] Unexpected error: {e}')
    
    def before_train(self, runner):
        """Called before training starts."""
        self.start_time = time.time()
        runner.logger.info(f'[DayFlow] Hook initialized for GPU: {self.gpu_name}')
        
        # Send initial status
        self._send_webhook(runner, metrics={'status': 'starting'})
    
    def after_train_iter(self, runner, batch_idx, data_batch=None, outputs=None):
        """Called after each training iteration."""
        # Send update at configured interval
        if runner.iter - self.last_iter >= self.interval:
            self.last_iter = runner.iter
            
            # Extract loss from outputs if available
            metrics = {}
            if outputs and isinstance(outputs, dict):
                if 'loss' in outputs:
                    metrics['loss'] = float(outputs['loss'])
                if 'loss_cls' in outputs:
                    metrics['loss_cls'] = float(outputs['loss_cls'])
                if 'loss_bbox' in outputs:
                    metrics['loss_bbox'] = float(outputs['loss_bbox'])
            
            # Add current epoch/iteration info
            if hasattr(runner, 'epoch'):
                metrics['epoch'] = runner.epoch
            metrics['iter'] = runner.iter
            
            self._send_webhook(runner, metrics if metrics else None)
    
    def after_train_epoch(self, runner):
        """Called after each epoch."""
        # Send epoch completion update
        metrics = {
            'epoch': runner.epoch,
            'status': 'epoch_completed'
        }
        self._send_webhook(runner, metrics)
    
    def after_train(self, runner):
        """Called after training completes."""
        metrics = {
            'status': 'completed',
            'total_iters': runner.max_iters
        }
        self._send_webhook(runner, metrics)
        runner.logger.info('[DayFlow] Training completed notification sent')


# ============================================================================
# Alternative: Simpler Version for Quick Integration
# ============================================================================

class SimpleDayFlowHook(Hook):
    """
    Simplified version - just sends periodic updates with minimal configuration.
    
    Usage in config:
        custom_hooks = [
            dict(type='SimpleDayFlowHook', gpu_name='RTX 4090')
        ]
    """
    
    priority = 'VERY_LOW'
    
    def __init__(self, gpu_name='GPU', interval=100):
        self.url = 'http://localhost:62222/hook'
        self.gpu_name = gpu_name
        self.interval = interval
        self.start_time = None
    
    def before_train(self, runner):
        self.start_time = time.time()
    
    def after_train_iter(self, runner, batch_idx, data_batch=None, outputs=None):
        if runner.iter % self.interval == 0 and self.start_time is not None:
            try:
                elapsed = time.time() - self.start_time
                avg_iter_time = elapsed / max(runner.iter, 1)
                remaining_iters = runner.max_iters - runner.iter
                eta = remaining_iters * avg_iter_time
                
                requests.post(self.url, json={
                    'gpu_name': self.gpu_name,
                    'eta': f"{int(eta // 3600)}h {int((eta % 3600) // 60)}m",
                    'metrics': {'iter': runner.iter, 'max_iter': runner.max_iters}
                }, timeout=2)
            except:
                pass


# ============================================================================
# MMDetection/MMSegmentation Specific Example
# ============================================================================

@HOOKS.register_module()
class DayFlowDetHook(DayFlowWebhookHook):
    """
    Specialized hook for MMDetection/MMSegmentation with mAP logging.
    
    Usage:
        custom_hooks = [
            dict(
                type='DayFlowDetHook',
                gpu_name='RTX 4090',
                model_name='Mask R-CNN',
                interval=100,
            )
        ]
    """
    
    def after_val_epoch(self, runner, metrics):
        """Called after validation epoch - includes mAP."""
        if metrics:
            # Extract mAP from metrics
            metric_dict = {}
            if 'coco/bbox_mAP' in metrics:
                metric_dict['mAP'] = float(metrics['coco/bbox_mAP'])
            if 'coco/segm_mAP' in metrics:
                metric_dict['segm_mAP'] = float(metrics['coco/segm_mAP'])
            
            if metric_dict:
                metric_dict['epoch'] = runner.epoch
                self._send_webhook(runner, metric_dict)


# ============================================================================
# Config Examples
# ============================================================================

"""
Example 1: Basic Usage
----------------------
custom_hooks = [
    dict(
        type='DayFlowWebhookHook',
        gpu_name='RTX 4090',
        model_name='ResNet-50',
        interval=50,
    )
]

Example 2: With Auto-Detection
------------------------------
custom_hooks = [
    dict(
        type='DayFlowWebhookHook',
        # gpu_name will auto-detect from torch.cuda.get_device_name()
        model_name='MyModel',
        interval=100,
    )
]

Example 3: Multiple GPUs (Distributed Training)
-----------------------------------------------
# In each GPU's config, set different gpu_name:
custom_hooks = [
    dict(
        type='DayFlowWebhookHook',
        gpu_name=f'GPU {torch.cuda.current_device()}',
        model_name='Distributed Training',
        interval=50,
    )
]

Example 4: MMDetection with mAP
-------------------------------
custom_hooks = [
    dict(
        type='DayFlowDetHook',
        gpu_name='RTX 4090',
        model_name='YOLOX-X',
        interval=100,
    )
]
"""
