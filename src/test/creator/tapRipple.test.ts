// @vitest-environment jsdom
// tapRipple — spawns a transient ripple span on the canvas wrap so
// touch taps get visual confirmation. Pure DOM, no store mediation.

import { beforeEach, describe, expect, it } from 'vitest';
import { spawnRipple } from '../../ui/creator/tapRipple/index.js';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  host.style.position = 'relative';
  document.body.appendChild(host);
});

describe('spawnRipple', () => {
  it('appends a ripple element at the given coordinates', () => {
    spawnRipple(host, 100, 50);
    const ripple = host.querySelector<HTMLElement>('.ed-tap-ripple');
    expect(ripple).not.toBeNull();
    expect(ripple!.style.left).toBe('100px');
    expect(ripple!.style.top).toBe('50px');
  });

  it('stacks fresh ripples on repeat calls at the same point', () => {
    spawnRipple(host, 100, 50);
    spawnRipple(host, 100, 50);
    expect(host.querySelectorAll('.ed-tap-ripple').length).toBe(2);
  });

  it('removes the ripple when its CSS animation ends', () => {
    spawnRipple(host, 10, 20);
    const ripple = host.querySelector<HTMLElement>('.ed-tap-ripple');
    expect(ripple).not.toBeNull();
    ripple!.dispatchEvent(new Event('animationend'));
    expect(host.querySelector('.ed-tap-ripple')).toBeNull();
  });
});
