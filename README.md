# mt-support-ops

A B2B customer support operations workspace where you can create a named business area and reopen it from the sidebar.

This milestone is for local evaluation with sample names. The API listens on loopback
and has no user authentication. Before sharing a deployment, configure and test
server-side access controls and backup restoration.

## Run locally

Use Node.js 24.14.0 or newer within the 24.x series, with npm. You can skip `npm install` because the shell has no package dependencies.

```sh
git clone https://github.com/microtool-io/mt-support-ops.git
cd mt-support-ops
npm start
```

Open <http://127.0.0.1:4318>. Click **+** beside **Business areas**, enter a sample name, and choose **Create area**. Refresh and select the saved area in the sidebar to reopen it. Press Ctrl+C in the terminal to stop the server.

Opening `public/index.html` directly previews the shell. Saving and loading business areas requires the server.

## Business area storage

Run the server to create and reopen business areas. Each installation stores its areas in
`areas.sqlite` under `~/.local/share/mt-support-ops` by default. To choose another
location, set `MT_DATA_DIR` to an absolute path outside the checkout. Use a dedicated,
persistent local directory private to the server account (0700 on Unix). Keep that
path when replacing or updating the application. Give independent installations
different directories. Area names accept up to 100 UTF-16 code units after trimming.

## Run the tests

From the repository root, run the storage test and the shell smoke test. Both use temporary data directories. The port override lets the smoke test run alongside the local preview.

```sh
node --test test/areas.test.js
PORT=14319 bash scripts/smoke-test.sh
```

## Collapse and expand motion

Use `var(--motion-collapse-expand)` as the timing for collapse and expand transitions, for example `transition: inline-size var(--motion-collapse-expand)`. The default in [style.css](public/style.css) is 240 ms with `cubic-bezier(0.4, 0, 0.2, 1)`. It becomes instant when the user prefers reduced motion. [View the recorded sidebar transition](docs/sidebar-motion.gif).
