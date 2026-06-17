import { KeyboardEvent, useCallback } from 'react';
import { TaskNode } from '../../shared/types';

export interface OutlinerActions {
  createChild: (parentId: number, title: string) => Promise<void>;
  createSibling: (siblingId: number, title: string) => Promise<void>;
  updateTitle: (id: number, title: string) => Promise<void>;
  indent: (id: number) => Promise<void>;
  dedent: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  completeTask: (id: number) => Promise<void>;
  startFocus: (id: number) => Promise<void>;
  moveCursor: (direction: 'up' | 'down') => void;
  exitEditor: () => void;
}

export interface UseOutlinerKeyboardOptions {
  tree: TaskNode[];
  activeNodeId: number | null;
  editingNodeId: number | null;
  actions: OutlinerActions;
}

/**
 * bullet 编辑器键盘处理器。
 * 返回一个绑定到行 input 的 onKeyDown 函数。
 *
 * 键盘模型（规格 Option A）：
 * - Enter = 新建子任务（缩进+1）
 * - Shift+Enter = 新建同级任务
 * - Backspace（行首空标题）= 取消缩进，已在顶层则删除
 * - Tab = 手动缩进
 * - Shift+Tab = 取消缩进
 * - Ctrl+Enter = 完成任务
 * - Ctrl+Backspace = 删除任务
 * - Esc = 退出编辑器
 * - ArrowUp/ArrowDown = 移动光标（仅在非编辑状态下）
 */
export function useOutlinerKeyboard({
  tree, activeNodeId, editingNodeId, actions
}: UseOutlinerKeyboardOptions) {
  return useCallback((e: KeyboardEvent<HTMLInputElement>, taskId: number, currentTitle: string) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter') {
        e.preventDefault();
        actions.completeTask(taskId);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        actions.deleteTask(taskId);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      actions.exitEditor();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        actions.createSibling(taskId, currentTitle);
      } else {
        actions.createChild(taskId, currentTitle);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) actions.dedent(taskId);
      else actions.indent(taskId);
      return;
    }

    if (e.key === 'Backspace' && currentTitle === '') {
      e.preventDefault();
      actions.dedent(taskId);
      return;
    }

    if (!editingNodeId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      actions.moveCursor(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
  }, [tree, activeNodeId, editingNodeId, actions]);
}
