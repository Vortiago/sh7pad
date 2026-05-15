// Memoized public entry point for Project → StitchSequence. The
// (mode, hasSatin) dispatch lives in `creator/designSource.ts`; this
// file owns the 1-entry render-pass cache and the foot-refusal safe
// wrapper.
//
// The orchestrator, preview, and stitch list panel all call
// sequenceFromProject with the same Project during a single render
// pass, so the memo skips repeated re-encoding inside one frame.

import type { Project } from '../types.js';
import { projectSequence } from '../designSource.js';
import { FootEncodeException } from './encodeSegments.js';
import type { StitchSequence } from './stitch.js';
import { EMPTY_SEQUENCE } from './stitch.js';

let cachedProject: Project | null = null;
let cachedResult: StitchSequence | null = null;

export function sequenceFromProject(project: Project): StitchSequence {
  if (cachedProject === project && cachedResult) {
    return cachedResult;
  }
  const result = projectSequence(project);
  cachedProject = project;
  cachedResult = result;
  return result;
}

/**
 * Renderer-safe variant of {@link sequenceFromProject}: catches
 * {@link FootEncodeException} and returns {@link EMPTY_SEQUENCE} so a
 * design that exceeds the active foot's reach degrades to an empty
 * preview instead of crashing the UI. Used by editor renderers, the
 * stitch list panel, and the preview. The export path keeps the
 * throwing version so refusal surfaces as a visible failure at save
 * time.
 */
export function safeSequenceFromProject(project: Project): StitchSequence {
  try {
    return sequenceFromProject(project);
  } catch (err) {
    if (err instanceof FootEncodeException) return EMPTY_SEQUENCE;
    throw err;
  }
}
