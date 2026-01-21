export interface Command {
  type: 'FOCUS' | 'CREATE' | 'SUSPEND' | 'EMPTY' | 'MEMO' | 'AD_HOC' | 'TRAINING' | 'COMPLETE';
  main?: string;
  sub?: string;
  project?: string;
  time?: number; // in SECONDS
  memo?: string;
  isTraining?: boolean;
  gpu?: string;
  parentSearch?: string; // For subtask creation: search term for parent task
  isSubtask?: boolean; // True if this is a subtask command (contains :)
}

export const useCommandParser = () => {
  const parse = (text: string): Command => {
    let txt = text.trim();
    if (!txt) return { type: 'EMPTY' };

    // 1. Memo Syntax: > [content]
    if (txt.startsWith('>')) {
       return { type: 'MEMO', memo: txt.substring(1).trim() };
    }

    // 2. Extract Type
    let type: Command['type'] = 'CREATE';
    if (txt.startsWith('+')) {
       type = 'AD_HOC';
       txt = txt.substring(1).trim();
    } else if (txt.startsWith('%')) {
       type = 'TRAINING';
       txt = txt.substring(1).trim();
    } else if (txt.startsWith('#')) {
       type = 'COMPLETE';
       txt = txt.substring(1).trim();
    } else if (txt.startsWith('!')) {
       type = 'FOCUS';
       txt = txt.substring(1).trim();
    } else if (txt.startsWith('@')) {
       type = 'SUSPEND';
       // Don't consume here, let Time extractor handle it? 
       // Wait, existing logic for SUSPEND was: "@ 25m".
       // If txt starts with @, it might be extracted as time later.
       // But type logic sets default to CREATE.
       // If no main text remains, IS it suspend?
       // Let's refine:
       // If "@ 20m", Main is empty.
       // Logic below extracts time.
       // Handle SUSPEND type inference if Time exists and Main is empty?
    }

    // 3. Check for subtask syntax: [task]: or [task]:[parentSearch]
    // Only for FOCUS and CREATE types
    let parentSearch: string | undefined;
    let isSubtask = false;
    
    if (type === 'FOCUS' || type === 'CREATE') {
        const colonIdx = txt.indexOf(':');
        if (colonIdx !== -1) {
            isSubtask = true;
            parentSearch = txt.substring(colonIdx + 1).trim() || undefined;
            txt = txt.substring(0, colonIdx).trim();
        }
    }

    // 4. Extract Time (@...) - supports s (seconds), m (minutes), h (hours)
    // Default unit is minutes for backwards compatibility
    let time: number | undefined;
    const timeMatch = txt.match(/@\s*(\d+)([smh]?)/i);
    if (timeMatch) {
        const value = parseInt(timeMatch[1]);
        const unit = (timeMatch[2] || 'm').toLowerCase();
        // Convert to seconds
        if (unit === 'h') {
            time = value * 3600; // hours to seconds
        } else if (unit === 's') {
            time = value; // already seconds
        } else {
            time = value * 60; // minutes to seconds (default)
        }
        txt = txt.replace(timeMatch[0], '').trim();
    }

    // 5. Extract Project ($...)
    // Supports $Project or $ Project
    let project: string | undefined;
    const projectMatch = txt.match(/\$\s*([^\s!@%>+]+)/);
    if (projectMatch) {
        project = projectMatch[1];
        txt = txt.replace(projectMatch[0], '').trim();
    }

    // 6. Extract GPU (`...)
    // Syntax: [Task Name]`[GPU Name]
    let gpu: string | undefined;
    const gpuMatch = txt.match(/`\s*([^\s!@%>$]+)/);
    if (gpuMatch) {
       gpu = gpuMatch[1].trim();
       txt = txt.replace(gpuMatch[0], '').trim();
       // If GPU is specified, force type to TRAINING unless it was already set?
       // Spec calls: "[Task]`GPU @ Time" -> Active Training.
       if (!type || type === 'FOCUS') type = 'TRAINING';
    }

    // 7. Remaining is Main and Sub
    const parts = txt.split('!');
    // 7. Infer SUSPEND if type is CREATE/FOCUS but no main text and has Time
    // "@ 25m" -> Main="" Time=...
    if ((type === 'CREATE' || type === 'FOCUS') && !parts[0].trim() && time) {
        type = 'SUSPEND';
    }

    return {
      type,
      main: parts[0].trim(),
      sub: parts[1] ? parts[1].trim() : undefined,
      project,
      time,
      isTraining: type === 'TRAINING',
      gpu,
      parentSearch,
      isSubtask
    };
  };

  return { parse };
};

