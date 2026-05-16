// Pure reducers for project-level metadata that lives outside the
// points/segments graph: the project name, thread tension, and the
// background image. The sidebar uses these to wire up its settings UI.

import type { BgImage, Project } from './types.js';
import { TENSION_MAX, TENSION_MIN } from './projectFactory.js';

/** Rename the project. */
export function setProjectName(project: Project, name: string, now: number = Date.now()): Project {
  return { ...project, name, updatedAt: now };
}

/** Set thread tension, clamped to [TENSION_MIN, TENSION_MAX]. */
export function setThreadTension(project: Project, value: number, now: number = Date.now()): Project {
  const clamped = Math.min(TENSION_MAX, Math.max(TENSION_MIN, value));
  return { ...project, threadTension: clamped, updatedAt: now };
}

/** Replace the background image (or set one for the first time). */
export function setBgImage(project: Project, bg: BgImage, now: number = Date.now()): Project {
  return { ...project, bg, updatedAt: now };
}

/** Apply a partial update to the existing background image. No-op when no bg is set. */
export function updateBgImage(
  project: Project,
  patch: Partial<BgImage>,
  now: number = Date.now(),
): Project {
  if (!project.bg) return project;
  return { ...project, bg: { ...project.bg, ...patch }, updatedAt: now };
}

/** Remove the background image. */
export function clearBgImage(project: Project, now: number = Date.now()): Project {
  return { ...project, bg: null, updatedAt: now };
}

/**
 * Translate the background image by (dxMm, dyMm). No-op when no bg is set.
 * Editor uses this for the bg-drag gesture.
 */
export function moveBgImage(
  project: Project,
  dxMm: number,
  dyMm: number,
  now: number = Date.now(),
): Project {
  if (!project.bg) return project;
  return {
    ...project,
    bg: { ...project.bg, x: project.bg.x + dxMm, y: project.bg.y + dyMm },
    updatedAt: now,
  };
}
