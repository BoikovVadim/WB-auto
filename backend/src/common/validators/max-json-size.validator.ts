import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";

/**
 * Rejects objects whose JSON.stringify length exceeds `maxChars`.
 * Guards against unbounded payloads on free-form object fields.
 */
export function MaxJsonSize(maxChars: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "maxJsonSize",
      target: object.constructor,
      propertyName,
      constraints: [maxChars],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) {
            return true;
          }
          const [limit] = args.constraints as [number];
          try {
            return JSON.stringify(value).length <= limit;
          } catch {
            // Non-serializable (e.g. circular) payloads are rejected.
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          const [limit] = args.constraints as [number];
          return `${args.property} exceeds the maximum serialized size of ${limit} characters`;
        },
      },
    });
  };
}
