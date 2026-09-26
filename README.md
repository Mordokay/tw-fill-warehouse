# Fill Warehouse – Tribal Wars script

Fills the current village's warehouse to a chosen percentage using resources from a set of source villages you pick. Closest sources are used first, and each send is one click.

Built for world **pt117** (`https://pt117.tribalwars.com.pt`) to speed up developing new villages. Before this script existed, the routine was: go to each developed village → market → work out by hand what to send so that the small village's warehouse ends up 80–90% full → repeat for every small village.

---

## ⚠️ Status: not approved yet

- The Tribos PT rules say *"Todos os scripts tem de ser aprovados pela equipa de suporte"* (all scripts must be approved, private ones included) and *"Os scripts podem apenas efetuar uma ação por clique"* (one action per click). See the [PT rules](https://www.tribalwars.com.pt/page/rules).
- pt117 opened around late August 2026. That is after April 2026, so it has the new **Script Library** (*Configurações → Biblioteca de scripts*). There is currently a grace period in which previously approved external scripts are still allowed. When it ends, only scripts in the Library will be legal ([InnoGames FAQ](https://support.innogames.com/kb/TribalWars/en_DK/6023)).
- This script was never approved, so the grace period doesn't cover it. **Using it on pt117 before it is approved breaks the rules and risks a ban.**
- On 2026-09-26 we prepared a support ticket asking for approval or for the correct procedure (text below). Check the ticket's outcome before using the script.
- To test further or change the script, use the beta server **zz1**. Script Library submissions are also made there.
- Approved alternatives to use in the meantime: Shinko to Kuma's [Warehouse Balancer](https://shinko-to-kuma.com/script-details.php?scriptID=1), and the request script ([Request resources to HQ](https://shinko-to-kuma.com/script-details.php?scriptID=19)). Check that they appear on the PT approved list or in the Script Library on pt117.

### Support ticket (as prepared)

Where: in-game **Configurações → Pedido de suporte**, or <https://support.innogames.com/connect/tribalwars/pt/pt_PT>
Categoria: **Perguntas** (not "Infracção de regras", which is for reporting other players) · Mundo: **pt117**

**Subject:** `Private script approval request – Fill Warehouse (pt117)`

```
Hello,

I would like to request approval (private use) for a market script on world pt117, or to be told the correct procedure to submit it (for example, through the Script Library).

Script name: Fill Warehouse
Source code (not obfuscated): https://github.com/Mordokay/tw-fill-warehouse/blob/main/fillWarehouse.js
Quickbar entry: javascript:$.getScript('https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js');

What it does:
- It runs on the current village (an underdeveloped village).
- It reads the production overview and the incoming transports overview to get each village's resources, warehouse capacity and available merchants.
- It calculates how much each of my source villages (which I choose in a settings window) should send to fill the current village's warehouse up to a set percentage (for example 85%), prioritising the closest villages and leaving a minimum percentage in each source village.
- It shows a list of proposed transports. Each transport is only sent when I click its "Send" button: one click = one action (one market send).

What it does not do:
- It does not send anything automatically or in bulk; every transport is a separate click.
- It does not communicate with any external server; it only makes requests to the game itself (overview pages and the market send). jsDelivr is only used to load the file.
- Settings are stored only in the browser's localStorage.

It works similarly to scripts already approved on other markets, such as Shinko to Kuma's "Request resources" and "Resource sender".

I will not use the script until I receive a response.

Thank you,
[your player name]
```

(If you prefer, replace the "I will not use the script…" line with: *"I would appreciate a quick answer, as I would like to use it on my current account."*)

---

## Installing (quickbar)

In the game, go to **Configurações → Editar barra de acesso rápido → Adicionar novo link**:

| Field | Value |
|---|---|
| Nome da entrada | `Fill Warehouse` |
| Dica | optional |
| URL da imagem | empty |
| URL de destino | `javascript:$.getScript('https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js');` |
| Abrir numa nova janela | unticked |

**Atribuir** lets you give it a keyboard shortcut, which is handy when going village by village.

## Using it

1. Go to an underdeveloped village and click the quickbar entry. It works from any screen.
2. The first time (when no sources are saved), the **Settings** window opens. Tick your developed villages and set the percentages.
3. The panel shows:
   - **In village / Incoming / Goal / Still missing after plan**, one number per resource.
   - A list of proposed sends, closest source first. Press **Enter** repeatedly: each press sends one row, and focus moves to the next.
   - A **Skipped source** table explaining why a source couldn't help, showing the resources, warehouse and merchants the script read for it.
4. Click **Next village →**. The panel stays open: it re-reads both overviews (so the sends you just made are counted) and switches to the next village, in your overview order, that is **not a source** and is still below the goal. The game page itself doesn't change. Use **(open village)** next to the name if you want the game to go to that village (that reloads the page and closes the panel).
5. When every non-source village is at the goal, you'll see *All non-source villages are at the goal.*

Running it again on the same village is safe. Transports already on the way are counted as Incoming, so nothing is sent twice.

## Settings

Settings are stored in `localStorage` under `fillWH_<world>_<playerId>`, so each world has its own and they persist between sessions. They are per browser, so on a new browser or computer you'll have to set them up again.

| Setting | Default | Meaning |
|---|---|---|
| Fill target warehouse to (%) | 85 | Goal per resource = warehouse capacity × % |
| Keep at least this % in source villages | 20 | A source never goes below this % of **its own** warehouse, per resource. The user found 10% works better for their villages. |
| Resources per merchant | 1000 | Merchant carrying capacity |
| Skip sends smaller than | 1000 | Don't propose a send whose total is below this. Also stops planning once the remaining need falls below it. |
| Source villages | none | Ticked villages, stored as village IDs. The current village is never used as a source, even if ticked. |

---

## How it works

Everything is in a single file, `fillWarehouse.js`, wrapped in an IIFE. It uses the game's own globals: `game_data`, `TribalWars`, `UI`, `Dialog` and jQuery `$`.

### Data sources (all pages from the game itself)

| What | Where | Function |
|---|---|---|
| Current village (id, name, coords, resources, warehouse) | `game_data.village`, then overwritten with fresher numbers from the production overview | `start()` |
| All own villages: resources, warehouse, free merchants, coords | `overview_villages&mode=prod&group=0&page=-1` → `#production_table` rows. Village from `span.quickedit-vn` (`data-id`, last `x\|y` in its text); resources from `span.res/.warn_90/.warn` `.wood/.stone/.iron`; warehouse = the next `<td>`; merchants = the `<td>` after that (`free/total`) | `fetchVillages()` |
| Resources travelling to each of your villages (map by village id) | `overview_villages&mode=trader&type=inc&group=0&page=-1` → `#trades_table` rows. Destination village id is read from the link in `cells[4]`, resources from the children of `cells[8]` (type from class name `wood/stone/iron`) | `fetchIncoming()` |

URLs are built with `game_data.link_base_pure`, so they also work when sitting another account. The column positions come from Shinko to Kuma's Warehouse Balancer and were **verified in-game on pt117 (desktop layout)**.

### Planning (`buildPlan()`)

```
goal     = floor(storage × fill%)
need[r]  = max(0, goal − inVillage[r] − incoming[r])        for wood/stone/iron

for each ticked source, sorted by distance (closest first):
    stop if total need < minSend
    keep     = floor(source.storage × keep%)
    send[r]  = min(need[r], max(0, source[r] − keep))
    skip if 0 free merchants              → "no free merchants"
    skip if nothing to send               → "nothing above X% keep"
    if sum(send) > merchants × carry: scale all three down proportionally
    skip if sum(send) < minSend           → "could only send N (below minimum)"
    need[r] −= send[r]; add row
```

Distance is Euclidean, `hypot(dx, dy)`, the same as the game's field distance.

### Sending (`sendRow()`)

```js
TribalWars.post('market', { ajaxaction: 'map_send', village: sourceId },
                { target_id, wood, stone, iron }, onSuccess, onError);
```

This is the same endpoint the approved Shinko to Kuma scripts use. **One click = one send**, as the rules require. All Send buttons are disabled for 250 ms after each click to stay under the game's request rate limit. On success the row is greyed out, the numbers are added to the in-memory Incoming, and focus moves to the next button.

### UI

- `renderPanel()` prepends `#fillWH` to `#contentContainer`.
- `showSettings()` opens a `Dialog` with number inputs, a filterable village list with checkboxes, and "Select shown" / "Clear shown" buttons.
- `injectStyles()` adds `.fillWH-table` padding (3px 14px) and right-aligns the number cells.
- Village names already contain `(x|y) Kxx`, so coordinates are not appended again.

### Code map

| Function | Purpose |
|---|---|
| `loadSettings` / `saveSettings` | localStorage, merged with `DEFAULTS` |
| `url`, `parseNumber`, `fmt`, `esc`, `distance`, `sum`, `resIcon` | helpers (`fmt` uses `.` as thousands separator, as the PT game does) |
| `fetchVillages`, `fetchIncoming` | scrape the overviews |
| `buildPlan` | the algorithm above; returns `{goal, remaining, rows, skipped, missing, sourceCount}` |
| `renderPanel`, `skippedTable`, `summaryRow`, `focusNext` | main panel |
| `sendRow` | one market send |
| `showSettings`, `numberInput`, `clamp` | settings dialog |
| `incomingFor`, `missingTotal` | incoming entry per village; total still needed to reach the goal |
| `findNextTarget` | next village in overview order that isn't a source and has `missingTotal ≥ minSend` (wraps around) |
| `start(advance)` | fetch both overviews in parallel, refresh the target from them, optionally move to `findNextTarget()`, then render (opens Settings if there are no sources) |

---

## Hosting & deploying changes

- Repo: <https://github.com/Mordokay/tw-fill-warehouse> (public, branch `main`), cloned at `~/Desktop/FillWarehouse`.
- Served via jsDelivr: `https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js`. `raw.githubusercontent.com` can't be used because it serves `text/plain` with `nosniff`, which the browser refuses to run.
- After every change:
  ```sh
  node --check fillWarehouse.js
  git commit -am "..." && git push
  curl -s "https://purge.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js"
  # confirm the CDN serves the new code (the first purge sometimes needs a retry after ~10 s):
  curl -s https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js | grep "<something new>"
  ```
  Without a purge, jsDelivr can keep serving the old file for up to about 12 hours. The quickbar link never has to change.

## Verified in-game (2026-09-26, pt117, desktop)

- The Settings window, village selection and saving all work.
- Three sends to *#09 Húmus de beterraba* arrived in the market with exactly the planned amounts.
- On re-running, Incoming showed 6.357 / 6.772 / 316, matching the market page, and the panel correctly said *already at the goal*.
- The skipped reasons were correct: a source below the keep %, and a remainder below the minimum.

## Decisions & history

1. **Searched for an existing script first.** Shinko to Kuma's *Resource Sender* sends everything above X% from all villages to one coordinate, split in coin ratios for minting, with no cap on the target. Their *Warehouse Balancer* fills small villages to X%, but it balances the whole group at once and can't target one village or use hand-picked sources. Neither matched, so this script was written. It reuses their proven page-scraping and `map_send` approach.
2. **One click per send instead of fully automatic sending**, because of the rules.
3. **Incoming transports are counted**, so re-running never overfills a village.
4. **Keep % in sources**, so the developed villages don't get drained.
5. Fixes after the first in-game runs:
   - Columns were too tight, so padding was added.
   - "Nothing to send" wrongly claimed the village was at the goal. The panel now gives the real reason and shows a Skipped source table.
   - Coordinates were shown twice, so the extra ones were removed.
   - The game's **Next village** link reloaded the page and closed the panel. Next village now switches the panel's target in place: the target doesn't need to be the village the game is showing, because a send only needs `target_id`. The panel can't restart itself after a page reload, since that would need a userscript, which the rules ban. Each send stores the target it was planned for (`row.targetId`), so a late confirmation can't be counted for the wrong village.
6. The script was hosted on GitHub + jsDelivr because the quickbar needs a URL.
7. Approval: a support ticket was prepared (category *Perguntas*). The alternative route is submitting to the Script Library via zz1.

## Known limitations / ideas

- **Desktop layout only.** The mobile overview HTML is different and isn't parsed.
- The table column positions in the incoming-transports page (`cells[4]`, `cells[8]`) could break if InnoGames changes its layout. If Incoming ever shows 0 while transports are on their way, check this first.
- Merchant capacity is a setting, not read from the game.
- The script doesn't estimate how long each transport will take to arrive; it only shows distance.
- Possible future ideas: picking sources by group instead of checkboxes; preparing the Script Library submission (it needs an in-game config UI, which this already has).
