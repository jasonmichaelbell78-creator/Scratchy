import { VideoMetadata } from '../types';

const DB_NAME = 'VideoMindDB';
const DB_VERSION = 1;
const STORE_VIDEOS = 'videos';
const STORE_CHUNKS = 'video_chunks'; // Storing base64 strings

// Helper to open DB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
      }
    };
  });
};

export const saveVideoToDB = async (metadata: VideoMetadata, base64Data?: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_VIDEOS, STORE_CHUNKS], 'readwrite');
    const videoStore = transaction.objectStore(STORE_VIDEOS);
    const chunkStore = transaction.objectStore(STORE_CHUNKS);

    videoStore.put(metadata);
    
    // Only save chunk if we actually have binary data (local uploads)
    if (base64Data) {
      chunkStore.put({ id: metadata.id, data: base64Data });
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getAllVideosMetadata = async (userId: string): Promise<VideoMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readonly');
    const store = transaction.objectStore(STORE_VIDEOS);
    const request = store.getAll();
    request.onsuccess = () => {
      // Client-side filtering for demo purposes. 
      // In a real app, we'd use an IDBIndex on userId.
      const allVideos = request.result as VideoMetadata[];
      const userVideos = allVideos.filter(v => v.userId === userId);
      resolve(userVideos);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getVideoData = async (id: string): Promise<{ metadata: VideoMetadata; base64Data?: string } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_VIDEOS, STORE_CHUNKS], 'readonly');
    
    let metadata: VideoMetadata | undefined;
    let chunkData: { id: string; data: string } | undefined;

    const metaReq = transaction.objectStore(STORE_VIDEOS).get(id);
    const chunkReq = transaction.objectStore(STORE_CHUNKS).get(id);

    metaReq.onsuccess = () => { metadata = metaReq.result; };
    chunkReq.onsuccess = () => { chunkData = chunkReq.result; };

    transaction.oncomplete = () => {
      if (metadata) {
        resolve({ metadata, base64Data: chunkData?.data });
      } else {
        resolve(null);
      }
    };
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteVideoFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_VIDEOS, STORE_CHUNKS], 'readwrite');
    transaction.objectStore(STORE_VIDEOS).delete(id);
    transaction.objectStore(STORE_CHUNKS).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};