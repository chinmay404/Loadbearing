# Loadbearing over MCP

Lets a chatbot — Claude, ChatGPT, an agent in an editor — read what is on your canvas,
change it, run the load engine over the result, and add problems to your bank. As you,
using a token you minted and can revoke.

Two ways in, one set of tools:

- **HTTP**, served by the deployment at `/api/mcp`. This is what a hosted chatbot
  needs, because all it can do is call a URL.
- **stdio**, `stdio.ts`, for clients that launch a process instead.

`tools.ts` holds the tool table and the dispatch, and neither transport is where a
capability gets decided. Every tool goes through the HTTP API rather than the
database: over stdio that is a real call to a running Loadbearing, and inside the
deployment it is the same Hono app answering itself with no socket involved. Either
way the rules about what a design may contain live in exactly one place.

## Mint a token

**Grader model → API tokens.** Name it after whatever will hold it. The secret is
shown once — only its hash is stored — so copy it then. A lost one is revoked and
replaced, not recovered.

A token carries the same rights your account has. There is no read-only mode.

## Connecting a hosted chatbot

In Claude: **Settings → Connectors → Add custom connector**, and give it

```
https://your-deployment/api/mcp
```

If your client can set a header, send `Authorization: Bearer lb_…`. If it cannot —
Claude's connector dialog offers OAuth and nothing else — put the token in the path:

```
https://your-deployment/api/mcp/lb_…
```

**That URL is then the credential.** Anything holding it can act as you, and a URL
ends up in logs, history and screenshots in a way a header does not. Mint one used for
nothing else and revoke it when you are done.

`localhost` will not work for a hosted chatbot: its servers cannot reach your machine.
Use the deployed address.

## Running it locally

For Claude Desktop, in `claude_desktop_config.json` (**Settings → Developer → Edit
Config**):

```json
{
  "mcpServers": {
    "loadbearing": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/loadbearing/server/src/mcp/stdio.ts"],
      "env": {
        "LOADBEARING_URL": "http://localhost:8787",
        "LOADBEARING_TOKEN": "lb_…"
      }
    }
  }
}
```

The tokens panel renders this with the real path already filled in. Point
`LOADBEARING_URL` at the deployment instead if that is where your work lives — the
token is per-account, not per-machine.

For Claude Code:

```bash
claude mcp add loadbearing -e LOADBEARING_TOKEN=lb_… -- npx tsx /absolute/path/to/loadbearing/server/src/mcp/stdio.ts
```

## What it can do

| Tool | What it is for |
|---|---|
| `list_sheets` | Find a sheet. Filter by level, by kind (`design` or `lab`), or search. |
| `get_sheet` | The full brief: prompt, requirements, numbers, constraints, scenarios, and a lab's starting architecture. The marking rubric is deliberately withheld. |
| `read_canvas` | What is drawn, as prose or as the raw document to edit. |
| `write_canvas` | Replace what is drawn. Read as JSON first, change, send it all back. |
| `place_starting_architecture` | Put a lab's starting design on its canvas. Refuses if anything is drawn. |
| `run_engine` | Run the load engine: which flows complete, where traffic stops, what saturates, what it costs. Optionally one of the sheet's own scenarios. |
| `add_sheet` | Add a problem or lab, held to the same shape as everything in the bank. |
| `search_notes` / `add_note` | Everything written across every sheet and project. |

Tools answer in prose with the numbers in it, not raw JSON. A canvas document is
mostly coordinates and a run is mostly per-tick arrays; a model asked what is wrong
with a design should not have to reconstruct the picture from pixel positions.

## Notes

- **The HTTP endpoint is stateless.** Each request builds its own server and carries
  its own credential. There is no session to lose and nothing to clean up, which is
  the only shape that survives a serverless host.
- **There is no event stream.** `GET /api/mcp` says so with a 405 rather than holding
  a connection open for messages that are never coming.
- **Nothing is destructive by accident.** `write_canvas` overwrites and says so;
  `place_starting_architecture` refuses a sheet with work on it; `add_sheet` never
  replaces an existing id, it suffixes.
- **A lab reached only over MCP starts empty.** The browser places the starting
  architecture on first open; through the API you ask for it. `run_engine` on an empty
  lab says which tool to call.
