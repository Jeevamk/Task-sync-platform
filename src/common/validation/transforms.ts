import { TransformFnParams } from 'class-transformer';

/**
 * Small reusable transforms for DTO fields, used as  @Transform(trim).
 * They run BEFORE validation, so "  Acme  " is checked (and saved) as "Acme".
 */

/** Trims strings; leaves anything else as is (so the type check can still reject it). */
export const trim = ({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim() : value);

/** Trims and lower-cases strings (emails). */
export const trimLower = ({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim().toLowerCase() : value);
