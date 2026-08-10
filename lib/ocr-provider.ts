// Pluggable OCR adapter for the label-scan flow. No OCR vendor is
// configured in this repo (no Google Cloud Vision / AWS Textract / similar
// credentials present) — `ocrProvider.configured` is false and
// `extractNutritionLabel` always returns "not configured". The label-scan
// API route and its request/response contract are fully real regardless;
// swapping in a live vendor only means implementing OcrProvider and
// replacing the export below — nothing else in the request path changes.

export interface OcrExtractedNutritionFields {
  name: string | null;
  brandName: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  saturatedFatG: number | null;
  servingLabel: string | null;
  servingGrams: number | null;
}

export type OcrResult =
  | { ok: true; fields: OcrExtractedNutritionFields; rawText: string }
  | { ok: false; reason: string };

export interface OcrProvider {
  readonly configured: boolean;
  extractNutritionLabel(imageBase64: string): Promise<OcrResult>;
}

export const ocrProvider: OcrProvider = {
  configured: false,
  async extractNutritionLabel() {
    return {
      ok: false,
      reason: "No OCR provider is configured for this deployment. Wire a vendor (e.g. Cloud Vision/Textract) into lib/ocr-provider.ts to enable label scanning.",
    };
  },
};

// Best-effort heuristic parser for when a real OCR provider returns raw
// text — nutrition labels are semi-structured enough that simple line-based
// regex extraction gets most fields right, with the user confirming/editing
// everything before it's saved either way (per the label-scan requirement).
const FIELD_PATTERNS: { key: keyof OcrExtractedNutritionFields; pattern: RegExp; multiplier?: number }[] = [
  { key: "calories", pattern: /calories\D{0,10}(\d+(?:\.\d+)?)/i },
  { key: "proteinG", pattern: /protein\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "carbsG", pattern: /(?:total\s+)?carbohydrate[s]?\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "fatG", pattern: /(?:total\s+)?fat\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "fiberG", pattern: /(?:dietary\s+)?fib(?:er|re)\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "sugarG", pattern: /sugars?\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "saturatedFatG", pattern: /saturated\s+fat\D{0,10}(\d+(?:\.\d+)?)\s*g/i },
  { key: "sodiumMg", pattern: /sodium\D{0,10}(\d+(?:\.\d+)?)\s*mg/i },
];

export function parseNutritionLabelText(rawText: string): OcrExtractedNutritionFields {
  const fields: OcrExtractedNutritionFields = {
    name: null,
    brandName: null,
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
    sugarG: null,
    sodiumMg: null,
    saturatedFatG: null,
    servingLabel: null,
    servingGrams: null,
  };

  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = rawText.match(pattern);
    if (match) (fields as unknown as Record<string, number>)[key] = parseFloat(match[1]);
  }

  const servingMatch = rawText.match(/serving\s+size\D{0,10}([^\n]+)/i);
  if (servingMatch) {
    fields.servingLabel = servingMatch[1].trim().slice(0, 60);
    const gramsMatch = servingMatch[1].match(/([\d.]+)\s*g/i);
    if (gramsMatch) fields.servingGrams = parseFloat(gramsMatch[1]);
  }

  return fields;
}
