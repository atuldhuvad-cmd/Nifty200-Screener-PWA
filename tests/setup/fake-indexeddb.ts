// Installs indexedDB/IDBKeyRange globals for all tests (harmless for tests that never touch
// IndexedDB). Pinned exact version in devDependencies (fake-indexeddb).
import 'fake-indexeddb/auto';
