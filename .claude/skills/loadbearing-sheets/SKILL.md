---
name: loadbearing-sheets
description: Use when adding, editing, or drafting a Loadbearing problem or lab sheet — via the add_sheet MCP tool, a POST to /api/problems, or a change to the built-in bank. Covers the exact input field names (several differ from what the output renders), which mistakes fail loudly, which fail silently, and which instance to write to.
---

# Adding a sheet to Loadbearing

`get_sheet` shows the **output** shape. The **input** shape is different, and four of
the differences fail without saying anything. Two independent sessions have now
guessed the field names from rendered output and got them wrong in two different
ways, so do not infer them — the authority is `validateProblem` in
[server/src/problems/validate.ts](../../server/src/problems/validate.ts).

## The input shape

```jsonc
{
  "id": "l6-my-problem",        // required, slugified to [a-z0-9-]
  "title": "...",               // optional, falls back to the id
  "level": 6,                   // 1-6; anything else silently becomes 3
  "domain": "ai-platform",      // optional, defaults 'general'
  "prompt": "...",              // required, must exceed 40 characters
  "functional":     ["..."],    // required, non-empty array of STRINGS
  "twists":         ["..."],    // required, non-empty array of STRINGS
  "concepts":       ["..."],    // required; unknown ids are dropped, and if all
                                //   are dropped the write fails
  "nonFunctional":  { "k": "v" },   // object of string|number, not an array
  "constraints":    ["..."],
  "expectedFlows":  ["..."],
  "rubricHints":    "one string",   // a STRING, never an array
  "scenarios": [
    {
      "id": "...",
      "name": "...",              // NOT "title"
      "description": "...",
      "rpsMultiplier": 25,        // NOT "loadMultiplier"
      "thirdPartyLatencyMs": 6000,
      "killNodes": ["cache"],     // NOT "kill"
      "passCriteria": "..."       // NOT "pass"
    }
  ],
  "diagram": { }                  // optional; with kind:"lab" makes it start drawn
}
```

## The traps, and how each one fails

| Wrong | Right | Failure |
|---|---|---|
| `functionalRequirements` | `functional` | **loud** — `no functional requirements` |
| twists as `{id,title,body}` objects | array of strings | **loud** — `no twists` (non-strings are filtered, leaving none) |
| `rubricHints` as an array | one joined string | **silent** — stored as `""` |
| `numbers` | `nonFunctional` | **silent** — dropped |
| `flows` | `expectedFlows` | **silent** — dropped |
| scenario `title` / `pass` / `kill` | `name` / `passCriteria` / `killNodes` | **silent** — name becomes "Scenario 1", the rest empty |
| `loadMultiplier` | `rpsMultiplier` | **silent** — every scenario runs at 1x |

Unknown keys are never rejected, so a sheet assembled with the wrong names is
created successfully and looks complete while applying no load and carrying no
pass criteria. `scenarios` is not enforced at all by the validator — only the tool
description asks for two — so a sheet with none still writes.

`killNodes` is a case-insensitive **substring** match against node labels and types
(`resolveKillIds` in `shared/src/scenarios.ts`), so `"database"` or `"fact store"`
are correct as authored — they match what the learner labels their boxes, not the
catalogue's type names.

## Which instance to write to

Custom sheets are **per account**, and tokens are **per database**. A token minted
on localhost does not exist in the deployment's Postgres, and the rejection reads
`That API token is not valid — it may have been revoked`, which is misleading.

Check where the data is before writing:

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/loadbearing.sqlite',{readOnly:true});console.log(db.prepare('SELECT id FROM problems_custom').all())"
```

`GET /api/problems` unauthenticated returns only the built-in bank — a custom sheet
missing from that list is not evidence the write failed. Pass the token to see it.

## Writing it

Prefer the `add_sheet` MCP tool. When that path is unavailable or has already
dropped a call, POST directly and read the token from config rather than pasting it
into a command, so it stays out of shell history:

```js
const token = JSON.parse(readFileSync(CONFIG,'utf8')).mcpServers.loadbearing.env.LOADBEARING_TOKEN;
await fetch('http://localhost:8787/api/problems', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(problem),
});
```

## Always verify by reading back

The silent failures are invisible in the request and invisible in a 201. Assert on
the stored object, not on the status code:

```
twists.length        > 0        else the object form survived
rubricHints.length   > 0        else the array form survived
concepts.length      == sent    else ids were dropped
scenarios[].rpsMultiplier       else every load is 1x
scenarios[].passCriteria        else the pass criteria are gone
```
