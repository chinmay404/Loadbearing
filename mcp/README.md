# Loadbearing over MCP

Lets a chatbot elsewhere — Claude Desktop, an agent in an editor, anything speaking
MCP — read what is on your canvas, change it, run the load engine over the result,
and add problems to your bank.

It talks to a running Loadbearing over HTTP, as you, using a token you minted and can
revoke. It never touches the database directly: every rule about what a design may
contain and what a problem must look like lives behind those routes, and a second
process reaching around them would be a second copy of all of it, free to drift.

## Setup

1. **Mint a token.** In Loadbearing, open **Grader model** and find **API tokens**.
   Name it after the thing that will hold it. The secret is shown once — nothing
   stores it, only its hash — so copy it then. If you lose it, revoke and mint again.

2. **Build it.**

   ```bash
   npm run build:mcp
   ```

3. **Point your client at it.** For Claude Desktop, in
   `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "loadbearing": {
         "command": "node",
         "args": ["/absolute/path/to/loadbearing/mcp/dist/index.js"],
         "env": {
           "LOADBEARING_URL": "http://localhost:8787",
           "LOADBEARING_TOKEN": "lb_…"
         }
       }
     }
   }
   ```

   `LOADBEARING_URL` defaults to `http://localhost:8787`. Point it at a deployment
   instead if that is where your work lives — the token is per-account, not
   per-machine.

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

## A token is you

It carries the same rights your account has — there is no read-only mode. Give one
out only where you would give out your password, and revoke it when you stop needing
it. Revocation is immediate: the row is deleted and the next call fails.

## Notes

- **The server must be running.** If it is not, every tool says so plainly rather
  than failing with `fetch failed`.
- **Nothing is destructive by accident.** `write_canvas` overwrites and says so;
  `place_starting_architecture` refuses a sheet with work on it; `add_sheet` never
  replaces an existing id, it suffixes.
- **A lab opened only through MCP starts empty.** The browser places the starting
  architecture on first open; through the API you ask for it. `run_engine` on an
  empty lab says which tool to call.
