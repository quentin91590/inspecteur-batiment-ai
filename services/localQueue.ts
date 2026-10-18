// File d'attente d'analyse conservée sur l'appareil (IndexedDB).
// Les photos prises hors réseau survivent à une fermeture de l'appli et sont analysées au retour du réseau.
import type { QueueItem } from '../types';

const DB_NAME = 'inspecteur-v2';
const STORE = 'queues';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponible'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const getDb = () => (dbPromise ??= openDb());

const keyFor = (userId: string, buildingId: string) => `${userId}/${buildingId}`;

export async function loadLocalQueue(userId: string, buildingId: string): Promise<QueueItem[]> {
  try {
    const db = await getDb();
    return await new Promise<QueueItem[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyFor(userId, buildingId));
      req.onsuccess = () => {
        const items = (req.result as QueueItem[] | undefined) ?? [];
        // Une analyse interrompue (appli fermée) repart en attente
        resolve(items.map(i => (i.status === 'analyzing' ? { ...i, status: 'pending', progressStep: undefined } : i)));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('File locale illisible', e);
    return [];
  }
}

export async function saveLocalQueue(userId: string, buildingId: string, queue: QueueItem[]): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (queue.length) store.put(queue, keyFor(userId, buildingId));
      else store.delete(keyFor(userId, buildingId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('File locale non enregistrée', e);
  }
}
