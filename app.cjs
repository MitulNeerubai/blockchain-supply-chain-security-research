// app.cjs — startup file for cPanel "Setup Node.js App" (Phusion Passenger).
//
// cPanel starts this automatically (and restarts it after crashes / reboots),
// so nobody has to run `npm run server` by hand. It loads:
//   • server.js   — email verification API at /api (and static files)
//   • notifier.js — event emails + optional auto-revert keeper
//
// Passenger can only start CommonJS files, while this project uses ES modules,
// hence the dynamic import() calls. Set RUN_NOTIFIER=0 to run the API only.

// A dropped blockchain connection in the notifier must never take the email API
// down with it: log the error and keep running instead of crashing the process.
process.on('unhandledRejection', e => console.error('[app] unhandled rejection (kept running):', e?.shortMessage || e?.message || e))
process.on('uncaughtException', e => console.error('[app] uncaught exception (kept running):', e?.shortMessage || e?.message || e))

import('./server.js').catch(e => { console.error('[app] server.js failed to start:', e); process.exit(1) })

if (process.env.RUN_NOTIFIER !== '0') {
  import('./notifier.js').catch(e => console.error('[app] notifier.js failed to start (API still running):', e.message))
}
