# typescript-scaffold

## Objective

- Convert the repository scaffold from a JavaScript placeholder into a minimal TypeScript scaffold.
- Add the TypeScript toolchain, a buildable and runnable entrypoint, and a basic test.

## Constraints

- Keep the current documentation and harness structure intact.
- Do not implement webhook runtime behavior in this change.
- Keep the runtime small: a single `Hello, world!` placeholder is enough.

## Steps

1. Add TypeScript tooling and scripts in `package.json` plus a repo-level `tsconfig.json`.
2. Replace the JavaScript entrypoint with a TypeScript `Hello, world!` implementation and add a basic TypeScript test.
3. Update the architecture checker and docs so the verification loop matches the TypeScript scaffold.

## Verification

- `npm run check`
- `npm start`

## Notes

- The scaffold should compile TypeScript before tests in the main check loop.
- The architecture checker must understand `.ts` imports.
