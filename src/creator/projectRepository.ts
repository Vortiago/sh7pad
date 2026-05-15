// IndexedDB-backed persistence for Creator projects. Replaces the
// localStorage approach: each project lives as its own record so we
// never rewrite the full list, and BgImage carries a native Blob
// (no base64 overhead) since IDB stores Blobs directly.

import { migrateProject } from './project.js';
import type { Project } from './types.js';

const DEFAULT_DB_NAME = 'sh7_creator';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';

export interface StorageErrorOptions {
  quotaExceeded?: boolean;
}

export class StorageError extends Error {
  readonly quotaExceeded: boolean;

  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message);
    this.name = 'StorageError';
    this.quotaExceeded = options.quotaExceeded ?? false;
  }
}

function toStorageError(err: unknown, fallbackMessage: string): StorageError {
  if (err instanceof StorageError) return err;
  const e = err as { name?: string; message?: string } | null;
  const isQuota =
    e?.name === 'QuotaExceededError' ||
    e?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  return new StorageError(
    isQuota ? 'IndexedDB quota exceeded' : `${fallbackMessage}: ${e?.message ?? err}`,
    { quotaExceeded: isQuota },
  );
}

export interface ProjectRepository {
  loadAll(): Promise<Project[]>;
  save(project: Project): Promise<void>;
  saveAll(projects: Project[]): Promise<void>;
  delete(id: string): Promise<void>;
  close(): void;
}

export interface OpenOptions {
  factory?: IDBFactory;
  dbName?: string;
}

export async function openProjectRepository(
  options: OpenOptions = {},
): Promise<ProjectRepository> {
  const factory = options.factory ?? globalThis.indexedDB;
  const name = options.dbName ?? DEFAULT_DB_NAME;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const upgradeDb = req.result;
      if (!upgradeDb.objectStoreNames.contains(STORE_PROJECTS)) {
        upgradeDb.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return {
    async loadAll(): Promise<Project[]> {
      const records = await new Promise<Project[]>((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, 'readonly');
        const store = tx.objectStore(STORE_PROJECTS);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result ?? []) as Project[]);
        req.onerror = () => reject(req.error);
      });
      // Apply schema migrations (e.g. v0 hoop {w,h} → v1 {halfW,h}) on
      // read so older records open without manual intervention.
      return records.map((p) => migrateProject(p));
    },
    async save(project: Project): Promise<void> {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);
          const req = store.put(project);
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        throw toStorageError(err, 'Failed to save project');
      }
    },
    async saveAll(projects: Project[]): Promise<void> {
      // One transaction puts every project atomically — either all
      // succeed or none do (e.g. on quota exhaustion).
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);
          for (const p of projects) {
            const req = store.put(p);
            req.onerror = () => reject(req.error);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        throw toStorageError(err, 'Failed to save projects');
      }
    },
    async delete(id: string): Promise<void> {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);
          store.delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        throw toStorageError(err, 'Failed to delete project');
      }
    },
    close(): void {
      db.close();
    },
  };
}
