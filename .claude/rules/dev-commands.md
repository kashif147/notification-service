# Commands

```bash
npm run dev             # nodemon, watches everything
npm start                # plain node start
npm run start:dev        # NODE_ENV=development
npm run start:staging    # NODE_ENV=staging
npm run start:prod       # NODE_ENV=production
npm run seed:notification-template  # seed a system-default admin grid filter template
```

`npm test` is a no-op stub (`exit 1`) — there is no test suite, don't invent commands for one.

Runs on port `4010` by default. See `docs/SOCKET_IO.md` for a deep dive on the Socket.IO layer
specifically (rooms, events, and a documented nginx WebSocket-proxy gotcha) — read it before
touching `bin/notification-service.js`'s socket setup.

Uses `dotenv-flow` — environment-specific files (`.env.development`, `.env.staging`,
`.env.production`) load based on `NODE_ENV`; production is expected to get its env from Azure
Application Settings instead (see the guard in `app.js`).
