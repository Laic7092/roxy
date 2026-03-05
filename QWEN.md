# Roxy Project Context

## Project Overview

**Roxy** is an AI assistant that supports both CLI and Web interaction modes. Built with TypeScript, it features an event-driven architecture with session management, streaming responses, and tool execution capabilities.

### Core Architecture (Event-Driven)

```
┌─────────────────────────────────────────────────────────────┐
│                      EventBus (Singleton)                     │
│  事件类型：                                                    │
│  - user:message      (Channel → Orchestrator)                │
│  - agent:response    (Agent → Channel/Session)               │
│  - agent:stream      (Agent → Channel)                       │
│  - agent:tool_call   (Agent → Executor)                      │
│  - agent:tool_result (Executor → Agent)                      │
│  - session:save      (Auto-triggered)                        │
│  - agent:delegate    (Parent → SubAgent)                     │
│  - team:broadcast    (Team Lead → Members)                   │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
┌────────┴────────┐   ┌───────┴────────┐   ┌───────┴───────┐
│  CLIChannel     │   │  WebChannel    │   │  Orchestrator │
│  (I/O only)     │   │  (I/O only)    │   │  (Routing)    │
└─────────────────┘   └────────────────┘   └───────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
           ┌────────┴────────┐       ┌────────┴────────┐       ┌────────┴────────┐
           │  MainAgent      │       │  SubAgent #1    │       │  SubAgent #2    │
           │  (General)      │       │  (Code Expert)  │       │  (Doc Expert)   │
           └─────────────────┘       └─────────────────┘       └─────────────────┘
```

### Design Principles

1. **Event-Driven** - All components communicate via EventBus
2. **Channel I/O Only** - Channels only handle input/output, no business logic
3. **Session Auto-Save** - SessionManager listens to events and auto-persists
4. **Agent Orchestration** - Orchestrator routes tasks to appropriate Agents
5. **SubAgent Support** - Agents can delegate tasks to specialized SubAgents
6. **Agent Teams** - Team Lead can broadcast tasks to multiple members

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Channel** | I/O only, publishes user messages, displays agent responses |
| **EventBus** | Event hub for all component communication |
| **Orchestrator** | Routes user messages to agents, manages teams |
| **AgentFactory** | Creates and manages Agent instances |
| **AgentLoop** | Processes tasks, handles LLM calls and tool execution |
| **SessionManager** | Session persistence, listens to events for auto-save |

## Project Structure

```
roxy/
├── src/
│   ├── agent/
│   │   ├── loop.ts         # AgentLoop - event-driven message processor
│   │   ├── context.ts      # Context management
│   │   ├── factory.ts      # AgentFactory - creates/manages agents
│   │   ├── memory.ts       # Memory management
│   │   ├── skill.ts        # Skill system
│   │   └── types.ts        # Agent type definitions
│   ├── bus/
│   │   ├── instance.ts     # EventBus - event hub implementation
│   │   ├── events.ts       # Event type definitions
│   │   └── types.ts        # Legacy types (deprecated)
│   ├── channels/
│   │   ├── base.ts         # Channel abstract base class
│   │   ├── cli.channel.ts  # CLI channel implementation
│   │   └── web.channel.ts  # Web channel implementation
│   ├── cli/
│   │   └── commands/
│   │       ├── agent.ts    # agent command
│   │       ├── onboard.ts  # onboard command
│   │       └── web.ts      # web command
│   ├── config/
│   │   └── manager.ts      # Configuration management
│   ├── orchestrator/
│   │   └── orchestrator.ts # AgentOrchestrator - task routing
│   ├── provider/
│   │   ├── base.ts         # LLM provider base class
│   │   └── llm.ts          # LiteLLM provider implementation
│   ├── session/
│   │   └── manager.ts      # Session management and persistence
│   ├── tools/              # Tool system
│   ├── skills/             # Skill system
│   ├── web/
│   │   └── server.ts       # Web server
│   ├── types/
│   │   └── errors.ts       # Error type definitions
│   └── utils/              # Utility functions
├── tests/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── README.md
```

## Core Components

### EventBus (`src/bus/`)

**Event-Driven Communication**:
```typescript
class EventBus {
  // Publish event
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void
  
  // Subscribe to event
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void
  
  // Convenience methods
  publishUserMessage(data: Omit<EventMap['user:message'], 'timestamp'>): void
  publishAgentResponse(data: Omit<EventMap['agent:response'], 'timestamp'>): void
  publishAgentStream(data: Omit<EventMap['agent:stream'], 'timestamp'>): void
  publishAgentToolCall(data: Omit<EventMap['agent:tool_call'], 'timestamp'>): void
  publishAgentTaskComplete(data: Omit<EventMap['agent:task:complete'], 'timestamp'>): void
}
```

**Event Types** (`src/bus/events.ts`):
```typescript
interface EventMap {
  'user:message': UserMessageEvent
  'agent:response': AgentResponseEvent
  'agent:stream': AgentStreamEvent
  'agent:tool_call': AgentToolCallEvent
  'agent:tool_result': AgentToolResultEvent
  'agent:execute': AgentExecuteEvent
  'agent:task:complete': AgentTaskCompleteEvent
  'agent:delegate': AgentDelegateEvent
  'team:broadcast': TeamBroadcastEvent
  'session:save': SessionSaveEvent
  'error': ErrorEvent
}
```

### Channel Layer (`src/channels/`)

**BaseChannel** - Simplified abstract base class:
```typescript
abstract class BaseChannel {
  abstract readonly id: string
  protected sessionId: string | null
  protected eventBus: EventBus

  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract display(msg: any): Promise<void>

  protected async handleInput(content: string): Promise<void> {
    this.eventBus.publishUserMessage({
      channelId: this.id,
      sessionId: this.sessionId!,
      content,
    })
  }
}
```

**CLIChannel** - CLI channel implementation:
- Uses `readline` for user input
- Uses `chalk` and `ora` for styled output
- Subscribes to events for display
- Supports commands: `/help`, `/clear`, `/history`, `/skills`, `/exit`
- Default sessionId: `cli:default`

**WebChannel** - Web channel implementation:
- Uses WebSocket for communication
- One Channel instance per connection
- Subscribes to events for display
- Default sessionId: `web:{random ID}`

### AgentLoop (`src/agent/loop.ts`)

**Event-Driven Message Processor**:
```typescript
class AgentLoop {
  constructor(deps: AgentLoopDeps) {
    // Subscribe to agent:execute events
    this.setupEventHandlers()
  }

  private async executeTask(task: AgentTask): Promise<void> {
    // 1. Get session
    this.session = await this.getOrCreateSession(task.sessionId)
    
    // 2. Add user message
    this.session.addMessage('user', task.content)
    
    // 3. Call LLM API
    const result = await this.provider.chat({ ... })
    
    // 4. Handle tool calls
    if (toolCalls) {
      this.eventBus.publishAgentToolCall({ ... })
      const results = await this.toolExecutor.executeTools(toolCalls)
      this.eventBus.publishAgentToolResult({ ... })
    }
    
    // 5. Publish response
    this.eventBus.publishAgentResponse({ ... })
  }
}
```

### AgentFactory (`src/agent/factory.ts`)

**Agent Creation and Management**:
```typescript
class AgentFactory {
  async createAgent(config: AgentConfig): Promise<AgentLoop> {
    const agent = new AgentLoop({ ... })
    
    // Subscribe to execution events for this agent
    this.eventBus.on('agent:execute', async (event) => {
      if (event.task.agentId === config.id) {
        await this.handleTaskExecution(agent, event.task)
      }
    })
    
    this.agents.set(config.id, agent)
    return agent
  }

  async createSubAgent(parentId: string, specialty: string): Promise<AgentLoop> {
    const subAgentId = `sub-${specialty}-${uuidv4().slice(0, 8)}`
    return this.createAgent({ id: subAgentId, role: AgentRole.SUB })
  }
}
```

### AgentOrchestrator (`src/orchestrator/orchestrator.ts`)

**Task Routing and Team Management**:
```typescript
class AgentOrchestrator {
  private async handleUserMessage(event: UserMessageEvent) {
    // Route to appropriate agent
    const agentId = await this.selectAgent(event.content)
    
    // Create task
    const task: AgentTask = {
      id: uuidv4(),
      agentId,
      content: event.content,
      sessionId: event.sessionId,
      channelId: event.channelId,
      status: TaskStatus.PENDING,
    }
    
    // Publish execution event
    this.eventBus.publishAgentExecute({ task })
  }

  async createTeam(team: AgentTeam): Promise<void> {
    // Create team members
    for (const member of team.members) {
      await this.agentFactory.createAgent({
        id: member.agentId,
        role: AgentRole.SUB,
      })
    }
    this.teams.set(team.id, team)
  }
}
```

### SessionManager (`src/session/manager.ts`)

**Event-Driven Auto-Save**:
```typescript
class SessionManager {
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Auto-save on user message
    this.eventBus.on('user:message', (event) => {
      this.appendMessage(event.sessionId, 'user', event.content)
    })

    // Auto-save on agent response
    this.eventBus.on('agent:response', (event) => {
      this.appendMessage(event.sessionId, 'assistant', event.content)
      this.save(event.sessionId) // Auto-persist
    })

    // Auto-save on tool result
    this.eventBus.on('agent:tool_result', (event) => {
      this.appendToolMessage(event.sessionId, event.toolResult, event.toolCallId)
      this.save(event.sessionId) // Auto-persist
    })
  }
}
```

**Session Isolation Strategy**:
```
CLI Default: sessionId = 'cli:default'     → cli_default.jsonl
CLI Work:    sessionId = 'cli:work'        → cli_work.jsonl
Web User A:  sessionId = 'web:userA'       → web_userA.jsonl
Web User B:  sessionId = 'web:userB'       → web_userB.jsonl
Shared:      sessionId = 'shared:proj1'    → shared_proj1.jsonl (CLI & Web shared)
```

## Building and Running

### Install Dependencies
```bash
pnpm install
```

### Build Project
```bash
pnpm build
```

### Run Tests
```bash
pnpm test
```

### Development Mode
```bash
pnpm dev
```

### Lint and Format
```bash
pnpm lint      # Run oxlint
pnpm lint:fix  # Fix lint issues
pnpm fmt       # Format with oxfmt
```

### Global Install and Usage
```bash
# Install globally
pnpm add -g roxy

# Initialize configuration
roxy onboard

# Start CLI session
roxy agent
roxy agent --session cli:work  # Specify session

# Start Web server
roxy web -p 3000
```

## Configuration

Configuration file location: `~/.roxy/config.json`

```json
{
  "workspace": "/home/user/.roxy/workspace",
  "agents": {
    "defaults": {
      "model": "ollama/qwen3.5:9b"
    }
  },
  "providers": {
    "ollama": {
      "apiKey": "ollama-local",
      "baseURL": "http://localhost:11434/v1"
    },
    "deepseek": {
      "apiKey": "your-api-key-here",
      "baseURL": "https://api.deepseek.com"
    }
  }
}
```

## Development Conventions

### Type Safety
- TypeScript throughout the codebase
- All events have type definitions in `src/bus/events.ts`
- Agent types in `src/agent/types.ts`

### Error Handling
- Unified `RoxyError` class with error codes
- Error categorization: Network, Config, Session, Tool, LLM, System
- Recoverable vs Fatal error distinction
- Centralized logging via `src/utils/error-handler.ts`

### Code Style
- ES2020+ features
- Modern TypeScript best practices
- Modular design for extensibility

### Testing Practices
- Vitest for unit testing
- Tests located in `tests/` directory
- Test files named `*.test.ts`

## Extensibility

### Adding a New Channel

1. Extend `BaseChannel` class
2. Implement `start()`, `stop()`, `display()` methods
3. Subscribe to events in `start()`

```typescript
class DiscordChannel extends BaseChannel {
  readonly id = 'discord'
  
  async start() {
    this.subscribeEvents()
    // Setup Discord bot...
  }
  
  async display(msg: any) {
    // Send to Discord...
  }
}
```

### Adding New Event Types

1. Add type definition in `src/bus/events.ts`
2. Add to `EventMap` interface
3. Add convenience method in `EventBus`

### Adding New Agent Types

1. Create agent config with unique `id` and `role`
2. Use `AgentFactory.createAgent(config)`
3. Agent automatically subscribes to `agent:execute` events

### Adding SubAgent Support

```typescript
// In your agent's logic
this.eventBus.publishAgentDelegate({
  parentId: task.id,
  parentAgentId: this.config.id,
  delegation: {
    parentId: task.id,
    subTask: 'Review this code',
    agentType: 'code-reviewer',
  },
})
```

### Creating Agent Teams

```typescript
const codeReviewTeam: AgentTeam = {
  id: 'code-review-team',
  name: 'Code Review Team',
  lead: 'senior-dev',
  members: [
    { agentId: 'security-expert', role: 'security_review' },
    { agentId: 'performance-expert', role: 'perf_review' },
    { agentId: 'style-expert', role: 'style_review' },
  ],
}

await orchestrator.createTeam(codeReviewTeam)
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI command framework |
| `chalk` | Terminal styling |
| `ora` | Loading spinners |
| `ws` | WebSocket server |
| `mitt` | Event emitter (EventBus foundation) |
| `uuid` | Unique ID generation |

## Dev Dependencies

| Package | Purpose |
|---------|---------|
| `tsdown` | Build tool |
| `typescript` | Type checking |
| `vitest` | Testing framework |
| `oxlint` | Linting |
| `oxfmt` | Formatting |

## Event Flow Example

```
1. User types "Hello" in CLI
   → CLIChannel.handleInput()
   → eventBus.publishUserMessage({ sessionId: 'cli:default', content: 'Hello' })

2. AgentOrchestrator receives event
   → selectAgent() → 'main-agent'
   → Create task
   → eventBus.publishAgentExecute({ task })

3. AgentLoop (main-agent) receives event
   → executeTask(task)
   → Get session from SessionManager
   → Call LLM API
   → eventBus.publishAgentStream({ chunk: 'H' })
   → eventBus.publishAgentStream({ chunk: 'i' })
   → eventBus.publishAgentResponse({ content: 'Hi!' })

4. SessionManager receives events
   → On 'user:message': append user message
   → On 'agent:response': append assistant message + save()

5. CLIChannel receives events
   → On 'agent:stream': showStream(chunk)
   → On 'agent:response': showResponse(content)
```
