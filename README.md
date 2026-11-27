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

## Check a HubSpot connection

Use a HubSpot developer test account with Help Desk set up and sample data. A
HubSpot Super Admin or a user with Developer tools access can create a [Service
Key](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys)
under **Development → Keys → Service Keys**. Give it a descriptive name such as
`mt-support-ops sandbox` and select only `conversations.read`. The label is for
your own reference. This scope can also read conversations. The app's check
requests only inbox metadata.

Stop the existing local server with Ctrl+C. From the repository root, run this
command and paste the key at the hidden prompt.

```sh
bash -c 'read -r -s -p "HubSpot Service Key: " HUBSPOT_SERVICE_KEY || exit 1
printf "\n"
export HUBSPOT_SERVICE_KEY
exec npm start'
```

Open <http://127.0.0.1:4318> and choose **Settings → Connections → Test connection**.
A successful check shows **Connected to Help Desk** and adds a **HubSpot**
heading below **Business areas** in the sidebar. The app also checks once when
the page loads. If HubSpot is reachable
and no Help Desk inbox appears, check that Help Desk is set up in the account
that issued the key.

The application also starts without a key. For a managed installation, the
server process reads `HUBSPOT_SERVICE_KEY` from its environment, which a host's
secret manager can supply. Keep the value out of the repository, browser
configuration, and logs. To rotate it, replace the server secret and restart
the app, then test the new key before expiring the old one in HubSpot. Delete
an unused key from **Service Keys** in HubSpot.

## Run the tests

From the repository root, run the storage, HubSpot, and shell checks. The storage
and shell checks use temporary data directories. The HubSpot tests use mocked
responses and need no key. The port override lets the smoke test run alongside
the local preview.

```sh
node --test
PORT=14319 bash scripts/smoke-test.sh
```

## Collapse and expand motion

Use `var(--motion-collapse-expand)` as the timing for collapse and expand transitions, for example `transition: inline-size var(--motion-collapse-expand)`. The default in [style.css](public/style.css) is 240 ms with `cubic-bezier(0.4, 0, 0.2, 1)`. It becomes instant when the user prefers reduced motion. [View the recorded sidebar transition](docs/sidebar-motion.gif).
