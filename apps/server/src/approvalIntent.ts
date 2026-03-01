export type ApprovalIntent = "approve" | "reject" | "revise" | "ambiguous";

export type ApprovalIntentResult = {
  intent: ApprovalIntent;
  confidence: number;
  reason: string;
};

const APPROVE_PATTERNS = [
  /\bapprove\b/i,
  /\blooks good\b/i,
  /\bgo ahead\b/i,
  /\bsend it\b/i,
  /\bdo it\b/i,
  /\bconfirm\b/i,
  /\bthat's perfect\b/i,
  /\byes\b/i,
  /\bok(?:ay)?\b/i,
  /\boui\b/i,
  /\bvas[- ]?y\b/i,
  /\benvoie\b/i
];

const REJECT_PATTERNS = [
  /\breject\b/i,
  /\bcancel\b/i,
  /\babort\b/i,
  /\bdiscard\b/i,
  /\bnever mind\b/i,
  /\bdo not send\b/i,
  /\bdon't send\b/i,
  /\bstop\b/i,
  /\bno\b/i,
  /\bnon\b/i,
  /\bannule\b/i
];

const REVISE_PATTERNS = [
  /\bchange\b/i,
  /\bedit\b/i,
  /\bupdate\b/i,
  /\breplace\b/i,
  /\brewrite\b/i,
  /\badd\b/i,
  /\bremove\b/i,
  /\binstead\b/i,
  /\bmake it\b/i,
  /\bmention\b/i,
  /\btone\b/i,
  /\bshorter\b/i,
  /\blonger\b/i,
  /\bmodifie\b/i,
  /\br[ée][ée]cris?\b/i,
  /\bplus court\b/i,
  /\bplus long\b/i
];

export class ApprovalIntentService {
  detectIntent(text: string): ApprovalIntentResult {
    const normalized = text.trim();
    if (!normalized) {
      return {
        intent: "ambiguous",
        confidence: 0,
        reason: "Empty utterance."
      };
    }

    const approve = APPROVE_PATTERNS.some((pattern) => pattern.test(normalized));
    const reject = REJECT_PATTERNS.some((pattern) => pattern.test(normalized));
    const revise = REVISE_PATTERNS.some((pattern) => pattern.test(normalized));

    if (approve && reject) {
      return {
        intent: "ambiguous",
        confidence: 0.2,
        reason: "Conflicting approve and reject signals."
      };
    }
    if (reject && !revise) {
      return {
        intent: "reject",
        confidence: 0.95,
        reason: "Detected rejection phrase."
      };
    }
    if (approve && !revise) {
      return {
        intent: "approve",
        confidence: 0.9,
        reason: "Detected approval phrase."
      };
    }
    if (revise) {
      return {
        intent: "revise",
        confidence: 0.88,
        reason: "Detected revision language."
      };
    }

    return {
      intent: "ambiguous",
      confidence: 0.35,
      reason: "No explicit approve/reject/revise cue."
    };
  }
}
