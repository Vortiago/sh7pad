import { describe, it, expect, vi } from 'vitest';
import { renderToolbar, normalizeTool } from '../../ui/creator/toolbar/index.js';
import { newProject } from '../../creator/project.js';

const newDiv = (): HTMLDivElement => document.createElement('div');

describe('renderToolbar', () => {
  it('renders the four tool buttons (select/add/move/pan)', () => {
    const div = newDiv();
    renderToolbar(div, {
      tool: 'select', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-tool="select"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="add"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="move"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="pan"]')).not.toBeNull();
  });

  it('marks the Select tool active when state.tool === "select"', () => {
    const div = newDiv();
    renderToolbar(div, {
      tool: 'select', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-tool="select"]')?.getAttribute('data-active')).toBe('true');
    expect(div.querySelector('[data-tool="add"]')?.getAttribute('data-active')).toBe('false');
  });

  it('marks the active tool button with data-active="true"', () => {
    const div = newDiv();
    renderToolbar(div, {
      tool: 'move', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-tool="move"]')?.getAttribute('data-active')).toBe('true');
    expect(div.querySelector('[data-tool="add"]')?.getAttribute('data-active')).toBe('false');
  });

  it('renders both stitch type buttons (straight/satin)', () => {
    const div = newDiv();
    renderToolbar(div, {
      tool: 'add', activeStitch: 'satin', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-stitch="straight"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="satin"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="satin"]')?.getAttribute('data-active')).toBe('true');
  });

  it('clicking a tool button calls onTool', () => {
    const div = newDiv();
    const onTool = vi.fn();
    renderToolbar(div, {
      tool: 'add', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    div.querySelector<HTMLButtonElement>('[data-tool="pan"]')?.click();
    expect(onTool).toHaveBeenCalledWith('pan');
  });

  it('renders zoom in / zoom out / zoom reset buttons', () => {
    const div = newDiv();
    renderToolbar(div, {
      tool: 'select', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-zoom="in"]')).not.toBeNull();
    expect(div.querySelector('[data-zoom="out"]')).not.toBeNull();
    expect(div.querySelector('[data-zoom="reset"]')).not.toBeNull();
  });

  it('clicking zoom buttons calls onZoom with the corresponding action', () => {
    const div = newDiv();
    const onZoom = vi.fn();
    renderToolbar(div, {
      tool: 'select', activeStitch: 'straight', project: newProject('X'),
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom, onEncoderMode: () => {},
    });
    div.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click();
    div.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.click();
    div.querySelector<HTMLButtonElement>('[data-zoom="reset"]')!.click();
    expect(onZoom).toHaveBeenNthCalledWith(1, 'in');
    expect(onZoom).toHaveBeenNthCalledWith(2, 'out');
    expect(onZoom).toHaveBeenNthCalledWith(3, 'reset');
  });
});

describe('renderToolbar — manual mode shows Needle / Satin / Jump on both feet', () => {
  it('Manual + Foot S shows Needle, Satin, and Jump (no Straight)', () => {
    const div = newDiv();
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'S' });
    renderToolbar(div, {
      tool: 'add', activeStitch: 'needle', project,
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-stitch="needle"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="satin"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="jump"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="straight"]')).toBeNull();
  });

  it('Manual + Foot B also shows Jump (Foot B carriage walks within ±4.5 mm)', () => {
    // the foot-B reference design is a 9 mm-wide Foot B design with jumps — the foot is
    // not stationary. validateManualStitch enforces the 1 mm dx envelope and
    // ±4.5 mm carriage cap; the toolbar surfaces the tool for both feet.
    const div = newDiv();
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'B' });
    renderToolbar(div, {
      tool: 'add', activeStitch: 'needle', project,
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-stitch="needle"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="satin"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="jump"]')).not.toBeNull();
  });

  it('Design mode keeps the Straight / Satin buttons (no Needle / Jump)', () => {
    const div = newDiv();
    const project = newProject('X', { mode: 'design' });
    renderToolbar(div, {
      tool: 'add', activeStitch: 'straight', project,
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-stitch="straight"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="satin"]')).not.toBeNull();
    expect(div.querySelector('[data-stitch="needle"]')).toBeNull();
    expect(div.querySelector('[data-stitch="jump"]')).toBeNull();
  });

  it('clicking Needle fires onStitch("needle")', () => {
    const div = newDiv();
    const onStitch = vi.fn();
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'S' });
    renderToolbar(div, {
      tool: 'add', activeStitch: 'jump', project,
    }, {
      onTool: () => {}, onStitch, onZoom: () => {}, onEncoderMode: () => {},
    });
    div.querySelector<HTMLButtonElement>('[data-stitch="needle"]')?.click();
    expect(onStitch).toHaveBeenCalledWith('needle');
  });
});

describe('renderToolbar — Move tool is design-only', () => {
  // Manual mode's stitch list is append-only: no entry is movable, only
  // the last is removable. Surfacing a Move button would lie about what
  // the editor can do.
  it('Manual mode hides the Move tool button', () => {
    const div = newDiv();
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'S' });
    renderToolbar(div, {
      tool: 'select', activeStitch: 'needle', project,
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-tool="select"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="add"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="pan"]')).not.toBeNull();
    expect(div.querySelector('[data-tool="move"]')).toBeNull();
  });

  it('Design mode keeps the Move tool button', () => {
    const div = newDiv();
    const project = newProject('X', { mode: 'design' });
    renderToolbar(div, {
      tool: 'select', activeStitch: 'straight', project,
    }, {
      onTool: () => {}, onStitch: () => {}, onZoom: () => {}, onEncoderMode: () => {},
    });
    expect(div.querySelector('[data-tool="move"]')).not.toBeNull();
  });
});

describe('normalizeTool', () => {
  // Mirrors normalizeActiveStitch: on project mode switch, demote
  // ui.tool to a value the new mode's toolbar still surfaces, so the
  // user can't be left in a stored tool whose button has vanished.
  it('demotes "move" to "select" on a manual project', () => {
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'S' });
    expect(normalizeTool(project, 'move')).toBe('select');
  });

  it('leaves "move" untouched on a design project', () => {
    const project = newProject('X', { mode: 'design' });
    expect(normalizeTool(project, 'move')).toBe('move');
  });

  it('leaves non-move tools untouched on a manual project', () => {
    const project = newProject('X', { mode: 'manual', suggestedFoot: 'S' });
    expect(normalizeTool(project, 'select')).toBe('select');
    expect(normalizeTool(project, 'add')).toBe('add');
    expect(normalizeTool(project, 'pan')).toBe('pan');
  });
});
