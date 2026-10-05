# The resident process

DD requires one background process per machine, shared by every project and session: the resident. It
holds a multilingual embedding model (`Xenova/multilingual-e5-small`, through `@huggingface/transformers`)
and answers the hooks, the MCP `retrieve` tool and the audit UI for each project from that project's own
store and data directory. **Until it is running with its model loaded, DD is inactive**: nothing is
recalled, and the session's first message says why. DD never blocks the harness.

## Lifecycle

- **Who starts it.** The first session or MCP server that finds none starts it in the background. It is
  recorded in `~/.dd-data/resident.json` and outlives the sessions that use it. A session start that
  launches one waits up to 5 seconds for it to listen, about one second in practice. That session already
  shows the audit UI address and says the model is loading. Loading takes longer; the first prompt after
  it is ready says DD is active.
- **First run.** The first session on a machine downloads the model, about 130 MB, into the `models/`
  directory of DD's data directory.
- **Where the address appears.** Every session start that reaches the resident shows the audit UI address
  and asks the model to relay it. A session that began before the resident listened gets it once, on its
  first prompt the resident answers.
- **Several projects.** Each project is opened the first time one of its hooks asks, with its own SQLite
  store. The model is loaded once for all of them. The audit UI is per project,
  `http://127.0.0.1:<port>/?project=<key>`; without `?project=` the page lists the open projects.
- **Several installs.** Installs of one version share one resident: a plugin in two harnesses, or a plugin
  and an npm install. A resident whose code changed since it started, or of an older version, is replaced
  at the next session start or prompt. One of a newer version is kept, and the older install says it is
  inactive until it is updated.
- **Shutdown.** It exits after 12 hours without hook traffic.

## Cost

- **Memory.** About 640 MB of RAM with the model loaded, plus little per open project; two projects
  measured 724 MB.
- **Disk.** About 480 MB for the runtime and 130 MB for the model, downloaded once.
- **Speed.** A query takes a few milliseconds.

## When DD says it is inactive

Check in this order:

1. **Is the model still loading?** On the first run it is downloading; DD turns on by itself when it is
   ready.
2. **Is it running?** Open the `url` in `~/.dd-data/resident.json` and request `/api/resident`. Its
   `retrieval` field reads:
   - `semantic` when it is ready;
   - `loading` while the model loads;
   - `unavailable` when the model could not be loaded.

   `stale: true` means its code changed; the next prompt or session start replaces it.
3. **Start it by hand:** `deltadictum resident`, or `node <dd>/src/cli.js resident` from a checkout. It says
   so and exits if a current one is running.
4. **`retrieval: unavailable`.** The embedding runtime is missing or cannot run here. Reinstall DD's
   dependencies. Platforms without prebuilt ONNX binaries, such as Alpine/musl, cannot run DD.
5. **It never stays up.** Run `deltadictum resident` in a terminal and read the error. The usual causes are
   a blocked port range 7733-7742 or a read-only `~/.dd-data`.
6. **Node is too old.** DD needs Node.js 22.16 or later (`node:sqlite` with FTS5). On an older Node the
   session start says so.

The [environment variables](configuration.md#machine-settings-environment-variables) `DD_RESIDENT`,
`DD_RETRIEVAL` and `DD_EMBED_MODEL` change how the resident starts; restart it after changing them.
