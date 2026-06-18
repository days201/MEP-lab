import type { BuildingCodeEvidence, CodeCitation } from './types';

type DisplayCitationInput = Pick<CodeCitation, 'codeFamily' | 'edition' | 'logicalRef'>;

const requiredEvidenceStringFields = ['evidenceId', 'nodeId', 'evidenceKind', 'excerpt'] as const;
const requiredCitationStringFields = [
  'status',
  'citationId',
  'sourceId',
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

  if (!Array.isArray(evidence.applicabilityNotes)) {
    throw new Error('Building code evidence is missing applicabilityNotes');
  }

  if (!isRecord(evidence.citation)) {
    throw new Error('Building code evidence is missing citation');
  }

  for (const field of requiredCitationStringFields) {
    assertNonEmptyString(evidence.citation[field], `citation.${field}`);
  }

  if (!Array.isArray(evidence.citation.headingPath)) {
    throw new Error('Building code evidence is missing citation.headingPath');
  }
}

export function wrapBuildingCodeEvidenceForModel(evidence: BuildingCodeEvidence[]): string {
  if (!Array.isArray(evidence)) {
    throw new Error('Building code evidence must be an array');
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
