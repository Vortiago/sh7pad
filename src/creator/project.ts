// Barrel re-export for the Project module cluster. The original
// project.ts mixed seven concerns (factory, accessors, invariants,
// migration, segment reducers, metadata reducers, dev seed); they now
// live in their own files. This barrel keeps every existing
// `import { ... } from '../project.js'` working unchanged.

export {
  HOOP_H,
  HOOP_HALF_W,
  DEFAULT_SATIN_DENSITY_MM,
  DEFAULT_SATIN_WIDTH_MM,
  DEFAULT_THREAD_TENSION,
  TENSION_MAX,
  TENSION_MIN,
  TENSION_STEP,
  chainEndPointId,
  hasSatin,
  newProject,
  startXMmOf,
} from './projectFactory.js';
export type { NewProjectOptions } from './projectFactory.js';

export {
  isStartLocked,
  lockFirstPoint,
  lockProjectInvariants,
  lockStartXMm,
} from './projectInvariants.js';

export { migrateProject } from './projectMigrate.js';

export {
  addPointToProject,
  mergeSegmentPatch,
  movePointPreservingSatinSpines,
  removePoint,
  removeSegment,
  subdivideSegment,
  updateSegment,
} from './segmentReducers.js';
export type { AddPointIds, SubdivideSegmentIds } from './segmentReducers.js';

export {
  clearBgImage,
  moveBgImage,
  setBgImage,
  setProjectName,
  setThreadTension,
  updateBgImage,
} from './projectMetadata.js';

export { SAMPLE } from './projectSample.js';
