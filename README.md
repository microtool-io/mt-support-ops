# mt-support-ops

A local workspace for organizing B2B customer support operations by business department. Define each department's customer support remit, record updates, and ask its managing agent about that work. A new workspace starts empty. The optional templates are editable starting points.

## Start locally

Use Node.js 24.14 or later in the 24.x series. There are no npm packages to install.

```sh
npm start
```

Open **http://127.0.0.1:4318** on the same computer. Select **New department** or choose a template. Enter its name and support remit, then create it. Open its sidebar entry to add an update. The server serves all application assets, including fonts, locally.

## Connect a model

The shell works with a provider that implements `GET /v1/models` and `POST /v1/chat/completions` with non-streaming text responses. Fresh workspaces start disconnected. Creating a department or recording an update makes no model request.

- **Local Ollama.** Start Ollama with an installed chat model. For strictly local inference use a locally installed model and run the service with cloud features disabled. The default model endpoint is `http://127.0.0.1:11434/v1`. Open **Model connection**, select **Find models**, select your model, and choose **Connect model**. [Ollama API compatibility](https://docs.ollama.com/api/openai-compatibility)
- **Company or hosted endpoint.** Copy `.env.example` to the ignored file `.env.local`, restrict it with `chmod 600 .env.local`, and supply the approved HTTPS base URL and its matching server-side API key. Alternatively inject both through the process environment. Restart the shell and connect the model in the UI. Keep production credentials in your company secret manager. Browser requests cannot supply or override the endpoint or key.

**Find models** contacts the configured endpoint for its catalog. **Connect model** checks the catalog and saves the selected endpoint/model pair. A change of endpoint requires a matching selection. **Disconnect** stops new questions from being submitted. An already-submitted request may finish.

**Ask manager** submits the current department's name, manager, remit, up to 12 recent updates, up to three prior exchanges, and the new question. Long entries are excerpted. It records the answer, model ID, and timestamp in the same department on success. The model receives no tool definitions. It can produce inaccurate text. Responses appear as plain text and require a person to take any action.

## Data and operating boundary

This version is a single-user local shell. The HTTP listener binds only to IPv4 loopback and checks the Host, mutation Origin and JSON content type. Any process with access to the user's local account can potentially access the workspace. Department separation limits the context sent to models. All departments are accessible to the local user.

SQLite records persist between launches. On macOS the database lives under `~/Library/Application Support/microtool/mt-support-ops/`. Elsewhere the default is `$XDG_DATA_HOME/microtool/mt-support-ops/` or `~/.local/share/microtool/mt-support-ops/`. Set `MT_DATA_DIR` to an absolute path for a separate workspace. Secrets stay in the server environment. Use an encrypted disk for sensitive data. To back up the local workspace, stop the app and copy the whole data directory to private backup storage. Restore the copy with the app stopped.

Keep this version on the local machine. A shared company subdomain requires a separate deployment design covering HTTPS and staff SSO, server-enforced authorization, an audit trail, retention, and tested backup and recovery. The repository contains application code and fictional examples only. Keep company configuration and records outside it.

## Development

```sh
npm test
```

Tests use isolated SQLite databases and a loopback model stub. Run `PORT=4319 MT_DATA_DIR=/absolute/path/to/test-data npm start` to try a separate workspace. Source is MIT licensed. Instrument Sans is bundled under the SIL Open Font License in `public/fonts/OFL.txt`.
