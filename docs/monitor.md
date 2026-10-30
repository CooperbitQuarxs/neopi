# Tmux agent monitor

`/monitor` opens a separate tmux session with one live pane per subagent and advisor of the current session. Each pane shows the same transcript as the [Agent Hub](./agent-hub.md) viewer, including output that has not been saved yet. You can message a subagent from its pane. Advisor panes are view only.

The monitor needs the session to run inside tmux and the [control socket](./control.md) to be enabled.

```
/monitor on          # start (also the default with no argument)
/monitor status      # session name and panes
/monitor configure   # persistent layout and monitor settings
/monitor off         # close the monitor's panes
```

`/monitor on` prints the session name. Attach to it from another terminal with `tmux attach -t npi-monitor-<id>`. The monitor never attaches clients, resizes, or switches the window you are working in, and starting it does not change what the main session shows.

## Settings

`/monitor configure` opens the standard keyboard/Vim-friendly menus. Choose presets or **Custom…** to type any positive safe integer. Counts also offer **infinite**; dimensions offer **dynamic**. The same controls are in `/settings`, under **Interaction → Agent monitor**. Settings persist in the global config, with the usual project/config overrides.

| Setting | Default | Meaning |
| --- | --- | --- |
| `monitor.tmux.autoStart` | `false` | Start the monitor whenever an interactive session opens inside tmux |
| `monitor.tmux.includeAdvisors` | `true` | Give advisors their own view-only panes |
| `monitor.tmux.maxRows` | `"2"` | Maximum rows per window, or `"infinite"` |
| `monitor.tmux.maxColumns` | `"infinite"` | Maximum columns per window, or `"infinite"`; columns are unlimited by default |
| `monitor.tmux.fillOrder` | `"rows-first"` | Fill rows within each column first, or `"columns-first"` to fill columns within each row first |
| `monitor.tmux.growth` | `"fallback"` | Switch axis at the preferred finite limit; `"alternate"` alternates completed edges when both counts are infinite |
| `monitor.tmux.direction` | `"down-right"` | Grow down and right, or `"up-left"` for mirrored placement |
| `monitor.tmux.rowHeight` | `"dynamic"` | Equalize row heights, or a positive integer string for a fixed height in terminal cells |
| `monitor.tmux.columnWidth` | `"dynamic"` | Equalize column widths, or a positive integer string for a fixed width in terminal cells |

Counts and dimensions are stored as strings, including numeric values: for example, `"maxRows": "4"` and `"columnWidth": "80"`. They accept positive safe integers only, not zero, negative values, fractions, or sentinel numbers. Use the explicit words `infinite` for quantities and `dynamic` for dimensions.

### Layout behavior

By default, the monitor fills two rows down each column, then opens the next column. **Columns are infinite by default**: six panes are no longer a per-window limit. A new monitor window opens only when **both configured finite row and column limits** are full. Running out of terminal space does not implicitly enable window overflow.

- **Full-height columns:** set maximum rows to `1`, and maximum columns to `infinite` (or a finite column limit if you want window overflow).
- **Fixed columns, growing rows:** set maximum columns to the desired count, maximum rows to `infinite`, and fill order to `columns-first`.
- **Bounded grid:** set both counts to positive integers; rows-first fills each column before moving across, while columns-first fills each row before moving down.
- **Unbounded alternating grid:** set both counts to `infinite` and growth to `alternate`. The fill order chooses whether the first new edge is a row or column. Each new edge fills to the grid's current other dimension before the next axis grows. Direction chooses down/right or the mirrored up/left placement. With fallback instead, an infinite preferred axis never fills, so it remains a single growing stack or row.

Dynamic dimensions equalize the available space as panes are created. Fixed row heights and column widths are **transcript terminal cells**, not monitor pixels; titles and separators take additional cells. A fixed axis can make the monitor window larger than an attached terminal. Either dimension can remain dynamic independently. When even dynamic panes no longer fit, the monitor enlarges its own window rather than opening an unrequested overflow window; tmux's physical limit is 32767 cells per axis.

Changes are read on the next pane creation. After changing counts, fill order, growth, or direction, use `/monitor off` then `/monitor on` to redistribute all existing agents consistently.

Automatic **relative** sizing from monitor dimensions and zoom level is deferred to [#433](https://github.com/PsychedelicShayna/neopi/issues/433); it is not a manual-layout option.

## Panes

A pane opens when an agent is registered, using the configured layout. A pane stays while its agent is parked or aborted. It closes when the agent is released or replaced by a new agent with the same id, and a replacement gets a new pane. If you close a pane yourself (`Esc`, `Ctrl+C`, or killing the tmux pane), the monitor does not reopen it for that agent. A pane that ends any other way, for example because its attach failed or crashed, is reopened, up to three times per agent.

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
