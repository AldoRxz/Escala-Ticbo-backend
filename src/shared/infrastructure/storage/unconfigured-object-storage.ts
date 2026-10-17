import {
  ObjectStorage,
  StorageNotConfiguredError,
  type StoredObject,
} from '../../application/object-storage.js';

/** Stands in until the bucket settings exist: every call explains what is missing. */
export class UnconfiguredObjectStorage extends ObjectStorage {
  put(): Promise<void> {
    return Promise.reject(new StorageNotConfiguredError());
  }

  get(): Promise<StoredObject | null> {
    return Promise.reject(new StorageNotConfiguredError());
  }

  delete(): Promise<void> {
    return Promise.reject(new StorageNotConfiguredError());
  }
}
