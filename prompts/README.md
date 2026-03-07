# Prompts

Reusable prompt templates and system prompts that can be parameterized and composed.

## Structure

```
prompts/
└── <prompt-name>/
    ├── prompt.md       # The prompt template
    └── README.md       # Description, parameters, and usage
```

## What is a Prompt?

A prompt template is a reusable block of instructions that can include:

- **Parameters**: Placeholders filled in at runtime (e.g., `{{language}}`, `{{context}}`)
- **Composition**: References to other prompts for building complex instructions
- **Variants**: Different versions for different contexts or models
