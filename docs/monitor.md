# Tmux agent monitor

`/monitor` opens a separate tmux session with one live pane per subagent and advisor of the current session. Each pane shows the same transcript as the [Agent Hub](./agent-hub.md) viewer, including output that has not been saved yet. You can message a subagent from its pane. Advisor panes are view only.

The monitor needs the session to run inside tmux and the [control socket](./control.md) to be enabled.

```
/monitor on       # start (also the default with no argument)
/monitor status   # session name and panes
/monitor off      # close the monitor's panes
```

`/monitor on` prints the session name. Attach to it from another terminal with `tmux attach -t npi-monitor-<id>`. The monitor never attaches clients, resizes, or switches the window you are working in, and starting it does not change what the main session shows.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `monitor.tmux.autoStart` | `false` | Start the monitor whenever an interactive session opens inside tmux |
| `monitor.tmux.includeAdvisors` | `true` | Give advisors their own view-only panes |
| `monitor.tmux.maxPanesPerWindow` | `6` | Tiled panes per window before the monitor opens another window |

## Panes

A pane opens when an agent is registered and the panes of each window are tiled. A pane stays while its agent is parked or aborted. It closes when the agent is released or replaced by a new agent with the same id, and a replacement gets a new pane. If you close a pane yourself (`Esc`, `Ctrl+C`, or killing the tmux pane), the monitor does not reopen it for that agent. A pane that ends any other way, for example because its attach failed or crashed, is reopened, up to three times per agent.

The monitor kills only panes it created. A pane or window you add to its session stays when the monitor stops; the next `/monitor on` then uses `npi-monitor-<id>-2`.

In a pane:

- The header shows the owner session, the connection state (`live`, `reconnecting…`, or `ended: <reason>`), `view only` for advisors and aborted agents, and notices.
- Typing a message and pressing Enter works as in the Agent Hub: a parked subagent is revived, a running one is steered, and an idle one is prompted. Advisors and aborted agents have no input.
- `Esc` with an empty input, or `Ctrl+C`, closes the pane. There is no way from a pane to the main session, slash commands, kill, or revive.

If the socket drops, the pane reconnects while the owner process is alive. When the owner exits, or its session is replaced with `/new` or a resume, every pane shows why it ended and closes after three seconds. A new session gets new panes.

## Attaching by hand

`npi monitor attach <session> --agent <id>` opens the same pane in any terminal for one agent of a running session. `<session>` is any `npi ctl` selector. The command asks the owner for a capability for that one agent, which requires the same access as `npi ctl`.

## Access and limits

Each pane gets a capability for one agent, minted by the owner and passed in a private file that the pane deletes after reading it. A pane never sees the control token. What a pane connection can do is described in [Control socket](./control.md#monitor-connections).

Saved transcript entries arrive in 256 KiB reads. An entry larger than that arrives whole up to 4 MiB. A larger entry is reported in the pane as too large to show. Unsaved output is sent at most every 80 ms and paused while the pane is not reading. When the unsaved state exceeds 2 MiB, tool progress is dropped first, then the assistant preview, and the header says so until the message is saved.
