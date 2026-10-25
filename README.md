# DecampWatch NG

A real-time tracker of party defections ("decamping") by members of Nigeria's 10th National Assembly.

- What we're building: [docs/SPEC.md](docs/SPEC.md)
- How detection works: [AGENT.md](AGENT.md)
- Rules for contributors and Claude Code: [CLAUDE.md](CLAUDE.md)

## Setup

Requires Node 22 or newer (24 is pinned in `.nvmrc`).

```powershell
npm install
Copy-Item .env.example .env.local   # fill in values as later milestones need them
npm run dev                         # http://localhost:3000
```

## Checks

```powershell
npm run lint
npm run typecheck
npm test
```
