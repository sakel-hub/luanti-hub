// Automated Content Safety Scanner + Optional Cloudflare Workers AI Moderation Guard
// Designed specifically for Luanti (Minetest) Git repositories with multi-layer false-positive prevention.

export type ContentSafetyCategory =
  | 'sexual_nsfw'
  | 'extreme_gore_violence'
  | 'hate_speech'
  | 'self_harm';

export interface ContentSafetyMatch {
  category: ContentSafetyCategory;
  term: string;
  file: string;
  line?: number;
  snippet?: string;
  source: 'static' | 'workers_ai';
}

export interface ContentSafetyEvaluation {
  holdForAdminReview: boolean;
  categories: ContentSafetyCategory[];
  matches: ContentSafetyMatch[];
  autoContentWarnings: string[];
  aiChecked: boolean;
  aiFallbackUsed: boolean;
  summary: string;
}

export interface ContentSafetyInput {
  repoOwner: string;
  repoName: string;
  confFileName: string;
  rawConfig: string;
  title: string;
  shortDesc: string;
  cdbJsonText?: string;
  readmeMarkdown?: string;
  luaSource?: string;
  rootFileNames?: string[];
}

/**
 * Layer 2: Luanti Engine & Gaming Domain Safe-List (Compound Phrases).
 * Normalized to lowercase snake_case before token scanning so benign game/botany/mining/engine
 * compounds never trigger false positives.
 */
const BENIGN_COMPOUND_ALLOWLIST: RegExp[] = [
  // Luanti Engine API callbacks, damage groups & commands
  /\bon[_\-\s]?dieplayer\b/gi,
  /\bon[_\-\s]?punchplayer\b/gi,
  /\bon[_\-\s]?respawnplayer\b/gi,
  /\bfull[_\-\s]?punch[_\-\s]?interval\b/gi,
  /\bdamage[_\-\s]?groups\b/gi,
  /\bkill[_\-\s]?command\b/gi,
  /\bkillme\b/gi,
  // Botany, geology, astronomy & fantasy RPG compounds containing "blood"
  /\bblood[_\-\s]?moon\b/gi,
  /\bblood[_\-\s]?stone\b/gi,
  /\bblood[_\-\s]?wood\b/gi,
  /\bblood[_\-\s]?orange\b/gi,
  /\bblood[_\-\s]?magic\b/gi,
  /\bblood[_\-\s]?altar\b/gi,
  /\bblood[_\-\s]?orb\b/gi,
  /\bblood[_\-\s]?rune\b/gi,
  /\bblood[_\-\s]?thorn\b/gi,
  /\bblood[_\-\s]?leaf\b/gi,
  /\bblood[_\-\s]?flower\b/gi,
  /\bblood[_\-\s]?diamond\b/gi,
  /\bblood[_\-\s]?ruby\b/gi,
  /\bblood[_\-\s]?crystal\b/gi,
  /\bblood[_\-\s]?ingot\b/gi,
  /\bblood[_\-\s]?ore\b/gi,
  /\bdragons?[_\-\s]?blood\b/gi,
  /\bfirst[_\-\s]?blood\b/gi,
  // Mining, woodcutting, farming & metallurgy compounds
  /\bstrip[_\-\s]?min(?:e|ing|er)\b/gi,
  /\bstripped[_\-\s]+[a-z0-9]+\b/gi,
  /\bwood[_\-\s]?strip\b/gi,
  /\bbark[_\-\s]?strip\b/gi,
  /\b(?:default|farming|mcl\s+farming|x\s+farming)\s+hoe(?:\s+[a-z0-9]+)?\b/gi,
  /\bhoe[_\-\s]?(?:wood|stone|steel|bronze|mese|diamond|gold|iron|netherite|copper)\b/gi,
  /\b(?:wood|stone|steel|bronze|mese|diamond|gold|iron|netherite|copper)[_\-\s]?hoe\b/gi,
  /\bflower[_\-\s]?pot\b/gi,
  /\bcooking[_\-\s]?pot\b/gi,
  /\bplant[_\-\s]?pot\b/gi,
  /\bclay[_\-\s]?pot\b/gi,
  /\btea[_\-\s]?pot\b/gi,
  /\bsea[_\-\s]?weed\b/gi,
  /\b(?:coal|iron|copper|metal|furnace)[_\-\s]?slag\b/gi,
  /\bcracked[_\-\s]+[a-z0-9]+\b/gi,
  /\bnaked[_\-\s]?mole[_\-\s]?rat\b/gi,
  /\bhomo[_\-\s]?sapiens\b/gi
];

/**
 * Tier A: High-Confidence Violation Rules (`holdForAdminReview = true`).
 * Uses strict word/token boundaries (`\b`) so substrings inside normal words (e.g. "assassin",
 * "cockpit", "scrap", "title", "cumulus", "therapist", "basement") NEVER match.
 */
const TIER_A_RULES: Array<{
  category: ContentSafetyCategory;
  label: string;
  pattern: RegExp;
}> = [
  {
    category: 'sexual_nsfw',
    label: 'Explicit Sexual / NSFW Content',
    pattern: new RegExp(
      '\\b(' +
        [
          'nsfw',
          'porn',
          'pornography',
          'pornographic',
          'hentai',
          'erotic',
          'erotica',
          'xxx',
          'nude_skin',
          'nude_skins',
          'nude_player',
          'nudity',
          'sex_mod',
          'sex_animation',
          'sexual_intercourse',
          'brothel',
          'prostitute',
          'prostitution',
          'dildo',
          'vibrator',
          'bdsm',
          'fetish',
          'genitals',
          'genitalia',
          'penis',
          'vagina',
          'vulva',
          'clitoris',
          'testicles',
          'blowjob',
          'handjob',
          'cumshot',
          'orgasm',
          'masturbate',
          'masturbation',
          'rape',
          'rapist',
          'molest',
          'molestation',
          'incest',
          'lolicon',
          'shotacon',
          'pedophile',
          'pedophilia',
          'csam',
          'bestiality',
          'zoophilia',
          'necrophilia'
        ].map(t => t.replace(/_/g, '[\\s_]+')).join('|') +
        ')\\b',
      'i'
    )
  },
  {
    category: 'extreme_gore_violence',
    label: 'Extreme Gore, Mutilation or Sadistic Violence',
    pattern: new RegExp(
      '\\b(' +
        [
          'dismember',
          'dismembered',
          'dismemberment',
          'decapitate',
          'decapitated',
          'decapitation',
          'behead',
          'beheaded',
          'beheading',
          'disembowel',
          'disemboweled',
          'disembowelment',
          'eviscerate',
          'evisceration',
          'mutilate',
          'mutilated',
          'mutilation',
          'gore_mod',
          'brutal_gore',
          'extreme_gore',
          'torture_chamber',
          'waterboard',
          'waterboarding',
          'crucify',
          'crucifixion',
          'lynch',
          'lynching',
          'school_shooter',
          'school_shooting',
          'mass_shooting',
          'mass_murder',
          'ethnic_cleansing',
          'genocide',
          'terrorist_attack',
          'suicide_bomber',
          'snuff_film'
        ].map(t => t.replace(/_/g, '[\\s_]+')).join('|') +
        ')\\b',
      'i'
    )
  },
  {
    category: 'self_harm',
    label: 'Self-Harm or Suicide Promotion',
    pattern: new RegExp(
      '\\b(' +
        [
          'self_harm',
          'selfharm',
          'cut_wrists',
          'slit_wrists',
          'kill_yourself',
          'suicide_mod',
          'commit_suicide'
        ].map(t => t.replace(/_/g, '[\\s_]+')).join('|') +
        ')\\b',
      'i'
    )
  },
  {
    category: 'hate_speech',
    label: 'Hate Speech, Extremism or Slurs',
    pattern: new RegExp(
      '\\b(' +
        [
          'nazi',
          'nazis',
          'nazism',
          'hitler',
          'heil_hitler',
          'sieg_heil',
          'swastika',
          'waffen_ss',
          'ku_klux_klan',
          'white_power',
          'white_supremacy',
          'white_supremacist',
          'nigger',
          'nigga',
          'kike',
          'faggot',
          'tranny'
        ].map(t => t.replace(/_/g, '[\\s_]+')).join('|') +
        ')\\b',
      'i'
    )
  }
];

/**
 * Tier B: Advisory Content Warnings (`holdForAdminReview = false`).
 * Standard thematic elements in games (e.g. blood effects, corpses, alcohol/beer, casino games)
 * do NOT block the package; instead they auto-populate ContentDB-compatible `content_warnings`.
 */
const TIER_B_WARNING_RULES: Array<{
  warningTag: 'violence_and_gore' | 'drugs_and_alcohol' | 'gambling';
  pattern: RegExp;
}> = [
  {
    warningTag: 'violence_and_gore',
    pattern: /\b(blood|bleeding|bloody|gore|gory|corpse|cadaver|headshot|gib|gibs)\b/i
  },
  {
    warningTag: 'drugs_and_alcohol',
    pattern: /\b(alcohol|beer|wine|vodka|whiskey|rum|drunk|intoxicated|tobacco|cigarette|cigar|cannabis|marijuana|cocaine|heroin)\b/i
  },
  {
    warningTag: 'gambling',
    pattern: /\b(casino|roulette|slot[_\s]+machine|blackjack|poker[_\s]+bet|lootbox[_\s]+gambling)\b/i
  }
];

function normalizeForTokenScan(rawLine: string): string {
  // 1. Split camelCase and convert identifier punctuation (_, -, ., /, :) into spaces first
  // so every token boundary is a true \b word boundary before stripping safe compounds.
  let spaced = rawLine
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./:]+/g, ' ');
  for (const allowRegex of BENIGN_COMPOUND_ALLOWLIST) {
    spaced = spaced.replace(allowRegex, ' ');
  }
  const snake = spaced.trim().replace(/\s+/g, '_');
  return `${spaced} ${snake}`;
}

function scanTextSource(
  fileLabel: string,
  text: string | undefined,
  matches: ContentSafetyMatch[],
  advisoryWarnings: Set<string>,
  seenKeys: Set<string>
): void {
  if (!text || !text.trim()) return;
  const lines = text.slice(0, 64000).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine || !rawLine.trim()) continue;
    const scanLine = normalizeForTokenScan(rawLine);

    for (const rule of TIER_A_RULES) {
      const m = rule.pattern.exec(scanLine);
      if (m && m[1]) {
        const matchedTerm = m[1].toLowerCase();
        const dedupeKey = `${rule.category}::${fileLabel}::${matchedTerm}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          matches.push({
            category: rule.category,
            term: matchedTerm,
            file: fileLabel,
            line: i + 1,
            snippet: rawLine.trim().slice(0, 140),
            source: 'static'
          });
        }
      }
    }

    for (const wRule of TIER_B_WARNING_RULES) {
      if (wRule.pattern.test(scanLine)) {
        advisoryWarnings.add(wRule.warningTag);
      }
    }
  }
}

/**
 * Deterministic 3-Layer Content Safety Evaluation (0 Quota, runs in <2ms on Worker CPU).
 */
export function evaluateRepositoryContentSafetyStatic(
  input: ContentSafetyInput
): ContentSafetyEvaluation {
  const matches: ContentSafetyMatch[] = [];
  const advisoryWarnings = new Set<string>();
  const seenKeys = new Set<string>();

  scanTextSource(
    input.confFileName || 'mod.conf',
    `${input.title}\n${input.shortDesc}\n${input.rawConfig}`,
    matches,
    advisoryWarnings,
    seenKeys
  );

  if (input.cdbJsonText) {
    scanTextSource('.cdb.json', input.cdbJsonText, matches, advisoryWarnings, seenKeys);
  }

  if (input.readmeMarkdown) {
    scanTextSource('README.md', input.readmeMarkdown, matches, advisoryWarnings, seenKeys);
  }

  if (input.luaSource) {
    scanTextSource('init.lua', input.luaSource, matches, advisoryWarnings, seenKeys);
  }

  if (Array.isArray(input.rootFileNames) && input.rootFileNames.length > 0) {
    scanTextSource(
      'Repository Files',
      input.rootFileNames.join('\n'),
      matches,
      advisoryWarnings,
      seenKeys
    );
  }

  const categories = Array.from(new Set(matches.map(m => m.category)));
  const holdForAdminReview = matches.length > 0;
  const autoContentWarnings = Array.from(advisoryWarnings);

  const summary = holdForAdminReview
    ? `Detected ${categories.join(', ')} (${matches
        .slice(0, 4)
        .map(m => `"${m.term}" in ${m.file}${m.line ? ':' + m.line : ''}`)
        .join('; ')})`
    : 'Passed automated content safety checks.';

  return {
    holdForAdminReview,
    categories,
    matches,
    autoContentWarnings,
    aiChecked: false,
    aiFallbackUsed: false,
    summary
  };
}

/**
 * Layer 4: Optional Cloudflare Workers AI (`env.AI`) Moderation Check.
 * Invoked ONLY when `dryRun === false` (when the author actually clicks Publish) AND only if
 * the deterministic scanner did not already flag the repository, preserving the 10,000 free
 * daily Neurons. Automatically falls back to the static evaluation if `env.AI` is unbound,
 * times out, or reaches the free-tier daily quota.
 */
export async function evaluateRepositoryContentSafety(
  input: ContentSafetyInput,
  options?: { aiBinding?: any; runAiCheck?: boolean }
): Promise<ContentSafetyEvaluation> {
  const staticEval = evaluateRepositoryContentSafetyStatic(input);

  // If static evaluation already flagged a high-confidence violation, or if this is only a dryRun
  // preview (`runAiCheck !== true`), return immediately using 0 Workers AI Neurons!
  if (staticEval.holdForAdminReview || !options?.runAiCheck) {
    return staticEval;
  }

  const ai = options?.aiBinding;
  if (!ai || typeof ai.run !== 'function') {
    return {
      ...staticEval,
      aiChecked: false,
      aiFallbackUsed: true
    };
  }

  const readmeExcerpt = (input.readmeMarkdown || '').slice(0, 1800);
  const luaExcerpt = (input.luaSource || '').slice(0, 1000);
  const combinedText = [
    `Package: ${input.repoOwner}/${input.repoName}`,
    `Title: ${input.title}`,
    `Description: ${input.shortDesc}`,
    readmeExcerpt ? `README:\n${readmeExcerpt}` : '',
    luaExcerpt ? `Lua Snippet:\n${luaExcerpt}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const runWithTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Workers AI timeout')), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // Primary Model: Meta Llama Guard 3 8B (purpose-built content safety classifier on Cloudflare Workers AI)
    const aiRes: any = await runWithTimeout(
      ai.run('@cf/meta/llama-guard-3-8b', {
        messages: [
          {
            role: 'user',
            content:
              `[Context: Luanti (Minetest) open-source voxel game mod repository metadata. ` +
              `Standard fantasy/voxel game combat, swords, monsters, zombies, mining, and farming are SAFE. ` +
              `Only flag as unsafe if the text promotes or contains explicit pornography/NSFW sexual content (S12), ` +
              `child exploitation (S4), hate speech/extremism (S10), self-harm/suicide (S11), or extreme sadistic gore/real-world mass violence (S1).]\n\n` +
              combinedText
          }
        ]
      }),
      2800
    );

    const rawResponse = String(
      aiRes?.response || aiRes?.result?.response || (typeof aiRes === 'string' ? aiRes : '')
    )
      .trim()
      .toLowerCase();

    if (rawResponse.startsWith('unsafe')) {
      // Map Llama Guard hazard codes:
      // S4 (Child Exploitation) / S12 (Sexual Content) -> sexual_nsfw
      // S10 (Hate) -> hate_speech
      // S11 (Self-Harm) -> self_harm
      // S1 (Violent Crimes) -> extreme_gore_violence
      let category: ContentSafetyCategory = 'extreme_gore_violence';
      let codeLabel = 'unsafe';
      if (/\bs12\b|\bs4\b|\bs3\b/i.test(rawResponse)) {
        category = 'sexual_nsfw';
        codeLabel = rawResponse.includes('s4') ? 'S4 (CSAM/Exploitation)' : 'S12 (Sexual/NSFW)';
      } else if (/\bs10\b/i.test(rawResponse)) {
        category = 'hate_speech';
        codeLabel = 'S10 (Hate Speech)';
      } else if (/\bs11\b/i.test(rawResponse)) {
        category = 'self_harm';
        codeLabel = 'S11 (Self-Harm)';
      } else if (/\bs1\b/i.test(rawResponse) && staticEval.autoContentWarnings.includes('violence_and_gore')) {
        category = 'extreme_gore_violence';
        codeLabel = 'S1 (Extreme Violence/Gore)';
      } else {
        // Ignore non-applicable Llama Guard categories (e.g., S1 generic fantasy sword combat without gore,
        // S6 Specialized financial/medical advice for healing potions, S7 Privacy, S8 IP)
        // so normal RPG combat or potion mods are never falsely flagged!
        return {
          ...staticEval,
          aiChecked: true,
          aiFallbackUsed: false
        };
      }

      const aiMatch: ContentSafetyMatch = {
        category,
        term: `Llama Guard 3 (${codeLabel})`,
        file: 'Workers AI (@cf/meta/llama-guard-3-8b)',
        snippet: input.shortDesc.slice(0, 120),
        source: 'workers_ai'
      };

      return {
        holdForAdminReview: true,
        categories: [category],
        matches: [aiMatch],
        autoContentWarnings: staticEval.autoContentWarnings,
        aiChecked: true,
        aiFallbackUsed: false,
        summary: `Workers AI (@cf/meta/llama-guard-3-8b) flagged repository under ${codeLabel}.`
      };
    }

    return {
      ...staticEval,
      aiChecked: true,
      aiFallbackUsed: false
    };
  } catch {
    // Quota exhausted, offline, or model unavailable -> seamlessly fall back to static evaluation
    return {
      ...staticEval,
      aiChecked: false,
      aiFallbackUsed: true
    };
  }
}
