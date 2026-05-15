// Creator orchestrator. Wires the store, panes, sidebar, mode switch,
// stitch list, transport. Persists Project records to IndexedDB and
// the boot-critical UI sentinel flags (sidebar collapse, disclaimer
// seen) to localStorage so first-paint stays sync.
//
// On first load: tries the project IDB, otherwise seeds the SAMPLE wave
// so the canvas isn't empty. New projects use the project store
// directly; the store enforces the lockFirstPoint invariant on every
// setState.

import { mountCreator } from './mountCreator.js';
import { openProjectRepository } from '../../creator/projectRepository.js';

if (typeof window !== 'undefined' && document.getElementById('app')) {
  void (async () => {
    const repo = await openProjectRepository();
    await mountCreator(document, repo, window.localStorage);
  })();
}
