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
   - **Exact amounts** (since `v1.1.0`): three fields (wood / clay / iron) to use a fixed goal instead of the fill %. Type what the village must have in total, for example a noble's cost of 40.000 / 50.000 / 50.000, and click **Use amounts** or press Enter. The village's resources and incoming transports are subtracted, and only the rest is requested. An empty field means that resource isn't needed. **Use %** goes back to the fill % from Settings. Amounts bigger than the warehouse are capped to the warehouse size, with a warning. The amounts aren't saved, so each run starts in % mode.
4. Go to the next village with the game's own arrows or links, then click the quickbar entry again. Tip: give it a keyboard shortcut with **Atribuir** in the quickbar settings.

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
| Resources travelling to the current village | `overview_villages&mode=trader&type=inc&group=0&page=-1` → `#trades_table` rows. Destination village id is read from the link in `cells[4]`, resources from the children of `cells[8]` (type from class name `wood/stone/iron`) | `fetchIncoming()` |

URLs are built with `game_data.link_base_pure`, so they also work when sitting another account. The column positions come from Shinko to Kuma's Warehouse Balancer and were **verified in-game on pt117 (desktop layout)**.

### Planning (`buildPlan()`)

```
goal[r]  = exact amount typed in the panel, capped at storage   (if any field was filled)
         = floor(storage × fill%)                              (otherwise)
need[r]  = max(0, goal[r] − inVillage[r] − incoming[r])        for wood/stone/iron

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

This is the same endpoint the approved Shinko to Kuma scripts use. **One click = one send**, as the rules require. All Send buttons are disabled for 250 ms after each click to stay under the game's request rate limit. The clicked row stays locked (`pending`) until the game answers, so it can never be sent twice (since `v1.0.1`). On success the row is greyed out, the numbers are added to the in-memory Incoming, and focus moves to the next button. On failure the row is unlocked so you can retry.

### Moving between villages

The panel only works on the village you are on. You move to the next village with the game itself, and the panel closes like any normal page content. There is deliberately **no "Next village" button**. See *Decisions & history* for the attempts to keep the panel open across villages, and why they were dropped.

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
| `goalFor`, `useAmounts` | goal per resource (exact amounts or fill %); reads the three amount fields |
| `incomingFor`, `missingTotal` | incoming transports per village; total still needed to reach the goal |
| `start` | fetch both overviews in parallel, refresh the current village from them, then render (opens Settings if there are no sources) |

---

## Hosting & deploying changes

- Repo: <https://github.com/Mordokay/tw-fill-warehouse> (public, branch `main`), cloned at `~/Desktop/FillWarehouse`.
- Quickbar URL (the user's choice): **jsDelivr**, `https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js`. The repo must stay public for jsDelivr to serve it.
- `raw.githubusercontent.com` can't be used: it serves `text/plain` with `nosniff`, which the browser refuses to run.
- jsDelivr caches which commit `@main` points to for up to about 12 hours, and purging (`https://purge.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js`) did not always work. **After a push, the quickbar can keep loading the previous version for hours.** For an urgent fix, temporarily use a commit-pinned URL (`@<commit sha>`), which updates instantly.
- GitHub Pages (`https://mordokay.github.io/tw-fill-warehouse/fillWarehouse.js`) was enabled on 2026-09-26 as a faster-updating alternative. It is still on, but the quickbar doesn't use it.
- After every change:
  ```sh
  node --check fillWarehouse.js
  git commit -am "..." && git push
  curl -s "https://purge.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js"
  # check whether the CDN serves the new code yet (it may take hours):
  curl -s https://cdn.jsdelivr.net/gh/Mordokay/tw-fill-warehouse@main/fillWarehouse.js | diff -q - fillWarehouse.js && echo up to date
  ```

## Versions

Each version is tagged. A tagged jsDelivr URL (`@vX.Y.Z`) is served immediately and never changes, unlike `@main`.

| Tag | Commit | What |
|---|---|---|
| `v1.0.0` | `635d111` | First version given to reviewers (tested in-game on pt117). The reviewers got the `@main` link, which may still have served the older `b951fdd` copy, with a Next village button, because of jsDelivr's cache. |
| `v1.0.1` | see tag | **Double-send fix.** Before, if the game took longer than 250 ms to confirm a send, pressing Enter again re-sent the same row. In a mock test with a 1.5 s delay, 5 Enter presses produced 5 transports. Now a row is `pending` from the click until the game answers, and can't be sent again. If the game rejects the send, the row is re-enabled so you can retry. |

| `v1.1.0` | see tag | **Exact amounts**: three fields in the panel to fill up to fixed amounts (e.g. a building's or noble's cost) instead of the fill %. |

**Source villages as targets are allowed on purpose.** If you run the panel on one of your source villages, it can plan to fill it from the other sources. The user decided this is a feature, for when a source village needs resources for a special reason.

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
   - **Next village**, attempt 1 (reverted): made Next village change only the panel's *target* while the game stayed on the old village. The user rejected this as the wrong approach, because the game's village must actually change.
   - **Next village**, attempt 2: the user pointed to LA Enhancer, and its page-swap technique was copied, along with its "Go to next village when…" conditions. In-game it broke the quickbar and menus, the URL didn't update and the panel vanished.
   - **Next village**, attempt 3: the frame host. The first version put the panel above the whole game, which the user didn't want. It now goes inside the game page, under the menu bar. After that, the panel stayed through *every* navigation, which the user found too aggressive. Now only the panel's own Previous/Next keep it. The game runs in an iframe under the panel, so village changes are real page loads. It was tested end-to-end against a local mock server before release. It worked, but it hid the whole game page and reloaded it in a frame. The user and Claude agreed that this was too invasive ("messing a lot with the game") and a risk for approval.
   - **Final decision (2026-09-27):** go back to the version jsDelivr had been serving (`b951fdd`), which was attempt 1 because of jsDelivr's cache, and remove its Next village button and "(open village)" link. The panel works on the current village only. You move between villages with the game itself and reopen the panel from the quickbar or its keyboard shortcut. This is the conventional behaviour of approved scripts.
6. The script is hosted on GitHub because the quickbar needs a URL. It was on jsDelivr, briefly moved to GitHub Pages because jsDelivr's `@main` went stale, then went back to jsDelivr at the user's request.
7. Approval: a support ticket was prepared (category *Perguntas*). The alternative route is submitting to the Script Library via zz1.

## Known limitations / ideas

- **Desktop layout only.** The mobile overview HTML is different and isn't parsed.
- The table column positions in the incoming-transports page (`cells[4]`, `cells[8]`) could break if InnoGames changes its layout. If Incoming ever shows 0 while transports are on their way, check this first.
- Merchant capacity is a setting, not read from the game.
- **Testing rule:** never automate a browser against the real game or with a logged-in profile (the user was banned once). Mock tests only: a local server on 127.0.0.1 plus a throwaway headless-Chrome profile. The mock server and test scripts were temporary and weren't kept.
- The script doesn't estimate how long each transport will take to arrive; it only shows distance.
- Possible future ideas: a stored list of target villages with a "next target" button; picking sources by group instead of checkboxes; preparing the Script Library submission (it needs an in-game config UI, which this already has).
