import { describe, expect, it } from 'vitest';
import { scoreApplication, type ScoreInput } from '@/services/cvParser/atsScorer';

const BASE_INPUT: ScoreInput = {
  extractedSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'React'],
  mustHaveSkills: ['TypeScript', 'Node.js'],
  niceToHaveSkills: ['React', 'Docker'],
  experienceYears: 6,
  minExperienceYears: 4,
  candidateLocation: 'Berlin, Germany',
  jobLocation: 'Berlin, Germany (hybrid)',
};

describe('ATS scorer', () => {
  it('applies the documented weights (50/20/20/10) for a full match', () => {
    const result = scoreApplication({
      ...BASE_INPUT,
      extractedSkills: ['TypeScript', 'Node.js', 'React', 'Docker'],
    });
    expect(result.breakdown.mustHave.points).toBe(50);
    expect(result.breakdown.niceToHave.points).toBe(20);
    expect(result.breakdown.experience.points).toBe(20);
    expect(result.breakdown.location.points).toBe(10);
    expect(result.totalScore).toBe(100);
    expect(result.breakdown.capApplied).toBe(false);
  });

  it('gives proportional credit for partial matches', () => {
    const result = scoreApplication(BASE_INPUT); // 2/2 must, 1/2 nice
    expect(result.breakdown.mustHave.points).toBe(50);
    expect(result.breakdown.niceToHave.points).toBe(10);
    expect(result.totalScore).toBe(90);
  });

  it('caps the total at 40 when any must-have is missing', () => {
    const result = scoreApplication({
      ...BASE_INPUT,
      extractedSkills: ['TypeScript', 'React', 'Docker'], // Node.js missing
    });
    expect(result.breakdown.mustHave.missing).toEqual(['Node.js']);
    expect(result.breakdown.capApplied).toBe(true);
    expect(result.totalScore).toBe(40);
  });

  it('does not flag the cap when the raw total is already at or below 40', () => {
    const result = scoreApplication({
      ...BASE_INPUT,
      extractedSkills: [],
      experienceYears: null,
      candidateLocation: null,
    });
    expect(result.totalScore).toBeLessThanOrEqual(40);
    expect(result.breakdown.capApplied).toBe(false);
  });

  it('is deterministic: identical input yields an identical result object', () => {
    const first = scoreApplication(BASE_INPUT);
    const second = scoreApplication(BASE_INPUT);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('matches skills case-insensitively and through synonyms', () => {
    const result = scoreApplication({
      ...BASE_INPUT,
      extractedSkills: ['typescript', 'nodejs'],
      niceToHaveSkills: [],
    });
    expect(result.breakdown.mustHave.matched).toEqual(['Node.js', 'TypeScript']);
    expect(result.breakdown.mustHave.points).toBe(50);
  });

  it('gives proportional experience credit below the minimum', () => {
    const result = scoreApplication({ ...BASE_INPUT, experienceYears: 2, minExperienceYears: 4 });
    expect(result.breakdown.experience.points).toBe(10);
  });

  it('awards full experience points when no minimum is required', () => {
    const result = scoreApplication({ ...BASE_INPUT, experienceYears: null, minExperienceYears: 0 });
    expect(result.breakdown.experience.points).toBe(20);
  });

  it('awards location points for remote jobs regardless of candidate location', () => {
    const result = scoreApplication({ ...BASE_INPUT, candidateLocation: null, jobLocation: 'Remote (EU)' });
    expect(result.breakdown.location.points).toBe(10);
  });

  it('ranks matched skills by contribution, ties broken by name', () => {
    const result = scoreApplication({
      ...BASE_INPUT,
      extractedSkills: ['TypeScript', 'Node.js', 'React', 'Docker'],
    });
    expect(result.rankedSkills.map((entry) => entry.skill)).toEqual([
      'Node.js',
      'TypeScript',
      'Docker',
      'React',
    ]);
    expect(result.rankedSkills[0].category).toBe('MUST_HAVE');
  });
});
