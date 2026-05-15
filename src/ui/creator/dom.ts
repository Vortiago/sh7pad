// Tiny DOM helpers shared across all Creator UI modules.

export function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

export function textEl(tag: string, cls: string, text: string): HTMLElement {
  const node = el(tag, cls);
  node.textContent = text;
  return node;
}

// Build a class string for a button rooted in the shared .app-btn base
// (defined in shared/shared.css). Forces the prefix at every call site so it
// can't be forgotten when adding a new button.
export function appBtn(modifier: string): string {
  return `app-btn ${modifier}`;
}

/**
 * Parse an HTML string into a <template>. Use at module scope to turn a
 * `?raw` HTML import into a reusable template. Static structure (parent →
 * children, class names that don't change) belongs in the .html file;
 * dynamic state (text, classes, listeners) is filled in on the cloned node.
 *
 * @example
 *   import html from './myComponent.html?raw';
 *   const tpl = tplFrom(html);
 *   const node = cloneTpl(tpl);
 */
export function tplFrom(html: string): HTMLTemplateElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl;
}

/**
 * Clone the first element child of a template. For multi-template HTML files,
 * use `tpl.content.querySelector('#name')` to pick out each named `<template>`
 * and pass to `cloneTpl`.
 */
export function cloneTpl<T extends HTMLElement = HTMLElement>(
  tpl: HTMLTemplateElement,
): T {
  return tpl.content.firstElementChild!.cloneNode(true) as T;
}

/**
 * Find a `[data-slot="name"]` element inside a cloned template node. Throws
 * if the slot is missing — slot names are static, so a missing slot is a bug.
 */
export function slot<T extends HTMLElement = HTMLElement>(
  root: HTMLElement,
  name: string,
): T {
  const node = root.querySelector<T>(`[data-slot="${name}"]`);
  if (!node) throw new Error(`Missing [data-slot="${name}"]`);
  return node;
}

/**
 * Find a `[data-action="name"]` element inside a cloned template node. Used
 * to wire event listeners to buttons declared in HTML.
 */
export function action<T extends HTMLElement = HTMLElement>(
  root: HTMLElement,
  name: string,
): T {
  const node = root.querySelector<T>(`[data-action="${name}"]`);
  if (!node) throw new Error(`Missing [data-action="${name}"]`);
  return node;
}
