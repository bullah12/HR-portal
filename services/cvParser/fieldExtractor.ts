/**
 * Deterministic field extraction from raw CV text (spec section 3 fields:
 * contact details, skills, experience, education, location).
 *
 * Pure functions over the text — no network calls, no randomness — so the
 * same CV always yields the same fields (idempotency requirement).
 */

export interface ExtractedFields {
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  experienceYears: number | null;
  education: string[];
  location: string | null;
}

/**
 * Skills recognised in addition to the job's own requirement tags, so
 * extracted profiles stay useful across jobs. Matching is whole-word and
 * case-insensitive; synonyms are folded by normalizeSkill.
 */
const BASE_SKILL_LEXICON = [
  'TypeScript', 'JavaScript', 'Node.js', 'React', 'Next.js', 'NestJS', 'Express',
  'Python', 'Java', 'C#', 'Go', 'Rust', 'PHP', 'SQL', 'PostgreSQL', 'MySQL',
  'MongoDB', 'Redis', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform',
  'CI/CD', 'Git', 'GraphQL', 'REST APIs', 'HTML', 'CSS', 'Tailwind', 'Prisma',
  'Jest', 'Playwright', 'Cypress', 'Storybook', 'Testing Library', 'SQS',
  'Agile', 'Scrum', 'Excel', 'HR administration', 'German labour law',
  'Personio', 'DocuSign',
];

const SKILL_SYNONYMS: Record<string, string> = {
  node: 'node.js',
  nodejs: 'node.js',
  postgres: 'postgresql',
  reactjs: 'react',
  'react.js': 'react',
  nextjs: 'next.js',
  golang: 'go',
  k8s: 'kubernetes',
  'rest api': 'rest apis',
  rest: 'rest apis',
  tailwindcss: 'tailwind',
};

/** Canonical lowercase form used for skill comparison. */
export function normalizeSkill(skill: string): string {
  const normalized = skill.trim().toLowerCase().replace(/\s+/g, ' ');
  return SKILL_SYNONYMS[normalized] ?? normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive presence check for one skill (or synonym). */
function skillPresent(text: string, skill: string): boolean {
  const canonical = normalizeSkill(skill);
  const variants = new Set<string>([skill.toLowerCase(), canonical]);
  for (const [synonym, target] of Object.entries(SKILL_SYNONYMS)) {
    if (target === canonical) variants.add(synonym);
  }
  return [...variants].some((variant) => {
    const pattern = new RegExp(`(^|[^a-z0-9+#.])${escapeRegExp(variant)}($|[^a-z0-9+#])`, 'i');
    return pattern.test(text);
  });
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(\+?\d[\d\s().\/-]{7,}\d)/;

const NAME_STOPWORDS =
  /\b(curriculum|vitae|resume|cv|profile|contact|email|phone|address|summary|experience|education|skills)\b/i;

function extractName(lines: string[]): string | null {
  for (const line of lines.slice(0, 10)) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (NAME_STOPWORDS.test(line)) continue;
    if (/[\d@\/:]/.test(line)) continue;
    const allCapitalized = words.every((word) => /^[A-ZÀ-Þ][\p{L}'’.-]*$/u.test(word));
    if (allCapitalized) return line.trim();
  }
  return null;
}

function extractEducation(lines: string[]): string[] {
  const pattern =
    /\b(bsc|msc|beng|meng|mba|phd|ba|ma|bachelor|master|doctorate|diploma|university|college|institute|hochschule)\b/i;
  const matches: string[] = [];
  for (const line of lines) {
    if (pattern.test(line) && line.length <= 160) {
      matches.push(line.trim());
      if (matches.length >= 10) break;
    }
  }
  return matches;
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Experience in years: the larger of (a) explicit "N years" statements and
 * (b) the merged span of employment date ranges like "2019 – 2023" or
 * "2021 - present". Capped at 40.
 */
function extractExperienceYears(text: string): number | null {
  const candidates: number[] = [];

  const explicit = text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi);
  for (const match of explicit) {
    candidates.push(Number(match[1]));
  }

  const intervals: Array<[number, number]> = [];
  const ranges = text.matchAll(/\b(19\d{2}|20\d{2})\s*[–—-]\s*(19\d{2}|20\d{2}|present|current|now|today)\b/gi);
  for (const match of ranges) {
    const start = Number(match[1]);
    const end = /^\d{4}$/.test(match[2]) ? Number(match[2]) : CURRENT_YEAR;
    if (end >= start && start >= 1950 && end <= CURRENT_YEAR + 1) {
      intervals.push([start, end]);
    }
  }
  if (intervals.length > 0) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [currentStart, currentEnd] = intervals[0];
    for (const [start, end] of intervals.slice(1)) {
      if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end);
      } else {
        total += currentEnd - currentStart;
        [currentStart, currentEnd] = [start, end];
      }
    }
    total += currentEnd - currentStart;
    candidates.push(total);
  }

  if (candidates.length === 0) return null;
  return Math.min(Math.max(...candidates), 40);
}

function extractLocation(lines: string[]): string | null {
  for (const line of lines) {
    const labelled = line.match(/^\s*location\s*[:\-]\s*(.+)$/i);
    if (labelled) return labelled[1].trim();
  }
  // Fallback: a "City, Country" shaped line near the top of the CV.
  for (const line of lines.slice(0, 12)) {
    const cityCountry = line.match(/^([A-ZÀ-Þ][\p{L} .'-]{2,30}),\s*([A-ZÀ-Þ][\p{L} .'-]{2,30})$/u);
    if (cityCountry && !NAME_STOPWORDS.test(line)) return line.trim();
  }
  return null;
}

/**
 * Extracts all spec section 3 fields. `jobSkills` (the job's requirement
 * tags) are matched in addition to the base lexicon so scoring never misses
 * a tag that the lexicon doesn't know about.
 */
export function extractFields(text: string, jobSkills: string[]): ExtractedFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const skillCatalogue = new Map<string, string>();
  for (const skill of [...BASE_SKILL_LEXICON, ...jobSkills]) {
    const canonical = normalizeSkill(skill);
    if (!skillCatalogue.has(canonical)) skillCatalogue.set(canonical, skill);
  }

  const skills = [...skillCatalogue.values()]
    .filter((skill) => skillPresent(text, skill))
    .sort((a, b) => a.localeCompare(b));

  return {
    name: extractName(lines),
    email: text.match(EMAIL_PATTERN)?.[0] ?? null,
    phone: text.match(PHONE_PATTERN)?.[0]?.trim() ?? null,
    skills,
    experienceYears: extractExperienceYears(text),
    education: extractEducation(lines),
    location: extractLocation(lines),
  };
}
