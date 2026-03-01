import { Injectable } from "@nestjs/common";

import type { ImportanceRules, ImportanceScore, MessageDigest } from "@mark/contracts";

@Injectable()
export class ImportanceScoringService {
  score(message: MessageDigest, rules: ImportanceRules): ImportanceScore {
    let score = 0.2;
    const reasons: string[] = [];

    const fromLower = message.from.toLowerCase();
    const domain = message.fromDomain?.toLowerCase() ?? this.extractDomain(message.from);
    const haystack = `${message.subject} ${message.snippet}`.toLowerCase();

    if (rules.vipSenders.some((sender) => fromLower.includes(sender))) {
      score += 0.45;
      reasons.push("Sender in VIP list");
    }

    if (rules.vipDomains.includes(domain)) {
      score += 0.35;
      reasons.push("Domain in VIP domains");
    }

    const keywordHits = rules.keywords.filter((keyword) => haystack.includes(keyword));
    if (keywordHits.length > 0) {
      score += Math.min(0.25, keywordHits.length * 0.1);
      reasons.push(`Contains priority keywords: ${keywordHits.join(", ")}`);
    }

    if (rules.mutedDomains.includes(domain)) {
      score -= 0.5;
      reasons.push("Domain muted by user");
    }

    if (this.looksLikeNewsletter(haystack)) {
      score -= 0.3;
      reasons.push("Likely newsletter/promotional");
    }

    const bounded = Math.max(0, Math.min(score, 1));
    const category = bounded >= 0.6 ? "important" : bounded <= 0.25 ? "bulk" : "normal";

    return {
      messageId: message.id,
      score: Number(bounded.toFixed(2)),
      reasons,
      category
    };
  }

  private extractDomain(email: string): string {
    const pieces = email.toLowerCase().split("@");
    return pieces[1] ?? "";
  }

  private looksLikeNewsletter(text: string): boolean {
    return ["unsubscribe", "newsletter", "promo", "discount", "sale"].some((keyword) =>
      text.includes(keyword)
    );
  }
}
