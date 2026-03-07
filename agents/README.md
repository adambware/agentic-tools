# Agents

Agent configurations and definitions — system prompts, tool access policies, and behavioral guidelines.

## Structure

```
agents/
└── <agent-name>/
    ├── agent.md        # System prompt and behavioral instructions
    ├── config.json     # Tool access, model preferences, constraints
    └── README.md       # Description and usage
```

## What is an Agent?

An agent definition specifies:

- **System prompt**: Core instructions and persona
- **Tool access**: Which tools the agent can use
- **Constraints**: Guardrails, allowed actions, and limits
- **Model**: Preferred model and parameters
