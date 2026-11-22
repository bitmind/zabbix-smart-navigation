# CLAUDE.md — zabbix-module-hostgroups-tree

Two Zabbix frontend modules with the same host group tree: **Host group tree (panel)** (`hostgrouptree/`, a panel
on **Monitoring › Hosts**, **Monitoring › Problems** and **Data collection › Hosts**) and **Host group tree (widget)**
(`hostgrouptree-widget/`, a dashboard navigation widget). User-facing documentation: `README.md`. This file is the
developer handoff.

The maintainer writes in Italian: reply in Italian. Code, comments, commit messages and README are in English.

## Branch and releases

Only `main`, for **both Zabbix 7.0 and 8.0**: version differences are handled at runtime, never by branching code.
(Until 1.18.1 there was a `7.0` branch that differed only in manifest descriptions and README; it is merged and
frozen.)

For every release: bump `version` in **both** manifests (same `X.Y.Z`), add a row to the README "What's new" table,
then `tools/package.sh` (zips in `dist/`, not committed). Names: *Host group tree (panel)* / *Host group tree
(widget)*, author `bitmind`.

## Layout

The two modules are sibling folders named as their install folders (Zabbix scans only the first level of
`modules/`; a widget must be a module of type `widget`, and widget modules load their assets only on dashboards, so
the panel cannot live in the widget module).

```
hostgrouptree/                       panel -> <frontend>/modules/hostgrouptree
  manifest.json                      id hostgrouptree, namespace HostGroupTree, action hostgrouptree.data (layout.json)
  config.json                        module configuration (see below)
  Module.php                         empty CModule
  actions/HostGroupTreeData.php      JSON endpoint: tree, counters, access flags, form modes, config
  assets/js/hostgrouptree.js         everything client-side (one IIFE)
  assets/css/hostgrouptree.css
hostgrouptree-widget/                widget -> <frontend>/modules/hostgrouptree-widget
  manifest.json                      id hostgrouptree_widget, namespace HostGroupTreeWidget (PHP Modules\HostGroupTreeWidget),
                                     type widget, js_class CWidgetHostGroupTree, out _hostgroupid + _hostgroupids
  includes/WidgetForm.php            groupids (roots), exclude_groupids, severities, problems, show_suppressed,
                                     show_hosts (radio: HOSTS_NONE = 0 default, ALL = 1, ENABLED = 2; 0/1 keep the meaning
                                     of the former checkbox values)
  actions/WidgetView.php             tree + counters as CWidgetView vars (same node structure as the endpoint)
  assets/js/class.widget.js          the panel tree rewritten as a CWidget class
  assets/css/widget.css              the panel CSS with the hgtw- prefix (independent from the panel module)
tests/php/*_test.php                 PHP tests with stub classes
tests/mock/{panel,widget}_server.py  mock pages for the browser
tools/package.sh [ref]               dist/hostgrouptree-<v>.zip, hostgrouptree-widget-<v>.zip, hostgrouptree-all-<v>.zip
tools/deploy.sh <modules dir> [ref]  git archive of both modules into a modules/ folder, keeps config.json
```

Deploy and package use **committed** files (`git archive`): commit first.

## Architecture (keep these decisions)

- **Native pages are never replaced or copied.** The JS wraps the children of `<main>` (except the title header) in
  `.hgt-layout` = `aside.hgt-panel` + `.hgt-content`, and drives the native filter. Native list, paging, sorting,
  refresh and 8.0 table customizations keep working.
- Assets load on every page: the IIFE exits unless `zabbix.php?action=` is one of
  `host.view` (MODE `hosts`), `problem.view` (`problems`), `host.list` (`config`), plus early branches for
  `hostgroup.list`, `hostgroup.edit`, `maintenance.list`, `maintenance.edit` (form automation via `sessionStorage`).
  Nothing in kiosk mode.
- **Applying a group**: tab filter pages → set the active tab's `.multiselect[id^="groupids_"]` (jQuery
  `multiSelect('clean'|'addData')`) and click `.tabfilter-container button[name="filter_apply"]`; if nothing reacts in
  3 s, reload with the URL where only `groupids[]` is replaced. Data collection (classic filter) → resubmit the
  `form[name="zbx_filter"]` fields with `filter_groups[]` replaced and `filter_set=1`.
- Highlight follows the URL (`history.pushState/replaceState` are wrapped) → `computeSelectedPaths()`; `last_click`
  (localStorage) decides between a virtual parent and its only child, which produce the same filter.
- **Group tree**: nesting comes only from `/` in group names. Prefixes that are not groups (or not readable) are
  *virtual* nodes; a node's `cover` = its groupid, or the top-most real descendants for virtual nodes (the native
  filters include subgroups). Synthetic root `All` (`ROOT_PATH`) = empty filter.
- **Endpoint** (`hostgrouptree.data`, GET, CSRF disabled, `public function init()` — must be public for 7.0):
  counts are distinct hosts/events per subtree. Extra inputs: `problem_filter` (Problems page query → all filter
  fields applied through `CScreenProblem::getData()`, fallback `problem.get`), `mode=config` + `host_filter`
  (Data collection filter → host.get options; unavailable interfaces with the *Host availability* widget logic).
  Returns `sev_counts` and `host_masks` (bitmask of severities per host) so the JS applies the page Severity filter
  without another request.
- **Expand/collapse all** is one header button (`updateFoldButton()`: collapse while any non-root group is open,
  otherwise expand); Alt+click on an arrow and `*` act on a whole branch (`toggleSubtree()`).
- **Form mode detection**: `getFormMode(action, popup_since)` asks `CRouter` whether `hostgroup.edit` /
  `maintenance.edit` use `layout.json` (popup) or a page (7.0 host groups are a page).
- **Look**: the native list is a `table.list-table` or, on 8.0 Monitoring pages, a div-based `.datatable`
  (background on `.datatable-body`, header cells `.datatable-cell-header`, rows `.datatable-cell-data`); it can be
  filled after the page script, so the style is copied again on `load` and after 1 s. 8.0 themes:
  `blue-theme`, `blue-classic-theme`, `dark-theme`, `dark-classic-theme`, `dark-blue-theme`, `hc-light`, `hc-dark`
  (CSS fallbacks list every dark one). `syncNativeStyle()` copies radius/border/shadow/background/header/row border from the native table into
  CSS variables (row border = most frequent visible `td` bottom border: Problems starts with timeline rows).
  Severity colors come from theme classes `na-bg … disaster-bg`, red text from `.red`, availability from
  `.status-red`; local fallbacks use `:where()` (zero specificity) so theme/custom colors always win.

## config.json

Keys: `pages` (object of booleans `monitoring_hosts`, `monitoring_problems`, `data_collection_hosts`),
`show_column_headers`, `show_expand_collapse_buttons`, `open_forms_in_place`, `refresh_interval`,
`maintenance_period_minutes`, `problem_limit`. The file is JSON **with comments** (`stripJsonComments()` before
`json_decode`); every key has a comment in the shipped file. Read by `readConfig()` (merged over `CONFIG_DEFAULTS`,
wrong types ignored, objects merged key by key) and sent to the JS (`applyModuleConfig()`). Adding a key = PHP
`CONFIG_DEFAULTS` + JS `CFG` and `applyModuleConfig()` + `config.json` (with its comment) + README table.

`pages`: the panel is built before the config arrives, so a disabled page is detected at the first data response
(`removeLayout()` puts the native children back) and cached in localStorage `hostgrouptree.disabled_pages`. Cached
disabled pages build nothing and only call the endpoint with `config_only=1`; if enabled again, `boot()` runs.

**Never let a test write the real `config.json`** (1.14.0 shipped a test file by mistake): tests work on a copy
(`readConfig()` accepts a file path for that).

## Pitfalls already paid for

1. **Native popups and dialog ids.** Native form scripts find their dialog with `overlays_stack.getById(<id>)`;
   the id differs between versions and is not known for 8.0. Opening `PopUp()` with an invented id breaks the form
   (`this.overlay is undefined`, disabled Add button).
   - Host group form: opened in place by `openFormInPlace()`; a hook on `overlays_stack.getById` answers an unknown
     `hostgroup…` id with the dialog just opened and stores the id in localStorage `hostgrouptree.dialogueids`.
     The hook must **only return an overlay still in the DOM** (1.15.0 returned the closed one → second open did
     nothing). `open_forms_in_place: false` → fallback through the native list page.
   - Maintenance: opened by clicking the native *Create maintenance period* button on `maintenance.list`, then filled
     (name, groups, period via the native period dialog). Could move to `openFormInPlace()` once verified on 8.0.
2. **Do not inject anything into the tab filter row**: positions there differ in 8.0 and every attempt overlapped
   the filter tabs. Hidden panel = 14 px vertical strip, whole strip clickable.
3. Hidden strip: add `hgt-strip` before the first `applyPanelGeometry()` and never set `inert` on the panel
   (reload-while-hidden made the strip unclickable).
4. CSS `display: flex` overrides the `hidden` attribute: add `[hidden] { display: none }` for such elements.
5. Panel top aligns with the filter box: tab filter → bottom of the tab label; classic filter → top of the first
   opaque wide block (`filterBoxTop()`).
6. Height: sticky panel, `height = innerHeight − top − gap` with an equal negative bottom margin, so it never adds a
   scrollbar.
7. Keep `hostgrouptree.js` **ASCII-only** (non-ASCII as `\uXXXX`); module assets may be served without charset.
8. Group names are user data: always `textContent`, never `innerHTML` (only static SVG from `ICONS` uses innerHTML).

## Dashboard widget

- Code shared with the panel is **copied**, not imported: the widget must work without the page module. A change to
  the tree look/behavior goes to both `hostgrouptree/assets/` and `hostgrouptree-widget/assets/` (classes `hgt-` / `hgtw-`).
- `onInitialize()` runs inside the `CWidgetBase` constructor, before subclass private fields exist: initialize in
  `onStart()`.
- `setContents()` keeps one DOM (`#dom`) and re-renders; `onClearContents()` drops it (cover messages).
- Selection = set of row paths (empty = All), stored in sessionStorage `hostgrouptree.widget.selection.<dashboardid>`;
  open branches in localStorage `hostgrouptree.widget.tree.<dashboardid>`. Every widget of the dashboard reads them
  on `onActivate()` (page switch) and broadcasts if the selection changed; an unknown path falls back to All.
- Broadcast: `_hostgroupids` = union of the covers; `_hostgroupid` = first id; All = `[]`, or the covers of the top
  nodes when the form has roots/exclusions (`filtered`).
- Widget JS API checked identical in 7.0 and 8.0 (`ui/js/class.widget-base.js`, release/8.0 on GitHub).

## Assumptions not yet verified on a real 8.0

Menu links `hostinventories.php?filter_groups[]`, `host.list&filter_groups[]`, `maintenance.list&filter_groups[]`;
`filter_monitored_by` values (assumed equal to host `monitored_by`, `ZBX_MONITORED_BY_ANY` ignored);
`CScreenProblem::getData($filter, $limit)` signature; maintenance form selectors (period *Add* button, period dialog
fields `timeperiod_type`, `period_days|hours|minutes`). Warnings are logged as `[hostgrouptree] …` in the console.

## Testing

No real Zabbix is reachable from the development machine/cloud. Before every commit:

- `php -l` on the changed PHP, `node --check` on the changed JS, ASCII check of the JS.
- `php tests/php/panel_config_test.php` and `php tests/php/widget_filter_test.php` (stub classes, private static
  methods through reflection; `readConfig()` takes a file path so tests never touch the real `config.json`).
- `python3 tests/mock/panel_server.py` → `http://localhost:8765/zabbix.php?action=host.view`: Zabbix-like page and a
  fake `hostgrouptree.data` (`/set?page=<key>&v=0|1` toggles `pages`, `/calls` lists the requests).
- `python3 tests/mock/widget_server.py` → `http://localhost:8766/`: two widgets on a fake `CWidget`; `runChecks()` in
  the console replays the page switch scenario and returns `{ok, results}`.
- Reproduce a reported bug in a mock first, then fix. Older mocks (fake jQuery `multiSelect`, `PopUp` /
  `overlays_stack` for the in-place forms) were not kept: extend `panel_server.py` when needed.

The maintainer tests on Zabbix 8.0 (`http://192.168.64.9/zabbix/`) and 7.0 and reports with screenshots and console
output. To update a test install: `tools/deploy.sh <its modules folder>` (works on local or mounted folders).

## Ideas not done yet

- Create maintenance in place (same mechanism as the host group form).
- Optionally make the host count follow the page Severity filter (counts are totals today).
