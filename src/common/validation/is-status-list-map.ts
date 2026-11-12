import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Checks an object like { "IN_PROGRESS": "Doing" }:
 * every key must be one of `allowedKeys`, every value a non-empty string.
 */
export function IsStatusListMap(allowedKeys: readonly string[], options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isStatusListMap',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.entries(value).every(([key, name]) => allowedKeys.includes(key) && typeof name === 'string' && name.trim().length > 0),
        defaultMessage: () => `lists keys must be ${allowedKeys.join(', ')} and each value a list name, e.g. { "IN_PROGRESS": "Doing" }`,
      },
    },
    options,
  );
}
