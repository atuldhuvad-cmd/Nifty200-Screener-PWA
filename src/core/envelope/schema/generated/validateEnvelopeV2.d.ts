// GENERATED FILE — do not edit by hand.
// Produced by scripts/compile-schema.mjs from schema/envelope.v2.schema.json.
// Regenerate with: node scripts/compile-schema.mjs
export interface AjvValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
}
export interface EnvelopeValidator {
  (data: unknown): boolean;
  errors?: AjvValidationError[] | null;
}
export const validate: EnvelopeValidator;
export default validate;
