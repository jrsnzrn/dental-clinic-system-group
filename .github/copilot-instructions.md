# Workspace Instructions

## Project Structure
- The browser app is a React 19 + Vite application. Pages are in `src/pages/`, reusable UI is in `src/components/`, and shared helpers are in `src/utils/`.
- Firebase client initialization and shared service exports live in `src/firebase.js`.
- Cloud Functions are a separate Node.js package under `functions/`.

## Conventions
- Follow the style and existing component patterns of the file being changed. The app uses JavaScript/JSX and CSS; avoid introducing TypeScript or new dependencies unless the task needs them.
- Keep changes scoped to the relevant page, component, utility, or function. Reuse existing helpers and UI components where practical.
- Treat Firebase Authentication and client-side role checks as UI controls, not authorization boundaries. Enforce access in Firestore Security Rules or trusted Cloud Functions as appropriate.
- Firebase browser configuration is read from `VITE_*` environment variables. Never hard-code credentials or expose secrets in client code; do not overwrite local `.env` values.

## Verification
- From the repository root, run `npm run lint` and `npm run build` for frontend changes.
- For Cloud Functions changes, inspect `functions/package.json`; its `lint` script is currently a placeholder, so do not treat it as a real lint check.
- No test script is currently defined in the root package.