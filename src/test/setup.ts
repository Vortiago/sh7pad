// Test setup. fake-indexeddb/auto installs an in-memory IndexedDB
// implementation onto globalThis (indexedDB, IDBKeyRange, IDB* event
// types) so tests of projectRepository run in either node or jsdom envs
// without a real browser.
import 'fake-indexeddb/auto';
