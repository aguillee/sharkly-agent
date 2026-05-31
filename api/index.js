// api/index.js
//
// Vercel serverless entrypoint — re-exports the Express app from server.js.
// All routes (/api/info, /api/chat) are handled by the same Express instance
// thanks to vercel.json rewriting /api/* → /api.

export { default } from '../server.js';
