import { ZxcvbnFactory, type OptionsType } from "@zxcvbn-ts/core";
import {
  adjacencyGraphs,
  dictionary as commonDictionary,
} from "@zxcvbn-ts/language-common";
import {
  dictionary as englishDictionary,
  translations,
} from "@zxcvbn-ts/language-en";

/** Master-password floor: zxcvbn score >= 3 (docs/architecture.md §3). */
const options: OptionsType = {
  dictionary: { ...commonDictionary, ...englishDictionary },
  graphs: adjacencyGraphs,
  translations,
};

const zxcvbn = new ZxcvbnFactory(options);

export const MIN_MASTER_PASSWORD_SCORE = 3;

/** Result of assessing a candidate master password. */
export interface PasswordAssessment {
  /** zxcvbn score, 0 (weakest) to 4 (strongest). */
  score: number;
  /** Whether the score meets the configured floor. */
  acceptable: boolean;
  /** Human-readable feedback (warning plus suggestions). */
  feedback: string;
}

/**
 * Assess a candidate master password against the strength floor.
 * @param password - The candidate master password.
 * @returns The score, acceptance flag, and feedback text.
 */
export function assessMasterPassword(password: string): PasswordAssessment {
  const { score, feedback } = zxcvbn.check(password);
  const parts = [feedback.warning, ...feedback.suggestions].filter(
    (part): part is string => Boolean(part),
  );
  return {
    score,
    acceptable: score >= MIN_MASTER_PASSWORD_SCORE,
    feedback: parts.join(" "),
  };
}
