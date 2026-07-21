import { describe, expect, it } from 'vitest';
import { extractFields, normalizeSkill } from '@/services/cvParser/fieldExtractor';

const SAMPLE_CV = `
Maria Duarte
Lisbon, Portugal
maria.duarte@mail.example
+351 912 345 678

Summary
Backend engineer with 7 years experience building services with nodejs,
TypeScript and Postgres. Comfortable with Docker and k8s.

Experience
Senior Engineer, Fintech Lda — 2019 - present
Engineer, WebShop SA — 2015 – 2019

Education
BSc Computer Science, University of Lisbon
`;

describe('field extractor', () => {
  it('extracts skills through the lexicon and synonyms', () => {
    const fields = extractFields(SAMPLE_CV, []);
    expect(fields.skills).toContain('TypeScript');
    expect(fields.skills).toContain('Node.js'); // via "nodejs"
    expect(fields.skills).toContain('PostgreSQL'); // via "Postgres"
    expect(fields.skills).toContain('Kubernetes'); // via "k8s"
    expect(fields.skills).toContain('Docker');
  });

  it('matches whole words only — no substring false positives', () => {
    const fields = extractFields('Expert in Javascripting frameworks and going fast', []);
    expect(fields.skills).not.toContain('JavaScript');
    expect(fields.skills).not.toContain('Go');
  });

  it('includes job requirement tags unknown to the base lexicon', () => {
    const fields = extractFields('Deep knowledge of Anaplan modelling.', ['Anaplan']);
    expect(fields.skills).toContain('Anaplan');
  });

  it('extracts experience years from explicit statements and date ranges', () => {
    const fields = extractFields(SAMPLE_CV, []);
    // Explicit "7 years"; overlapping ranges 2015–2019 and 2019–present merge
    // to a span >= 7 — the extractor takes the larger candidate.
    expect(fields.experienceYears).toBeGreaterThanOrEqual(7);
  });

  it('merges overlapping employment ranges instead of double counting', () => {
    const fields = extractFields('Role A 2018 - 2022\nRole B 2020 - 2022', []);
    expect(fields.experienceYears).toBe(4);
  });

  it('returns null experience when nothing is stated', () => {
    const fields = extractFields('A CV with no dates or tenure information.', []);
    expect(fields.experienceYears).toBeNull();
  });

  it('extracts contact details, name, education, and location', () => {
    const fields = extractFields(SAMPLE_CV, []);
    expect(fields.name).toBe('Maria Duarte');
    expect(fields.email).toBe('maria.duarte@mail.example');
    expect(fields.phone).toContain('+351');
    expect(fields.education.some((line) => line.includes('BSc Computer Science'))).toBe(true);
    expect(fields.location).toBe('Lisbon, Portugal');
  });

  it('is deterministic over the same text', () => {
    expect(extractFields(SAMPLE_CV, [])).toEqual(extractFields(SAMPLE_CV, []));
  });
});

describe('normalizeSkill', () => {
  it('lowercases, collapses whitespace, and folds synonyms', () => {
    expect(normalizeSkill('  Node ')).toBe('node.js');
    expect(normalizeSkill('REST  API')).toBe('rest apis');
    expect(normalizeSkill('TypeScript')).toBe('typescript');
  });
});
