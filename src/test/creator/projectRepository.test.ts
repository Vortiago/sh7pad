import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  openProjectRepository,
  StorageError,
} from '../../creator/projectRepository.js';
import { newProject } from '../../creator/project.js';

let openRepos: Array<{ close(): void }> = [];

afterEach(() => {
  for (const r of openRepos) r.close();
  openRepos = [];
});

async function freshRepo() {
  const repo = await openProjectRepository({ factory: new IDBFactory() });
  openRepos.push(repo);
  return repo;
}

describe('projectRepository', () => {
  it('loadAll returns [] on a fresh database', async () => {
    const repo = await freshRepo();
    expect(await repo.loadAll()).toEqual([]);
  });

  it('save then loadAll round-trips a single project', async () => {
    const repo = await freshRepo();
    const p = newProject('Round-Trip');
    await repo.save(p);
    const loaded = await repo.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(p.id);
    expect(loaded[0]?.name).toBe('Round-Trip');
  });

  it('save with the same id updates rather than duplicates', async () => {
    const repo = await freshRepo();
    const p = newProject('First');
    await repo.save(p);
    await repo.save({ ...p, name: 'Second' });
    const loaded = await repo.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('Second');
  });

  it('delete removes the named project and leaves the others', async () => {
    const repo = await freshRepo();
    const a = newProject('Keep');
    const b = newProject('Drop');
    await repo.save(a);
    await repo.save(b);
    await repo.delete(b.id);
    const loaded = await repo.loadAll();
    expect(loaded.map((p) => p.name)).toEqual(['Keep']);
  });

  it('round-trips a project with bg.blob — bytes preserved', async () => {
    const repo = await freshRepo();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const proj = {
      ...newProject('With image'),
      bg: {
        blob: new Blob([bytes], { type: 'image/png' }),
        x: 1, y: 2, scale: 1.25, rotate: 15, opacity: 0.4, locked: false,
      },
    };
    await repo.save(proj);
    const [loaded] = await repo.loadAll();
    expect(loaded?.bg?.blob).toBeInstanceOf(Blob);
    expect(loaded?.bg?.blob.type).toBe('image/png');
    const roundTripped = new Uint8Array(await loaded!.bg!.blob.arrayBuffer());
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
    expect(loaded?.bg?.x).toBe(1);
    expect(loaded?.bg?.scale).toBe(1.25);
  });

  it('round-trips a project with bg === null', async () => {
    const repo = await freshRepo();
    const proj = newProject('No image');
    expect(proj.bg).toBeNull();
    await repo.save(proj);
    const [loaded] = await repo.loadAll();
    expect(loaded?.bg).toBeNull();
  });

  it('save throws StorageError(quotaExceeded:true) when the put fails with QuotaExceededError', async () => {
    const repo = await freshRepo();
    // Stub IDBObjectStore.prototype.put so it returns a synthetic IDBRequest
    // whose async onerror fires with a QuotaExceededError. fake-indexeddb's
    // node API doesn't model browser quotas natively, so this is the
    // cleanest way to drive the error path through the repository code.
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: unknown } } })
      .IDBObjectStore.prototype;
    const origPut = proto.put;
    proto.put = function patchedPut(): IDBRequest {
      const req = {
        error: Object.assign(new Error('quota'), { name: 'QuotaExceededError' }),
      } as unknown as IDBRequest & { onerror?: (e: Event) => void };
      queueMicrotask(() => req.onerror?.(new Event('error')));
      return req;
    };
    try {
      let caught: unknown;
      try {
        await repo.save(newProject('big'));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(StorageError);
      expect((caught as StorageError).quotaExceeded).toBe(true);
    } finally {
      proto.put = origPut;
    }
  });

  it('loadAll runs each record through migrateProject (v0 → v1 hoop)', async () => {
    // Pre-seed the DB with an old-shape record (non-centered hoop, first
    // point not at X=0). loadAll should fix both via migrateProject.
    const factory = new IDBFactory();
    const dbName = 'sh7_creator_test_migrate';
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: 'p_legacy',
          name: 'Old',
          createdAt: 1,
          updatedAt: 1,
          hoop: { w: 240, h: 150 },
          points: [{ id: 'a', x: 50, y: 0 }],
          segments: [],
          bg: null,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const repo = await openProjectRepository({ factory, dbName });
    openRepos.push(repo);
    const [loaded] = await repo.loadAll();
    expect(loaded?.hoop.halfW).toBe(120); // migrated from { w: 240 }
    expect(loaded?.points[0]?.x).toBe(0); // first point locked to X=0
  });
});
