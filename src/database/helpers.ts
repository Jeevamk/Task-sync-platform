import type { Model } from 'mongoose';
import type { Session } from './database.service';

/** Inserts one document (inside the transaction when a session is given) and returns it as a plain object with `id`. */
export async function insertOne<T>(model: Model<T>, data: Partial<T> & Record<string, unknown>, session?: Session): Promise<T> {
  const [doc] = await model.create([data], { session });
  const plain = doc as unknown as { toObject?: () => T };
  return typeof plain.toObject === 'function' ? plain.toObject() : (doc as unknown as T);
}

/**
 * True when MongoDB refused a write because of a unique index (error 11000).
 * With `fields`, only when the clashing index includes one of them (e.g. 'externalId').
 */
export function isDuplicateKey(err: unknown, ...fields: string[]): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string } | null;
  if (e?.code !== 11000) return false;
  if (!fields.length) return true;
  const keys = Object.keys(e.keyPattern ?? {});
  return fields.some((f) => keys.includes(f) || (!keys.length && String(e.message).includes(f)));
}
