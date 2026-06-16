<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Agent Rules

## Communication Language
- All communication with users must be in **Chinese (Simplified)**.
- Code comments, commit messages, and documentation may use English where appropriate for technical clarity.

## Documentation First
- Before making changes to Next.js-related code, **always read the relevant guide** in `node_modules/next/dist/docs/`.
- Check for deprecation notices and breaking changes specific to this Next.js version.
- Do not rely on training data for Next.js APIs — this version may differ significantly.

## Protect User Changes
- **Before any destructive operation** (e.g., applying patches, resetting files), check `git status` and preserve uncommitted changes.
- Use `git stash` if necessary to protect work-in-progress.
- Never overwrite user modifications without explicit confirmation.

## Database Changes Require Confirmation
- Any change to `prisma/schema.prisma` must be **confirmed by the user** before running `db:push` or `db:migrate`.
- Explain the migration impact clearly (new fields, data loss risk, breaking changes).
- After schema changes, always run `npm run db:generate` to update Prisma Client.

## Verification Commands
Before marking any task as complete, run the following verification commands:

```bash
npm run lint          # ESLint check
npm test              # Run test suite
npx tsc --noEmit      # TypeScript type check
npm run build         # Production build
```

All commands must pass without errors.

## Commit Message Convention
This project follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

### Format
```
<type>[optional scope][optional !]: <description>

[optional body]

[optional footer(s)]
```

### Common Types
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files
- `revert`: Reverts a previous commit

### Examples
```
feat: add Chinese localization for product extraction
fix(api): handle null values in product search
docs: update backfill guide with troubleshooting steps
chore: add commitlint and husky for commit validation
refactor(extraction)!: change AI prompt structure

BREAKING CHANGE: extraction schema now requires Chinese fields
```

### Breaking Changes
- Use `!` after the type/scope to indicate a breaking change: `feat!:` or `feat(api)!:`
- Or include `BREAKING CHANGE:` in the commit body or footer

### Enforcement
- Commit messages are validated by a local `commit-msg` hook using `commitlint`.
- Non-conforming commits will be rejected.

## Development Workflow
1. Read relevant Next.js docs before coding
2. Make changes with proper commit messages
3. Run verification commands
4. Test locally with `npm run dev`
5. Get user approval before pushing

## Agent Responsibilities
- Preserve user work
- Validate before committing
- Communicate in Chinese
- Follow Conventional Commits
- Read docs before changing Next.js code
