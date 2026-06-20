import { createHash } from 'node:crypto';
import {
  assertCitedEvidence,
  buildUnusableBuildingCodeResultMessage,
  wrapBuildingCodeEvidenceForModel,
} from '../mcp/building-code/citation';
import type { BuildingCodeEvidence } from '../mcp/building-code/types';

type ToolResultImage = {
  data: string;
  mimeType: string;
};

type NormalizedToolTextResult = {
  text: string;
  images: ToolResultImage[];
};

type NormalizedToolExecutionResult = {
  content: string;
  images: ToolResultImage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isToolResultImage(value: unknown): value is ToolResultImage {
  return (
    isRecord(value) &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string' &&
    value.data.length > 0 &&
    value.mimeType.length > 0
  );
}

function redactLargeBinaryData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactLargeBinaryData(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const objectType = typeof value.type === 'string' ? value.type : undefined;
  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === 'string') {
      if (objectType === 'image' && key === 'data') {
        redacted[key] = `[image base64 omitted: ${nestedValue.length} chars]`;
        continue;
      }

      if ((key === 'base64' || key === 'inlineDataBase64') && nestedValue.length > 128) {
        redacted[key] = `[base64 omitted: ${nestedValue.length} chars]`;
        continue;
      }

      if (key === 'url' && /^data:image\//i.test(nestedValue)) {
        redacted[key] = `[image data URL omitted: ${nestedValue.length} chars]`;
        continue;
      }
    }

    redacted[key] = redactLargeBinaryData(nestedValue);
  }

  return redacted;
}

function safeStringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(redactLargeBinaryData(value));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable tool result: ${details}]`;
  }
}

function summarizeStructuredToolPart(part: unknown): string | null {
  if (!isRecord(part)) {
    return typeof part === 'string' ? part : safeStringifyToolResult(part);
  }

  if (part.type === 'text') {
    return typeof part.text === 'string' ? part.text : '';
  }

  if (part.type === 'image' && isToolResultImage(part)) {
    return null;
  }

  return safeStringifyToolResult(part);
}

function extractImagesFromDetails(details: unknown): ToolResultImage[] {
  if (!isRecord(details) || !Array.isArray(details.mepLabImages)) {
    return [];
  }

  return details.mepLabImages.flatMap((image) =>
    isToolResultImage(image) ? [{ data: image.data, mimeType: image.mimeType }] : []
  );
}

function extractTextAndImagesFromContent(content: unknown): {
  textParts: string[];
  images: ToolResultImage[];
} {
  if (!Array.isArray(content)) {
    return { textParts: [], images: [] };
  }

  const textParts: string[] = [];
  const images: ToolResultImage[] = [];

  for (const part of content) {
    if (isRecord(part) && part.type === 'image' && isToolResultImage(part)) {
      images.push({ data: part.data, mimeType: part.mimeType });
      continue;
    }

    const summary = summarizeStructuredToolPart(part);
    if (summary && summary.trim()) {
      textParts.push(summary.trim());
    }
  }

  return { textParts, images };
}

function dedupeImages(images: ToolResultImage[]): ToolResultImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const hash = createHash('sha256').update(image.data).digest('hex');
    const key = `${image.mimeType}:${hash}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function finalizeText(textParts: string[], imageCount: number): string {
  const normalized = textParts.map((part) => part.trim()).filter(Boolean);
  if (normalized.length > 0) {
    return normalized.join('\n\n');
  }
  if (imageCount > 0) {
    return imageCount === 1
      ? '[1 image output omitted from text context]'
      : `[${imageCount} image outputs omitted from text context]`;
  }
  return '(no output)';
}

function isBuildingCodeToolName(toolName: string | undefined): boolean {
  return typeof toolName === 'string' && toolName.startsWith('mcp__Building_Code__');
}

function normalizeBuildingCodeResultText(rawText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return buildUnusableBuildingCodeResultMessage('tool result was not valid JSON');
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return buildUnusableBuildingCodeResultMessage(
      'tool result did not include canonical cited evidence results'
    );
  }

  try {
    for (const result of parsed.results) {
      assertCitedEvidence(result);
    }
    return wrapBuildingCodeEvidenceForModel(parsed.results as BuildingCodeEvidence[]);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return buildUnusableBuildingCodeResultMessage(details);
  }
}

export function normalizeMcpToolResultForModel(
  result: unknown,
  toolName?: string
): NormalizedToolTextResult {
  const resultObj = isRecord(result) ? result : null;
  if (resultObj?.content) {
    const { textParts, images } = extractTextAndImagesFromContent(resultObj.content);
    const text = finalizeText(textParts, images.length);
    return {
      text: isBuildingCodeToolName(toolName) ? normalizeBuildingCodeResultText(text) : text,
      images,
    };
  }

  const text = typeof result === 'string' ? result : safeStringifyToolResult(result);
  return {
    text: isBuildingCodeToolName(toolName) ? normalizeBuildingCodeResultText(text) : text,
    images: [],
  };
}

export function normalizeToolExecutionResultForUi(
  result: unknown,
  toolName?: string
): NormalizedToolExecutionResult {
  const resultObj = isRecord(result) ? result : null;
  const detailImages = extractImagesFromDetails(resultObj?.details);

  if (resultObj?.content) {
    const { textParts, images: inlineImages } = extractTextAndImagesFromContent(resultObj.content);
    const images = dedupeImages([...inlineImages, ...detailImages]);
    const content = finalizeText(textParts, images.length);
    return {
      content: isBuildingCodeToolName(toolName) ? normalizeBuildingCodeResultText(content) : content,
      images,
    };
  }

  const content = typeof result === 'string' ? result : safeStringifyToolResult(result);
  return {
    content: isBuildingCodeToolName(toolName) ? normalizeBuildingCodeResultText(content) : content,
    images: dedupeImages(detailImages),
  };
}
