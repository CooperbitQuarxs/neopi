# Control socket

Every npi process publishes a same-user Unix socket under `~/.omp/run/control-sessions` so one session can drive the others. `npi ctl` and the `ctl` tool speak that socket. They never spawn a session and they never inject keystrokes with tmux.

```
npi ctl list
npi ctl %3 state
npi ctl %3 send "Reply with exactly: PONG"
npi ctl %3 steer "stop and summarize"
npi ctl %3 abort
npi ctl %3 slash "/fast on"
npi ctl %3 action app.model.select
npi ctl %3 keys escape
npi ctl %3 dialog_answer <id> '{"index":0}'
```

Read `state` before a write. Pass `if` revisions on draft and surface commands. A stale revision is `conflict` and the pane shows `⌁ <label> backed off`. Retry only after re-reading state. Do not use `tmux send-keys` on npi panes.

`app.suspend`, `app.exit` (which would close the socket before replying), external `$EDITOR`, and `/todo edit` are exempt and return an explicit `exempt_*` error. `app.clear` clears the composer without entering the human Ctrl-C double-press shutdown path. Everything else a human can do from the keyboard is reachable by `input`, `keys`, `action`, or a structured twin (`set_model`, `settings_set`, `dialog_answer`).

`commands` includes the pane's TUI-only slash commands and aliases as well as RPC commands. `get_available_models` uses protocol-v2 chunking when its full catalog exceeds one transport frame.

The `hello`, `get_status`, and `state` snapshots carry `session`: the same RPC session state `get_state` returns, minus the `systemPrompt` and `dumpTools` dump fields, so a snapshot stays one frame. `state` with `target: "view"` reports the subagent the pane is focused on and adds `root` (the root session id and generation); with nothing focused, or with the default `target: "root"`, it reports the root session.

`get_subagents`, `get_subagent_messages`, `cancel_subagent`, `steer_subagent`, and `set_subagent_subscription` use the process's live subagent registry. Every connection sees the same roster, including subagents that started before it connected. `set_subagent_subscription` is per connection: lifecycle and progress frames (and, at `events`, raw subagent events) go only to connections that asked for them.

Disable publishing with `--no-control-socket` or `control.enabled=false`.
