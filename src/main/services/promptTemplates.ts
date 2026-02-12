/**
 * Prompt Templates — optimized for LLaVA-Med v1.5 (7B Mistral-based VQA model).
 *
 * LLaVA-Med is based on Mistral 7B and uses the [INST]...[/INST] chat template.
 * The /v1/chat/completions endpoint often fails to apply the correct template
 * for multimodal models (logs show "Chat format: Content-only"), so we format
 * the prompt ourselves and use the raw /completion endpoint instead.
 *
 * The [IMG] placeholder is where llama-server inserts the image embedding
 * when using the `image_data` parameter on the /completion endpoint.
 *
 * Output format: structured JSON with findings[], impression, and limitations.
 * Falls back gracefully to free-text parsing if the model doesn't produce JSON.
 */
import type { AiAnalysisRequest } from '../../shared/types/ai';

// ─── Prompt Construction ────────────────────────────────────────

/**
 * Build the complete prompt string using Mistral [INST] template.
 *
 * LLaVA-Med expects:
 *   <s>[INST] <image>\n{question} [/INST]
 *
 * Where <image> is replaced internally by the vision encoder's output.
 * For llama-server's /completion endpoint, we use [img-N] placeholders
 * that get replaced by the corresponding image_data entries.
 */
export function buildPrompt(request: AiAnalysisRequest): string {
  const parts: string[] = [];

  // Direct question — matches LLaVA-Med's VQA training style
  parts.push(`Describe the findings in this ${request.modality || 'medical'} image. Note the severity of each finding.`);

  // Brief metadata for clinical context
  if (request.seriesDescription) {
    parts.push(`Series: ${request.seriesDescription}`);
  }
  if (request.bodyPart) {
    parts.push(`Body part: ${request.bodyPart}`);
  }
  if (request.patientAge || request.patientSex) {
    const demo: string[] = [];
    if (request.patientAge) demo.push(request.patientAge);
    if (request.patientSex) demo.push(request.patientSex);
    parts.push(`Patient: ${demo.join(', ')}`);
  }

  const question = parts.join('\n');

  // Mistral [INST] template with image placeholder.
  // [img-10] is the placeholder for the first image (id=10).
  // Additional window images get sequential ids.
  let prompt = `[INST] [img-10]\n${question} [/INST]`;

  return prompt;
}

/**
 * Extract image data from the request as an array of {id, data} objects
 * for llama-server's /completion endpoint `image_data` parameter.
 *
 * The `data` field must be raw base64 (no data:image/... prefix).
 * Each image gets an integer `id` that matches [img-N] in the prompt.
 */
export function extractImageData(
  request: AiAnalysisRequest,
): Array<{ data: string; id: number }> {
  const images: Array<{ data: string; id: number }> = [];

  // Primary image — id matches [img-10] in prompt
  images.push({
    data: stripDataUrlPrefix(request.imageDataUrl),
    id: 10,
  });

  // Additional window images (CT multi-window) — sequential ids
  if (request.additionalWindows) {
    request.additionalWindows.forEach((win, idx) => {
      images.push({
        data: stripDataUrlPrefix(win.dataUrl),
        id: 11 + idx,
      });
    });
  }

  return images;
}

/**
 * Strip the "data:image/...;base64," prefix from a data URL.
 * llama-server's image_data expects raw base64 only.
 */
function stripDataUrlPrefix(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx !== -1) {
    return dataUrl.slice(commaIdx + 1);
  }
  return dataUrl;
}
