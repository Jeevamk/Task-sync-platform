import mongoose, { Query, Schema } from 'mongoose';

const READ_HOOKS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace'] as const;

/** `_id` → `id` (first key), so documents look the same as the API always returned them. Changes the object in place. */
function exposeId(doc: unknown): void {
  if (!doc || typeof doc !== 'object' || doc instanceof mongoose.Document || !('_id' in doc)) return;
  const { _id, ...rest } = doc as Record<string, unknown>;
  for (const key of Object.keys(doc)) delete (doc as Record<string, unknown>)[key];
  Object.assign(doc, { id: _id, ...rest });
}

/**
 * Every read returns plain objects (lean) with `id` instead of `_id`.
 * So services never deal with Mongoose documents: what they read is what the API returns.
 */
export function plainDocuments(schema: Schema): void {
  schema.pre([...READ_HOOKS], function (this: Query<unknown, unknown>) {
    if (this.mongooseOptions().lean == null) this.lean();
  });
  schema.post([...READ_HOOKS], function (result: unknown) {
    if (Array.isArray(result)) result.forEach(exposeId);
    else exposeId(result);
  });
  const transform = (_doc: unknown, ret: Record<string, unknown>) => {
    exposeId(ret);
    return ret;
  };
  schema.set('toObject', { versionKey: false, transform });
  schema.set('toJSON', { versionKey: false, transform });
}
