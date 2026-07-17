import type { TasteIntent } from "../../domain/recommendation.ts";
import type { BrothBase, BrothStyle, RamenType } from "../../domain/ramen.ts";

export interface PreferenceSelections {
  ramenTypes?: readonly RamenType[];
  brothStyles?: readonly BrothStyle[];
  brothBases?: readonly BrothBase[];
  bodyTarget?: number | null;
  spicinessTarget?: number | null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function append<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function remove<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isExplicitlyExcluded(text: string, term: RegExp): boolean {
  const pattern = new RegExp(
    `(?:${term.source})(?:은|는|이|가|을|를|도)?\\s*(?:말고|싫(?!지|진)|별로|빼|제외|없이|안\\s*(?:먹|원)|원하지\\s*않|아닌)`,
    term.ignoreCase ? "i" : "",
  );
  return pattern.test(text);
}

const richAcceptancePatterns = [
  /느끼한\s*(?:건|것(?:도)?)?\s*안\s*싫/,
  /느끼(?:해도|해도\s*난?)\s*괜찮/,
  /느끼하지\s*않아도\s*(?:돼|괜찮)/,
] as const;

const spicyExclusionPatterns = [
  /안\s*매운/,
  /맵지\s*않/,
  /매운\s*(?:건|거|것|맛)?\s*(?:싫|못|별로|부담|말고|빼|제외|없이|안\s*(?:좋|먹|원))/,
  /매운.*(?:못\s*먹|안\s*먹)/,
  /맵찔/,
  /순한\s*(?:맛|걸|거)/,
] as const;

function explicitStyles(text: string): BrothStyle[] | null {
  const chintanTerm = /(?:청탕|친탄|치탄|chintan)/i;
  const paitanTerm = /(?:백탕|파이탄|빠이탄|paitan)/i;
  const dippingTerm = /(?:츠케멘|츠케|찍어\s*먹)/;
  const dryTerm = /(?:마제소바|마제|비벼\s*먹)/;
  const mentionsBoth = chintanTerm.test(text) && paitanTerm.test(text);
  if (mentionsBoth && /(?:상관\s*없|아무거나|둘\s*다|어느\s*쪽이든)/.test(text)) {
    return [];
  }

  const avoidsChintan = isExplicitlyExcluded(text, chintanTerm);
  const avoidsPaitan = isExplicitlyExcluded(text, paitanTerm);

  const styles: BrothStyle[] = [];
  if (chintanTerm.test(text) && !avoidsChintan) append(styles, "chintan");
  if (paitanTerm.test(text) && !avoidsPaitan) append(styles, "paitan");
  if (dippingTerm.test(text) && !isExplicitlyExcluded(text, dippingTerm)) append(styles, "dipping");
  if (dryTerm.test(text) && !isExplicitlyExcluded(text, dryTerm)) append(styles, "dry");
  const hasExplicitStyle = chintanTerm.test(text) || paitanTerm.test(text)
    || dippingTerm.test(text) || dryTerm.test(text);
  return hasExplicitStyle ? styles : null;
}

export function parseTasteIntent(text: string, selections: PreferenceSelections): TasteIntent {
  const normalized = text.trim();
  const intent: TasteIntent = {
    ramenTypes: unique(selections.ramenTypes ?? []),
    brothStyles: unique(selections.brothStyles ?? []),
    brothBases: unique(selections.brothBases ?? []),
    bodyTarget: selections.bodyTarget ?? null,
    spicinessTarget: selections.spicinessTarget ?? null,
    avoidRich: false,
    avoidSpicy: false,
    wantsKarai: false,
    freeText: normalized,
  };

  // 1. Explicit exclusions are established before any positive inference.
  const rejectsMildFood = /(?:안\s*매운|맵지\s*않은|순한).{0,10}(?:싫|별로|말고|빼|제외)/.test(normalized);
  const acceptsSpicyFood = /매운.{0,10}싫(?:지|진)\s*않/.test(normalized);
  intent.avoidSpicy = !rejectsMildFood && !acceptsSpicyFood && hasAny(normalized, spicyExclusionPatterns);
  if (intent.avoidSpicy) intent.spicinessTarget = 0;

  const acceptsRichness = hasAny(normalized, richAcceptancePatterns);
  intent.avoidRich = !acceptsRichness && (
    /느끼하지\s*않은/.test(normalized)
    || /안\s*느끼/.test(normalized)
    || /느끼(?:한|함|해서|하니까)?.*(?:싫|말고|빼|제외)/.test(normalized)
  );

  // 2. Positive words are recognized only after their negated forms are known.
  const styles = explicitStyles(normalized);
  if (styles !== null) intent.brothStyles = styles;

  const typePatterns: ReadonlyArray<readonly [RamenType, RegExp]> = [
    ["shoyu", /(?:쇼유|간장)/],
    ["shio", /(?:시오|소금(?:맛|라멘|베이스)?)/],
    ["miso", /(?:미소|된장)/],
    ["tonkotsu", /(?:돈코츠|돼지뼈)/],
    ["tsukemen", /(?:츠케멘|츠케|찍어\s*먹)/],
    ["mazesoba", /(?:마제소바|마제|비벼\s*먹)/],
  ];
  for (const [type, pattern] of typePatterns) {
    if (isExplicitlyExcluded(normalized, pattern)) {
      remove(intent.ramenTypes, type);
      continue;
    }
    if (pattern.test(normalized)) append(intent.ramenTypes, type);
  }

  const basePatterns: ReadonlyArray<readonly [BrothBase, RegExp]> = [
    ["닭", /(?:닭|치킨)/],
    ["돼지", /(?:돼지|돈골)/],
    ["소", /(?:소고기|쇠고기|우골)/],
    ["해산물", /(?:해산물|어패류|멸치|가쓰오|새우|조개)/],
    ["채소", /(?:채소|야채)/],
  ];
  for (const [base, pattern] of basePatterns) {
    if (isExplicitlyExcluded(normalized, pattern)) {
      remove(intent.brothBases, base);
      continue;
    }
    if (pattern.test(normalized)) append(intent.brothBases, base);
  }

  if (!intent.avoidSpicy && (rejectsMildFood || /(?:카라이|매운|매콤|얼큰|칼칼)/.test(normalized))) {
    intent.spicinessTarget = 4;
    intent.wantsKarai = /카라이/.test(normalized);
  }

  // 3. Descriptive language fills gaps but never overwrites explicit soup styles.
  const soupStyleIsExplicit = styles?.some((style) => style === "chintan" || style === "paitan") ?? false;
  const dryOrDipping = intent.brothStyles.some((style) => style === "dry" || style === "dipping");
  if (intent.avoidRich) {
    intent.bodyTarget = 2;
    if (!soupStyleIsExplicit && !dryOrDipping) intent.brothStyles = ["chintan"];
  }
  if (/(?:담백|깔끔|맑은)/.test(normalized)) {
    intent.bodyTarget = 2;
    if (!soupStyleIsExplicit && !dryOrDipping && /(?:간장|쇼유)/.test(normalized)) {
      intent.brothStyles = ["chintan"];
    }
  } else if (/(?:진한|꾸덕|크리미|농후)/.test(normalized)) {
    intent.bodyTarget = 4;
  }

  // 4. Mood is the weakest inference and cannot undo a spicy exclusion.
  const moodClauses = normalized
    .replace(
      /((?:화(?:가|는)?\s*(?:안\s*)?(?:났|나)|짜증(?:은|이)?\s*(?:안\s*)?나|열\s*(?:안\s*)?받|스트레스(?:는|를|가)?\s*(?:(?:안\s*)?(?:받았|받)|받지\s*않았)))고(?=\s)/g,
      "$1고\u0000",
    )
    .split(/[,.;!?\u0000]|(?:지만|는데|으나|반면)/)
    .map((clause) => clause.trim());
  const moodInference = moodClauses.some((clause) => {
    const stressMood = /스트레스/.test(clause) && !/스트레스.{0,8}(?:안\s*받|받지\s*않|없)/.test(clause);
    const angerMood = /(?:화가?\s*(?:나|났)|화났|짜증|열\s*받|열받)/.test(clause)
      && !/(?:화가?|화는?).{0,3}안\s*(?:나|났)|짜증.{0,3}안\s*나|열\s*안\s*받/.test(clause);
    return stressMood || angerMood;
  });
  if (!intent.avoidSpicy && moodInference) {
    intent.wantsKarai = true;
    intent.spicinessTarget = 4;
  }

  return intent;
}
