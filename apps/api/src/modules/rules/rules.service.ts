import { Injectable } from "@nestjs/common";

import type { ImportanceRules } from "@mark/contracts";

import type { UpdateImportanceRulesDto } from "./rules.dto";

const DEFAULT_RULES: ImportanceRules = {
  vipSenders: [],
  vipDomains: [],
  keywords: ["urgent", "asap", "deadline", "contract"],
  mutedDomains: []
};

@Injectable()
export class RulesService {
  private readonly rulesByUser = new Map<string, ImportanceRules>();

  getImportanceRules(userId: string): ImportanceRules {
    return this.rulesByUser.get(userId) ?? DEFAULT_RULES;
  }

  updateImportanceRules(userId: string, payload: UpdateImportanceRulesDto): ImportanceRules {
    const current = this.getImportanceRules(userId);
    const merged: ImportanceRules = {
      vipSenders: normalize(payload.vipSenders ?? current.vipSenders),
      vipDomains: normalize(payload.vipDomains ?? current.vipDomains),
      keywords: normalize(payload.keywords ?? current.keywords),
      mutedDomains: normalize(payload.mutedDomains ?? current.mutedDomains)
    };
    this.rulesByUser.set(userId, merged);
    return merged;
  }
}

function normalize(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
