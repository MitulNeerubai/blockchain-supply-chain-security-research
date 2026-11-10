// app.cjs — startup file for cPanel "Setup Node.js App" (Phusion Passenger).
//
// cPanel starts this automatically (and restarts it after crashes / reboots),
// so nobody has to run `npm run server` by hand. It loads:
//   • server.js   — email verification API at /api (and static files)
//   • notifier.js — event emails + optional auto-revert keeper
//
// Passenger can only start CommonJS files, while this project uses ES modules,
// hence the dynamic import() calls. Set RUN_NOTIFIER=0 to run the API only.

import('./server.js').catch(e => { console.error('[app] server.js failed to start:', e); process.exit(1) })

if (process.env.RUN_NOTIFIER !== '0') {
  import('./notifier.js').catch(e => console.error('[app] notifier.js failed to start (API still running):', e.message))
}
