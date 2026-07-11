/**
 * ATS scoring (spec section 3):
 *   must-have skills 50% · nice-to-have 20% · experience-years fit 20% ·
 *   location/work-eligibility 10%. Any missing must-have caps the total
 *   at 40. Failed knockouts never reach this module (excluded upstream).
 *
 * Pure and deterministic: no I/O, no randomness, stable ordering — the same
 * inputs always produce the same score and ranking.
 */

import { normalizeSkill } from './fieldExtractor';

const WEIGHTS = {
  mustHave: 50,
  niceToHave: 20,
  experience: 20,
  location: 10,
} as const;

const MISSING_MUST_HAVE_CAP = 40;

export interface ScoreInput {
  extractedSkills: string[];
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  experienceYears: number | null;
  minExperienceYears: number;
  candidateLocation: string | null;
  jobLocation: string;
}

export interface RankedSkill {
  skill: string;
  category: 'MUST_HAVE' | 'NICE_TO_HAVE';
  points: number;
}

export interface ScoreBreakdown {
  mustHave: { weight: number; matched: string[]; missing: string[]; points: number };
  niceToHave: { weight: number; matched: string[]; missing: string[]; points: number };
  experience: {
    weight: number;
    extractedYears: number | null;
    requiredYears: number;
    points: number;
    basis: string;
  };
  location: { weight: number; points: number; basis: string };
  capApplied: boolean;
  total: number;
}

export interface ScoreOutput {
  totalScore: number;
  breakdown: ScoreBreakdown;
  /** Matched skills ordered by score contribution (desc), then name. */
  rankedSkills: RankedSkill[];
}

function partitionSkills(
  required: string[],
  extracted: string[],
): { matched: string[]; missing: string[] } {
  const extractedSet = new Set(extracted.map(normalizeSkill));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of required) {
    (extractedSet.has(normalizeSkill(skill)) ? matched : missing).push(skill);
  }
  return { matched: matched.sort(), missing: missing.sort() };
}

function experiencePoints(
  extractedYears: number | null,
  requiredYears: number,
): { points: number; basis: string } {
  if (requiredYears <= 0) {
    return { points: WEIGHTS.experience, basis: 'No minimum experience required.' };
  }
  if (extractedYears === null) {
    return { points: 0, basis: 'No experience information could be extracted from the CV.' };
  }
  if (extractedYears >= requiredYears) {
    return {
      points: WEIGHTS.experience,
      basis: `${extractedYears} years meets the ${requiredYears}-year minimum.`,
    };
  }
  const points = Math.round((extractedYears / requiredYears) * WEIGHTS.experience);
  return {
    points,
    basis: `${extractedYears} of ${requiredYears} required years (proportional credit).`,
  };
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((token) => token.length > 3),
  );
}

function locationPoints(candidateLocation: string | null, jobLocation: string): { points: number; basis: string } {
  if (/\bremote\b/i.test(jobLocation)) {
    return { points: WEIGHTS.location, basis: 'Job is remote.' };
  }
  if (!candidateLocation) {
    return { points: 0, basis: 'Candidate location unknown for an on-site/hybrid role.' };
  }
  const jobTokens = tokenize(jobLocation);
  const candidateTokens = tokenize(candidateLocation);
  const overlap = [...candidateTokens].some((token) => jobTokens.has(token));
  if (overlap) {
    return { points: WEIGHTS.location, basis: `Candidate location matches ${jobLocation}.` };
  }
  return { points: 0, basis: `Candidate location (${candidateLocation}) does not match ${jobLocation}.` };
}

export function scoreApplication(input: ScoreInput): ScoreOutput {
  const mustHave = partitionSkills(input.mustHaveSkills, input.extractedSkills);
  const niceToHave = partitionSkills(input.niceToHaveSkills, input.extractedSkills);

  const mustHavePoints =
    input.mustHaveSkills.length === 0
      ? WEIGHTS.mustHave
      : Math.round((mustHave.matched.length / input.mustHaveSkills.length) * WEIGHTS.mustHave);

  // A job with no nice-to-have tags has nothing to deduct for.
  const niceToHavePoints =
    input.niceToHaveSkills.length === 0
      ? WEIGHTS.niceToHave
      : Math.round((niceToHave.matched.length / input.niceToHaveSkills.length) * WEIGHTS.niceToHave);

  const experience = experiencePoints(input.experienceYears, input.minExperienceYears);
  const location = locationPoints(input.candidateLocation, input.jobLocation);

  const rawTotal = mustHavePoints + niceToHavePoints + experience.points + location.points;
  const capApplied = mustHave.missing.length > 0 && rawTotal > MISSING_MUST_HAVE_CAP;
  const total = Math.max(0, Math.min(capApplied ? MISSING_MUST_HAVE_CAP : rawTotal, 100));

  const perMustHave =
    input.mustHaveSkills.length > 0 ? WEIGHTS.mustHave / input.mustHaveSkills.length : 0;
  const perNiceToHave =
    input.niceToHaveSkills.length > 0 ? WEIGHTS.niceToHave / input.niceToHaveSkills.length : 0;

  const rankedSkills: RankedSkill[] = [
    ...mustHave.matched.map((skill) => ({
      skill,
      category: 'MUST_HAVE' as const,
      points: Math.round(perMustHave * 10) / 10,
    })),
    ...niceToHave.matched.map((skill) => ({
      skill,
      category: 'NICE_TO_HAVE' as const,
      points: Math.round(perNiceToHave * 10) / 10,
    })),
  ].sort((a, b) => b.points - a.points || a.skill.localeCompare(b.skill));

  return {
    totalScore: total,
    breakdown: {
      mustHave: { weight: WEIGHTS.mustHave, ...mustHave, points: mustHavePoints },
      niceToHave: { weight: WEIGHTS.niceToHave, ...niceToHave, points: niceToHavePoints },
      experience: {
        weight: WEIGHTS.experience,
        extractedYears: input.experienceYears,
        requiredYears: input.minExperienceYears,
        ...experience,
      },
      location: { weight: WEIGHTS.location, ...location },
      capApplied,
      total,
    },
    rankedSkills,
  };
}
