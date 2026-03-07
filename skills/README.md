# Skills

Reusable skill definitions that can be invoked by name during agent sessions.

## Structure

Each skill lives in its own directory:

```
skills/
└── <skill-name>/
    ├── skill.md        # Skill prompt and instructions
    └── README.md       # Description, triggers, and usage
```

## What is a Skill?

A skill is a packaged capability with:

- **Name**: A short identifier used to invoke it
- **Trigger**: Conditions under which the skill activates (manual or automatic)
- **Prompt**: The instructions the agent follows when the skill is active
- **Tools**: Optionally, the set of tools the skill requires
