import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export const parse = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
};
export const tenantId = (value: string) => parse(z.string().uuid(), value);
