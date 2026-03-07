# MCP Servers

Model Context Protocol server configurations and custom server implementations.

## Structure

```
mcp-servers/
└── <server-name>/
    ├── server.js|py    # Server implementation
    ├── config.json     # Server configuration
    └── README.md       # Description, tools exposed, and setup
```

## What is an MCP Server?

An MCP server extends agent capabilities by exposing external tools and data sources over the Model Context Protocol. Servers can provide:

- **Tools**: Custom functions the agent can call
- **Resources**: Data sources the agent can read
- **Prompts**: Server-side prompt templates
