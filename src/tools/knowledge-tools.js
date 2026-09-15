import * as z from 'zod/v4';
import { FULL_GLOSSARY, GLOSSARY_SECTIONS } from '../domain/glossary.js';
import { PLAYBOOK_MARKDOWN } from '../domain/playbook.js';
import { READ_ONLY, safeHandler } from './shared.js';

const TOPICS = Object.keys(GLOSSARY_SECTIONS);

export function registerKnowledgeTools(server) {
  server.registerTool(
    'explain_fantasy_football',
    {
      title: 'Fantasy football primer',
      description:
        'Get background on how fantasy football works: the season structure, scoring formats ' +
        '(PPR vs standard), lineup slots, waivers and FAAB, injury designations, strategy ' +
        'vocabulary and league types. Call this when a question uses fantasy jargon you are not ' +
        'confident about, or before giving advice in an unfamiliar league format.',
      inputSchema: z.object({
        topic: z
          .enum([...TOPICS, 'all'])
          .optional()
          .describe(`Topic to explain. One of: ${TOPICS.join(', ')}, all. Defaults to all.`)
      }),
      annotations: { ...READ_ONLY, openWorldHint: false }
    },
    safeHandler(async ({ topic }) => {
      const text = !topic || topic === 'all' ? FULL_GLOSSARY : GLOSSARY_SECTIONS[topic];
      return { content: [{ type: 'text', text }] };
    })
  );

  server.registerTool(
    'how_to_answer',
    {
      title: 'Question playbook',
      description:
        'Get the recommended tool sequence for common fantasy questions (start/sit, waiver ' +
        'pickups, trade evaluation, playoff odds, weekly recap, draft review). Call this when ' +
        'you are unsure which tools to combine for a question.',
      annotations: { ...READ_ONLY, openWorldHint: false }
    },
    safeHandler(async () => ({ content: [{ type: 'text', text: PLAYBOOK_MARKDOWN }] }))
  );
}
