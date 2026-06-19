import type { BuildingCodeEvidence, CodeCitation, CodeLayoutBox } from './types';

type DisplayCitationInput = Pick<CodeCitation, 'codeFamily' | 'edition' | 'logicalRef'>;

const allowedCitationStatuses = ['complete', 'partial'] as const;
const allowedCodeNodeTypes = [
  'section',
  'subsection',
  'table',
  'table-row',
  'table-note',
  'figure',
  'definition',
  'appendix',
  'note',
] as const;
const allowedEvidenceKinds = ['section', 'table-row', 'table-note', 'cross-reference'] as const;
const requiredEvidenceStringFields = ['evidenceId', 'nodeId', 'evidenceKind', 'excerpt'] as const;
const requiredCitationStringFields = [
  'status',
  'citationId',
  'sourceId',
  'documentId',
  'codeFamily',
  'edition',
  'jurisdictionScope',
  'sourceTitle',
  'sourceUrl',
  'sourceChecksum',
  'logicalRef',
  'nodeType',
  'pageRange',
  'displayCitation',
] as const;
const allowedParserNames = ['docling', 'fixture'] as const;

export function buildDisplayCitation(input: DisplayCitationInput): string {
  const codeFamily = normalizeCitationPart(input.codeFamily);
  const edition = normalizeCitationPart(input.edition);
  const logicalRef = normalizeCitationPart(input.logicalRef);

  return `${codeFamily} ${edition}, ${logicalRef}`;
}

export function assertCitedEvidence(evidence: unknown): asserts evidence is BuildingCodeEvidence {
  if (!isRecord(evidence)) {
    throw new Error('Building code evidence must be an object');
  }

  for (const field of requiredEvidenceStringFields) {
    assertNonEmptyString(evidence[field], field);
  }

  assertAllowedValue(evidence.evidenceKind, allowedEvidenceKinds, 'evidenceKind');
  assertStringArray(evidence.applicabilityNotes, 'applicabilityNotes');

  if (!isRecord(evidence.citation)) {
    throw new Error('Building code evidence is missing citation');
  }

  for (const field of requiredCitationStringFields) {
    assertNonEmptyString(evidence.citation[field], `citation.${field}`);
  }

  assertAllowedValue(evidence.citation.status, allowedCitationStatuses, 'citation.status');
  assertAllowedValue(evidence.citation.nodeType, allowedCodeNodeTypes, 'citation.nodeType');
  assertString(evidence.citation.localSourcePath, 'citation.localSourcePath');
  assertFiniteNumber(evidence.citation.extractionConfidence, 'citation.extractionConfidence');
  assertParserProvenance(evidence.citation.parser, 'citation.parser');
  assertStringArray(evidence.citation.headingPath, 'citation.headingPath');

  const expectedDisplayCitation = buildDisplayCitation(evidence.citation as DisplayCitationInput);
  if (evidence.citation.displayCitation !== expectedDisplayCitation) {
    throw new Error('Building code evidence has mismatched citation.displayCitation');
  }
}

export function wrapBuildingCodeEvidenceForModel(evidence: BuildingCodeEvidence[]): string {
  if (!Array.isArray(evidence)) {
    throw new Error('Building code evidence must be an array');
  }
  if (evidence.length === 0) {
    throw new Error(buildUnusableBuildingCodeResultMessage('no cited evidence was provided'));
  }

  const entries = evidence.map((item) => {
    assertCitedEvidence(item);

    return [
      '  <evidence>',
      `    <citation>${escapeXml(item.citation.displayCitation)}</citation>`,
      `    <status>${escapeXml(item.citation.status)}</status>`,
      `    <node_type>${escapeXml(item.citation.nodeType)}</node_type>`,
      `    <logical_ref>${escapeXml(item.citation.logicalRef)}</logical_ref>`,
      `    <page_range>${escapeXml(item.citation.pageRange)}</page_range>`,
      `    <excerpt>${escapeXml(item.excerpt)}</excerpt>`,
      item.applicabilityNotes.length > 0
        ? `    <applicability_notes>${escapeXml(item.applicabilityNotes.join('; '))}</applicability_notes>`
        : undefined,
      '  </evidence>',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  });

  return ['<building_code_evidence>', ...entries, '</building_code_evidence>'].join('\n');
}

export function buildUnusableBuildingCodeResultMessage(reason?: string): string {
  const base = 'unusable: no canonical cited building-code evidence is available';
  const normalizedReason = reason?.trim();

  return normalizedReason ? `${base}. Reason: ${normalizedReason}` : `${base}.`;
}

function normalizeCitationPart(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error('Citation display fields must be non-empty');
  }

  return normalized;
}

function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Building code evidence is missing ${field}`);
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Building code evidence is missing ${field}`);
  }
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Building code evidence is missing ${field}`);
  }
}

function assertAllowedValue<const T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  field: string
): asserts value is T[number] {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    throw new Error(`Building code evidence has invalid ${field}`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Building code evidence is missing ${field}`);
  }
}

function assertParserProvenance(value: unknown, field: string): void {
  if (!isRecord(value)) {
    throw new Error(`Building code evidence is missing ${field}`);
  }

  assertAllowedValue(value.name, allowedParserNames, `${field}.name`);
  assertNonEmptyString(value.version, `${field}.version`);
  assertStringArray(value.sourceElementIds, `${field}.sourceElementIds`);
  assertNonEmptyString(value.pageRange, `${field}.pageRange`);
  assertLayoutBoxes(value.boundingBoxes, `${field}.boundingBoxes`);
}

function assertLayoutBoxes(value: unknown, field: string): asserts value is CodeLayoutBox[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !isRecord(item) ||
        typeof item.pageNumber !== 'number' ||
        typeof item.x !== 'number' ||
        typeof item.y !== 'number' ||
        typeof item.width !== 'number' ||
        typeof item.height !== 'number'
    )
  ) {
    throw new Error(`Building code evidence is missing ${field}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
