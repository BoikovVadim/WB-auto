import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";

const MAX_RANGE_DAYS = 400;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Class-level validator: ensures `startDate <= endDate` and that the span does
 * not exceed MAX_RANGE_DAYS. When either field is absent (optional ranges) the
 * check is skipped, so it is safe to apply to DTOs with optional dates.
 */
type Constructor = new (...args: never[]) => unknown;

export function IsValidDateRange(validationOptions?: ValidationOptions) {
  return function (constructor: Constructor) {
    registerDecorator({
      name: "isValidDateRange",
      target: constructor,
      propertyName: "startDate",
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as { startDate?: unknown; endDate?: unknown };
          const { startDate, endDate } = obj;
          if (typeof startDate !== "string" || typeof endDate !== "string") {
            return true;
          }
          const start = Date.parse(startDate);
          const end = Date.parse(endDate);
          if (Number.isNaN(start) || Number.isNaN(end)) {
            return true; // @IsDateString handles malformed values
          }
          if (start > end) {
            return false;
          }
          return (end - start) / MS_PER_DAY <= MAX_RANGE_DAYS;
        },
        defaultMessage() {
          return `startDate must be on or before endDate and the range must not exceed ${MAX_RANGE_DAYS} days`;
        },
      },
    });
  };
}
