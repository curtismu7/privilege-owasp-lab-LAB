import { fillDeep } from './cast.js';
import { BANNER, FACTS, INTRO, SCENARIOS, TALK_TRACK, TITLE } from './storyData.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, facts: FACTS, scenarios: SCENARIOS, talkTrack: TALK_TRACK });

// The story with the cast filled in. The seed lists stay server-side (the Mock output uses them).
export function buildStory(cast) {
  const { seed: _seed, ...shown } = cast;
  const s = fillDeep(rawStory(), cast);
  return { ...s, tokenLabel: 'MOCK output and MOCK identifiers in Mock: for education, never real tenant data', cast: shown };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast);
  const parts = ['# Talk track', '', '<!-- Generated from server/src/storyData.js by `npm run talk-track`. Do not edit by hand. -->', ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The scenarios', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}** (\`${sc.commandKey}\`). ${sc.say} *${sc.lesson}*`));
  return `${parts.join('\n')}\n`;
}
