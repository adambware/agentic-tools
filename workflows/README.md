# Workflows

Multi-step orchestrated processes that combine skills, agents, and prompts into end-to-end pipelines.

## Structure

```
workflows/
└── <workflow-name>/
    ├── workflow.md     # Workflow steps and orchestration logic
    └── README.md       # Description, inputs/outputs, and usage
```

## What is a Workflow?

A workflow chains together multiple agentic components to accomplish a larger goal:

- **Steps**: Ordered sequence of actions (skill invocations, agent handoffs, prompts)
- **Inputs/Outputs**: Data that flows between steps
- **Conditions**: Branching logic based on intermediate results

Examples: code review pipelines, onboarding flows, CI/CD automation.
