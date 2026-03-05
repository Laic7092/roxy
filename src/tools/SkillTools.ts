import { SkillsLoader } from '../agent/skill'

export const skillTools = [
  {
    name: 'load_skill',
    description:
      "Load a skill's full instructions by name. Use this when you need detailed information about how to use a specific skill.",
    parameters: {
      type: 'object',
      properties: {
        skillName: {
          type: 'string',
          description: 'Name of the skill to load (e.g., "cron", "memory")',
        },
      },
      required: ['skillName'],
    },
    execute: async (args: { skillName: string }, workspace: string) => {
      const loader = new SkillsLoader(workspace)
      const content = await loader.loadSkill(args.skillName)
      if (content) {
        return { success: true, content }
      }
      return { success: false, error: `Skill '${args.skillName}' not found` }
    },
  },
]
