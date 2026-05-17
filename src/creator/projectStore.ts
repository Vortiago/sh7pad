// Tiny pub/sub store for the active project. All mutations go through
// setState so the lockFirstPoint invariant can be enforced in one place.
//
// This replaces React's useState+useEffect from the prototype. Modules
// subscribe to project changes and re-render. Persistence happens in main.ts
// via a subscription that calls saveProjects(localStorage, [getState()]).

import { lockProjectInvariants } from './project.js';
import type { Project } from './types.js';

export type Subscriber = (project: Project) => void;
export type Unsubscribe = () => void;
export type Updater = ((prev: Project) => Project) | Project;

export interface ProjectStore {
  getState(): Project;
  setState(updater: Updater): void;
  subscribe(fn: Subscriber): Unsubscribe;
}

export function createProjectStore(initial: Project): ProjectStore {
  // lockProjectInvariants composes lockFirstPoint internally as the last
  // step (see projectInvariants.lockProjectInvariants); an outer
  // lockFirstPoint here would just re-run the same fixed point.
  let state = lockProjectInvariants(null, initial);
  const subscribers = new Set<Subscriber>();

  return {
    getState(): Project {
      return state;
    },
    setState(updater: Updater): void {
      const next = typeof updater === 'function'
        ? (updater as (prev: Project) => Project)(state)
        : updater;
      const locked = lockProjectInvariants(state, next);
      // Skip notification when the updater (and the invariant locks)
      // returned the same reference — saves a full renderAll() for
      // callers that produce no-op state changes (e.g. dragging a point
      // to its current snap cell).
      if (locked === state) return;
      state = locked;
      for (const fn of subscribers) fn(state);
    },
    subscribe(fn: Subscriber): Unsubscribe {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
  };
}
