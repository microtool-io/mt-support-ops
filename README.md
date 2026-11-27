# mt-support-ops

A B2B customer support operations workspace where you can create a named business area and reopen it from the sidebar.

This milestone is for local evaluation with sample names. The API listens on loopback
and has no user authentication. Before sharing a deployment, configure and test
server-side access controls and backup restoration.

## Run locally

On Windows, macOS, and Linux, use Node.js 24.14.0 or newer within the 24.x series, with npm. You can skip `npm install` because the shell has no package dependencies.

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

### Company-managed installation

Store the company's own Service Key in its deployment secret manager. Configure
the service to inject it as `HUBSPOT_SERVICE_KEY` at every start, grant secret
access only to the app's service identity and authorized administrators, and
use the standard `npm start` command. Keep separate credentials for test and production. Without a configured
key the workspace starts with HubSpot disconnected.

### Verify and rotate

Open <http://127.0.0.1:4318> and choose **Settings → Connections → Check connection**.
A successful check shows **Help Desk inbox found** with the local time of the check and adds a **HubSpot**
section below **Business areas** in the sidebar. Select **Help Desk Responder**
to open its empty workspace. The app also checks once when
the page loads. If HubSpot is reachable
and no Help Desk inbox appears, check that Help Desk is set up in the account
that issued the key.

Keep the value out of the repository, browser
configuration, and logs. To rotate it, replace the server secret and restart
the app, then test the new key before expiring the old one in HubSpot. Delete
an unused key from **Service Keys** in HubSpot.

## Run the tests

From the repository root, run the storage, HubSpot, and shell checks. The storage
and shell checks use temporary data directories. The HubSpot tests use mocked
responses and need no key. The startup check uses an available loopback port.

```sh
node --test
```

## Collapse and expand motion

Use `var(--motion-collapse-expand)` as the timing for collapse and expand transitions, for example `transition: inline-size var(--motion-collapse-expand)`. The default in [style.css](public/style.css) is 240 ms with `cubic-bezier(0.4, 0, 0.2, 1)`. It becomes instant when the user prefers reduced motion. [View the recorded sidebar transition](docs/sidebar-motion.gif).
