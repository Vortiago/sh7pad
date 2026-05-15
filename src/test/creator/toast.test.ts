import { describe, it, expect } from 'vitest';
import { showToast, removeToast } from '../../ui/creator/toast/index.js';

describe('toast', () => {
  it('showToast appends a .toast div with the message', () => {
    showToast('Hello');
    const t = document.querySelector('.toast');
    expect(t).not.toBeNull();
    expect(t?.textContent).toBe('Hello');
    removeToast();
  });

  it('removeToast removes the toast', () => {
    showToast('To be removed');
    removeToast();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('showToast called twice replaces the previous toast', () => {
    showToast('first');
    showToast('second');
    const all = document.querySelectorAll('.toast');
    expect(all.length).toBe(1);
    expect(all[0]?.textContent).toBe('second');
    removeToast();
  });
});
