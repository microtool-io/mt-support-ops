# mt-support-ops

A B2B customer support operations workspace where you can create a named business area and reopen it from the sidebar.

This milestone is for local evaluation with sample names and a HubSpot test account. The API listens on loopback
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
to open its workspace. The app also checks the connection when the page loads. If HubSpot is reachable
and no Help Desk inbox appears, check that Help Desk is set up in the account
that issued the key.

Keep the value out of the repository, browser
configuration, and logs. To rotate it, replace the server secret and restart
the app, then test the new key before expiring the old one in HubSpot. Delete
an unused key from **Service Keys** in HubSpot.

## Try the Help Desk Responder infeed

1. In **Help Desk Responder**, select the **Infeed** row to open **Tickets**. **Hold for manual release** starts on. Return to **Help Desk Responder** and switch **Infeed** on.
2. Send a fresh test message through a channel connected to the sandbox Help Desk so HubSpot creates a new ticket and conversation. Use a new conversation for each test. A manually created CRM ticket without an incoming conversation is outside this infeed.
3. Open **Tickets**. While Infeed is on, the running server checks HubSpot every 30 seconds, even with the browser closed. The page refreshes the queue every five seconds. Select a ticket number to read an incoming plain-text message and inspect the prepared action.

| Infeed at arrival | Hold at arrival | Local result |
| --- | --- | --- |
| Off | Either | Skip the ticket. |
| On | On | Show **Held**. Selecting **Release** prepares the internal note “AI checked, released from block manually”. |
| On | Off | Prepare the internal note “AI checked” automatically. |

Arrival is the time of the first incoming customer message in the ticket’s first linked conversation. A thread can start with an outgoing message. The first customer reply then determines which Infeed and Hold settings apply. Spam, archived threads and regular inboxes are excluded. The ticket ID prevents duplicate decisions across retries and restarts.

The server reads Help Desk activity in timestamp order. Each inbox saves its page cursor and the queued thread IDs together in the private installation database. Scans overlap by 15 minutes. Once discovered, a conversation awaiting its ticket link stays in the queue beyond that window. The server retries it with increasing delays of up to one hour while Infeed is on. Turning Infeed off pauses polling and preserves the queue. Existing ticket decisions survive settings changes and upgrades.

The app makes read-only Conversations API calls. The note text is a proposed action. This version does not run an AI check, post a note, send a reply, or change the HubSpot ticket status. Ticket and thread IDs, arrival times, settings and decisions persist in the installation’s private SQLite database. The panel loads message text on demand and displays up to 8,000 characters. Keep a separate data directory per HubSpot account and restrict access to the server and its backups.

## Run the tests

From the repository root, run the storage, HubSpot, and shell checks. The storage
and shell checks use temporary data directories. The HubSpot tests use mocked
responses and need no key. The startup check uses an available loopback port.

```sh
node --test
```

## Collapse and expand motion

Use `var(--motion-collapse-expand)` as the timing for collapse and expand transitions, for example `transition: inline-size var(--motion-collapse-expand)`. The default in [style.css](public/style.css) is 240 ms with `cubic-bezier(0.4, 0, 0.2, 1)`. It becomes instant when the user prefers reduced motion. [View the recorded sidebar transition](docs/sidebar-motion.gif).
