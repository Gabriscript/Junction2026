// Vercel entrypoint of the assistant service: the self-contained bundle written by `vercel-build` (scripts/bundle-vercel.ts).
module.exports = require('./dist/server.cjs').default;
