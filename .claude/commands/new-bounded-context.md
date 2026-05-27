Scaffold a new NestJS bounded context in the backend.

Arguments: $ARGUMENTS
Expected format: `<ContextName> [description]`
Example: `pricing Price rules and margin management`

`<ContextName>` is PascalCase module name, e.g. `Pricing`. The folder will be `kebab-case`, e.g. `pricing`.

---

## What to build

You are adding a new bounded context following the NestJS layering rules of this project. Read `backend-layering` rule before starting.

**Discovery first**: search `backend/src/` for any existing files related to this context. If any exist, extend them instead of duplicating.

### Step 1 — Create folder

`backend/src/<context-folder>/`

### Step 2 — Repository

File: `backend/src/<context-folder>/<context-folder>.repository.ts`

```ts
import { Injectable } from "@nestjs/common";
// import db client from common — see nearby repositories for the import pattern

@Injectable()
export class <ContextName>Repository {
  // SQL / ORM queries only — no business logic
  // async findAll(): Promise<...[]> { ... }
}
```

### Step 3 — Service

File: `backend/src/<context-folder>/<context-folder>.service.ts`

```ts
import { Inject, Injectable } from "@nestjs/common";
import { <ContextName>Repository } from "./<context-folder>.repository";

@Injectable()
export class <ContextName>Service {
  constructor(
    @Inject(<ContextName>Repository)
    private readonly <contextName>Repository: <ContextName>Repository,
  ) {}

  // business rules and orchestration here
}
```

### Step 4 — Controller

File: `backend/src/<context-folder>/<context-folder>.controller.ts`

```ts
import { Controller, Get, Inject } from "@nestjs/common";
import { <ContextName>Service } from "./<context-folder>.service";

@Controller("<context-folder>")
export class <ContextName>Controller {
  constructor(
    @Inject(<ContextName>Service)
    private readonly <contextName>Service: <ContextName>Service,
  ) {}

  // @Get() / @Post() handlers — transport only, no business logic
  // call service methods, return their result
}
```

### Step 5 — Module

File: `backend/src/<context-folder>/<context-folder>.module.ts`

```ts
import { Module } from "@nestjs/common";
import { <ContextName>Controller } from "./<context-folder>.controller";
import { <ContextName>Repository } from "./<context-folder>.repository";
import { <ContextName>Service } from "./<context-folder>.service";

@Module({
  controllers: [<ContextName>Controller],
  providers: [<ContextName>Repository, <ContextName>Service],
  exports: [<ContextName>Service],
})
export class <ContextName>Module {}
```

### Step 6 — Register in app.module.ts

File: `backend/src/app.module.ts`

Add import and add `<ContextName>Module` to the `imports` array.

### Step 7 — DTOs (if endpoints need request bodies)

Create `backend/src/<context-folder>/dto/` with class-validator DTO files as needed. Follow the pattern in `backend/src/wb-sync/dto/`.

### Step 8 — Verify

- Run `npm run typecheck` from repo root — no new errors.
- All providers listed in `providers` must be decorated with `@Injectable()`.
- All constructor params must use `@Inject(Token)` pattern.

---

## Rules that apply

- **Bounded context isolation**: do NOT import from other context modules except through `exports` — use `imports: [OtherModule]` if cross-context data is needed.
- **No business logic in controllers**: route, DTO, guard boundary, response code only.
- **No direct SQL in service**: delegate to repository.
- **Secrets in env**: use `appEnv` from `backend/src/common/env.ts`, never hardcode URLs or keys.
- After creating the module, update `docs/module-map.md` with a one-line entry for the new context.
