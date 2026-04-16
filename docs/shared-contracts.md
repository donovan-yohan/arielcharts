# MermaidFlow shared contracts

## Session identifier
- Format: URL path `/s/:id`
- Validation: lowercase letters, digits, `_`, `-`, length 6-32
- Example: `a7x9k2mn`

## Shared TypeScript contracts
Source of truth: `packages/shared/src/types.ts`

### Participant
```ts
interface Participant {
  name: string;
  color: string;
  type: 'human' | 'agent';
}
```

### AwarenessState
```ts
interface AwarenessState {
  user: Participant;
  cursor?: {
    anchor: number;
    head: number;
  };
}
```

### ActivityEvent
```ts
interface ActivityEvent {
  id: string;
  timestamp: number;
  actor: {
    name: string;
    type: 'human' | 'agent';
  };
  action: 'joined' | 'left' | 'edited' | 'replaced';
  detail?: string;
}
```

### MCP tool shapes
```ts
interface ReadDiagramInput {
  session_id: string;
}

interface ReadDiagramOutput {
  mermaid_text: string;
  participants: Participant[];
}

interface WriteDiagramInput {
  session_id: string;
  mermaid_text: string;
}

interface WriteDiagramOutput {
  success: boolean;
}

interface ListSessionsOutput {
  sessions: {
    id: string;
    title: string;
    participants: number;
  }[];
}
```

### MCP HTTP envelope
`POST /mcp` accepts JSON in the shape:

```json
{
  "tool": "read_diagram | write_diagram | list_sessions",
  "input": {}
}
```

Successful responses return:

```json
{
  "result": {}
}
```

Validation and transport rules:
- origin must be in `ALLOWED_ORIGINS` when configured
- malformed JSON or invalid tool input returns `400`
- disallowed origin returns `403`
- `write_diagram` accepts empty `mermaid_text`
- when `participants` are omitted on `write_diagram`, the backend synthesizes an actor participant for awareness attribution
- browser-facing `/mcp` responses emit `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers`
- `OPTIONS /mcp` returns `204` for allowed preflight requests and advertises `POST, OPTIONS`
- when `ALLOWED_ORIGINS` is empty or contains `*`, `/mcp` responds with `Access-Control-Allow-Origin: *`; otherwise it echoes the allowed request origin

### Websocket contract
- Endpoint: `/ws/:roomId`
- Protocol: y-websocket-compatible framing using Yjs sync (`messageType=0`) and awareness (`messageType=1`) messages plus query-awareness (`messageType=3`)
- Initial server behavior: sends sync step 1 and current awareness snapshot
- Presence source of truth for live collaboration is the Yjs awareness protocol
- Persisted `participants` returned by MCP reads are derived from the latest known awareness / agent attribution state

## Backend/frontend coordination rules
- Mermaid source text is canonical state.
- Backend owns Yjs doc lifecycle, websocket transport, LevelDB persistence, session cleanup, and MCP tool implementation.
- Frontend consumes shared types, session route params, websocket endpoint config, and awareness/activity state from Yjs.
- Backend `write_diagram` must append an `ActivityEvent`, update persisted Yjs state, and mark agent awareness for attribution.
- `list_sessions` returns currently known live sessions plus persisted sessions, ordered by stable `updatedAt` write time rather than read time.
- Frontend should not invent alternate schemas for participants, awareness, activity events, or MCP payloads.
