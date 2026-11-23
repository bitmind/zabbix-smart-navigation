/*
 * Host group tree for Monitoring > Hosts, Monitoring > Problems and Data collection > Hosts (Zabbix 7.0 / 8.0).
 *
 * The native page is left untouched: this script only wraps the existing filter + list into a two-column
 * layout and adds the tree on the left. Clicking a group writes it into the "Host groups" multiselect of the
 * ACTIVE filter tab and presses the native "Apply" button, so every other filter field is preserved and the
 * native list refresh, paging, sorting and table customizations keep working.
 *
 * If the native filter cannot be driven (DOM changed in a future version), the script falls back to reloading
 * the page with the current URL, where only groupids[] is replaced.
 */
(() => {
	'use strict';

	const page_params = new URLSearchParams(window.location.search);
	const is_zabbix_php = /(^|\/)zabbix\.php$/.test(window.location.pathname);

	// Name prefilled by "Add nested group" when the host group form is a full page (Zabbix 7.0).
	const PREFILL_KEY = 'hostgrouptree.prefill';

	// Name prefilled by "Create maintenance" when the maintenance form is a full page.
	const MAINTENANCE_KEY = 'hostgrouptree.maintenance';

	// "Add group" / "Rename": request for the host group list page.
	const GROUP_KEY = 'hostgrouptree.group';

	if (is_zabbix_php && page_params.get('action') === 'hostgroup.list') {
		groupFormFromList();

		return;
	}

	if (is_zabbix_php && page_params.get('action') === 'hostgroup.edit' && !page_params.has('groupid')) {
		prefillGroupPage();

		return;
	}

	// "Create maintenance": the native form is opened from the maintenance list with its own button, then filled.
	if (is_zabbix_php && page_params.get('action') === 'maintenance.list') {
		createMaintenanceFromList();

		return;
	}

	if (is_zabbix_php && page_params.get('action') === 'maintenance.edit' && !page_params.has('maintenanceid')) {
		prefillMaintenancePage();

		return;
	}

	/*
	 * Pages with the tree:
	 * - Monitoring > Hosts:    host count + worst severity dot per group;
	 * - Monitoring > Problems: worst severity dot + problem count per group;
	 * - Data collection > Hosts: host count + red dot when hosts of the group have unavailable interfaces.
	 */
	// Monitoring > Latest data: not a tree, the native subfilter shown vertically in the same panel ("latest").
	const PAGE_MODES = {'host.view': 'hosts', 'problem.view': 'problems', 'host.list': 'config', 'latest.view': 'latest'};
	const MODE = is_zabbix_php ? PAGE_MODES[page_params.get('action')] : undefined;

	if (MODE === undefined) {
		return;
	}

	const CFG = {
		data_action: 'hostgrouptree.data',
		// Defaults; the values of config.json (sent by the data endpoint) take precedence.
		refresh_interval: 60000,	// Tree counters/severity refresh (ms). 0 = disabled.
		show_column_headers: false,
		show_expand_collapse_buttons: true,
		open_forms_in_place: true,
		maintenance_period_minutes: 60,
		// Latest data subfilter: tags listed first in "Tag values", and open by default.
		subfilter_priority_tags: ['target', 'component', 'application'],
		gap: null,					// Space around the panel (px). null = same as the space between the Zabbix
									// menu and the page content, measured at load.
		min_height: 220,
		min_width: 180,
		max_width: 640,
		default_width: 280,
		indent: 16,
		apply_timeout: 3000,		// Wait for the native filter to react before falling back to a page reload.
		storage_key: 'hostgrouptree.state.v1',
		// Pages where config.json disabled the tree (cached, so the panel is not built and then removed).
		disabled_key: 'hostgrouptree.disabled_pages',
		// Native popup used to create/edit host groups (Data collection > Host groups).
		strip_width: 14				// Width of the hidden panel (vertical strip).
	};

	// 16x16 icons, stroke/fill = currentColor (follow the theme text color).
	const ICONS = {
		add: '<path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
		// Expand all (chevrons pointing outwards) / collapse all (chevrons pointing inwards).
		expand: '<path d="m4.5 6 3.5-3.5L11.5 6M4.5 10l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
		collapse: '<path d="m4.5 2.5 3.5 3.5 3.5-3.5M4.5 13.5l3.5-3.5 3.5 3.5" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
		show: '<path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'
			+ ' stroke-linejoin="round"/>',
		refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="currentColor" stroke-width="1.5"'
			+ ' stroke-linecap="round"/><path d="M13.2 1.8v3.6H9.6" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
		close: '<path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6"'
			+ ' stroke-linecap="round"/>',
		panel: '<rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.4"/><path d="M6.5 3v10" stroke="currentColor" stroke-width="1.4"/>',
		more: '<circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>'
			+ '<circle cx="12.5" cy="8" r="1.4" fill="currentColor"/>'
	};

	const SEVERITY_CLASSES = ['na-bg', 'info-bg', 'warning-bg', 'average-bg', 'high-bg', 'disaster-bg'];

	const I18N = {
		en: {
			title: 'Host groups',
			search: 'Search host group...',
			expand_all: 'Expand all',
			collapse_all: 'Collapse all',
			subtree_tip: 'Alt+click on an arrow: the whole branch',
			refresh: 'Refresh',
			all_groups: 'All',
			clear_search: 'Clear search',
			create_group: 'Create host group',
			group_created: 'Host group created',
			group_updated: 'Host group updated',
			monitoring: 'Monitoring',
			configuration: 'Configuration',
			hosts: 'Hosts',
			inventory: 'Inventory',
			host_group: 'Host group',
			add_nested: 'Add group',
			actions_section: 'Actions',
			maintenance: 'Maintenance',
			rename: 'Edit host group',
			create_maintenance: 'Create maintenance',
			maintenance_created: 'Maintenance created',
			collapse_panel: 'Hide panel',
			expand_panel: 'Show host groups',
			resize: 'Drag to resize, double click to reset',
			hosts_count: '%1 hosts',
			unavailable_tip: '%1 hosts with unavailable interfaces',
			col_groups: 'Host groups',
			col_hosts: 'Hosts',
			col_problems: 'Problems',
			col_availability: 'Availability',
			toggle_panel: 'Show/hide host groups',
			actions: 'Actions',
			problems_tip: '%1 problems, worst severity: %2',
			hosts_problems_tip: '%1 hosts with problems',
			// Units after the totals of the "All" row.
			unit_hosts: 'hosts',
			unit_problems: 'problems',
			sev_filtered: '(severity filter applied)',
			virtual_tip: 'Not a host group: selects all its subgroups',
			problems: 'Problems',
			latest: 'Latest data',
			load_error: 'Unable to load host groups.',
			retry: 'Retry',
			no_match: 'No matching groups',
			no_groups: 'No host groups',
			// Monitoring > Latest data: subfilter panel.
			sub_title: 'Subfilter',
			sub_search: 'Search subfilter...',
			sub_empty: 'The subfilter is shown when the filter is applied.',
			sub_more: 'More values are not shown: refine the filter',
			sub_active: '%1 selected',
			sub_tag_names: 'Tag names'
		},
		it: {
			title: 'Gruppi host',
			search: 'Cerca un gruppo...',
			expand_all: 'Espandi tutto',
			collapse_all: 'Comprimi tutto',
			subtree_tip: 'Alt+clic su una freccia: tutto il ramo',
			refresh: 'Aggiorna',
			all_groups: 'Tutti',
			clear_search: 'Cancella ricerca',
			create_group: 'Crea gruppo host',
			group_created: 'Gruppo host creato',
			group_updated: 'Gruppo host aggiornato',
			monitoring: 'Monitoraggio',
			configuration: 'Configurazione',
			hosts: 'Host',
			inventory: 'Inventario',
			host_group: 'Gruppo host',
			add_nested: 'Aggiungi gruppo',
			actions_section: 'Azioni',
			maintenance: 'Manutenzione',
			rename: 'Modifica gruppo host',
			create_maintenance: 'Crea manutenzione',
			maintenance_created: 'Manutenzione creata',
			collapse_panel: 'Nascondi pannello',
			expand_panel: 'Mostra gruppi host',
			resize: 'Trascina per ridimensionare, doppio clic per ripristinare',
			hosts_count: '%1 host',
			unavailable_tip: '%1 host con interfacce non disponibili',
			col_groups: 'Gruppi host',
			col_hosts: 'Host',
			col_problems: 'Problemi',
			col_availability: 'Disponibilit\u00E0',
			toggle_panel: 'Mostra/nascondi gruppi host',
			actions: 'Azioni',
			problems_tip: '%1 problemi, severit\u00E0 peggiore: %2',
			hosts_problems_tip: '%1 host con problemi',
			unit_hosts: 'host',
			unit_problems: 'problemi',
			sev_filtered: '(filtro severit\u00E0 attivo)',
			virtual_tip: 'Non \u00E8 un gruppo host: seleziona tutti i sottogruppi',
			problems: 'Problemi',
			latest: 'Dati recenti',
			load_error: 'Impossibile caricare i gruppi host.',
			retry: 'Riprova',
			no_match: 'Nessun gruppo trovato',
			no_groups: 'Nessun gruppo host',
			sub_title: 'Sottofiltro',
			sub_search: 'Cerca nel sottofiltro...',
			sub_empty: 'Il sottofiltro compare quando il filtro \u00E8 applicato.',
			sub_more: 'Altri valori non sono mostrati: restringi il filtro',
			sub_active: '%1 selezionati',
			sub_tag_names: 'Nomi tag'
		}
	};

	const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();

	const t = (key, ...args) => {
		let str = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

		args.forEach((arg, i) => {
			str = str.replace(`%${i + 1}`, String(arg));
		});

		return str;
	};

	/* ---------------------------------------------------------------------------------------------------------- */
	/* State                                                                                                      */
	/* ---------------------------------------------------------------------------------------------------------- */

	const stored = loadState();
	const expanded = new Set(Array.isArray(stored.expanded) ? stored.expanded : []);

	let panel_width = clamp(Number(stored.width) || CFG.default_width, CFG.min_width, CFG.max_width);
	let panel_collapsed = !!stored.collapsed;
	let root_collapsed = !!stored.root_collapsed;

	// Latest data subfilter: sections opened/closed by the user ({id: bool}) and tag groups ("tag" open, "!tag" closed).
	const sub_sections = stored.sub_sections && typeof stored.sub_sections === 'object' ? stored.sub_sections : {};
	// v2: 1.19.0 saved every tag as closed on "collapse all", hiding the priority tags; that state is dropped.
	const sub_open_groups = new Set(Array.isArray(stored.sub_groups_v2) ? stored.sub_groups_v2 : []);
	let sub_signature = null;

	const ROOT_PATH = '\u0000root';

	let model = null;
	let selected_ids = new Set();
	let search_term = '';
	let search_set = null;
	let focus_path = null;
	let pending_apply = null;
	let selected_paths = new Set();
	let filter_severities = new Set();
	let problem_query = null;
	let problem_reload_timer = null;
	let last_click = stored.last_click && typeof stored.last_click.path === 'string' ? stored.last_click : null;
	let first_load = true;
	// config.json disabled the tree on this page: everything stops.
	let disabled = false;

	const dom = {};

	function loadState() {
		try {
			return JSON.parse(window.localStorage.getItem(CFG.storage_key)) || {};
		}
		catch (e) {
			return {};
		}
	}

	function saveState() {
		try {
			window.localStorage.setItem(CFG.storage_key, JSON.stringify({
				width: panel_width,
				collapsed: panel_collapsed,
				root_collapsed,
				last_click,
				expanded: [...expanded],
				sub_sections,
				sub_groups_v2: [...sub_open_groups]
			}));
		}
		catch (e) {
			// Storage unavailable: state is kept for this page only.
		}
	}

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* DOM helpers                                                                                                */
	/* ---------------------------------------------------------------------------------------------------------- */

	function el(tag, class_name, attrs = {}) {
		const node = document.createElement(tag);

		if (class_name) {
			node.className = class_name;
		}

		for (const [name, value] of Object.entries(attrs)) {
			if (name === 'text') {
				node.textContent = value;
			}
			else if (value !== null && value !== undefined) {
				node.setAttribute(name, value);
			}
		}

		return node;
	}

	function iconButton(class_name, title, icon) {
		const btn = el('button', `hgt-icon-btn ${class_name}`, {type: 'button', title, 'aria-label': title});

		// Static markup from ICONS only, never user data.
		btn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${
			ICONS[icon]}</svg>`;

		return btn;
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Layout                                                                                                     */
	/* ---------------------------------------------------------------------------------------------------------- */

	function boot() {
		if (document.body.classList.contains('layout-kioskmode')) {
			return;
		}

		const main = document.querySelector('main');

		if (!main || main.querySelector('.hgt-layout')) {
			return;
		}

		if (disabledPages().includes(MODE)) {
			checkDisabledPage();

			return;
		}

		const layout = el('div', `hgt-layout hgt-mode-${MODE}`);
		const content = el('div', 'hgt-content');
		const panel = buildPanel();

		// Everything below the page title goes to the right column.
		const movable = [...main.children].filter((child) =>
			!child.matches('header, .header-title, script, style, template')
		);

		const anchor = movable[0] || null;

		main.insertBefore(layout, anchor);
		movable.forEach((child) => content.appendChild(child));

		layout.appendChild(panel);
		layout.appendChild(content);

		dom.main = main;
		dom.layout = layout;
		dom.content = content;
		dom.panel = panel;

		syncNativeStyle();
		// Zabbix 8.0 datatables can be filled after the page script: copy the style again once they are there.
		window.addEventListener('load', syncNativeStyle);
		window.setTimeout(syncNativeStyle, 1000);

		// No hide/show animation while the page is being built (e.g. reload with the panel already hidden).
		layout.classList.add('hgt-no-anim');

		// Hidden panel = narrow vertical strip; the whole strip shows it again. Set before the first geometry pass.
		layout.classList.add('hgt-strip');
		applyPanelGeometry(false);
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
			layout.classList.remove('hgt-no-anim');
		}));

		alignPanelTop();
		window.addEventListener('resize', () => window.requestAnimationFrame(alignPanelTop));
		window.addEventListener('load', alignPanelTop);
		window.setTimeout(alignPanelTop, 1000);

		initHeightManager();
		initUrlWatcher();

		selected_ids = readSelectedIds();
		filter_severities = readFilterSeverities();
		loadData();

		if (MODE === 'latest') {
			initSubfilterWatcher();
			render();
		}

	}

	/* Pages enabled in config.json ("pages"): the last answer is cached per browser. */

	const PAGE_CONFIG_KEYS = {hosts: 'monitoring_hosts', problems: 'monitoring_problems', config: 'data_collection_hosts',
		latest: 'monitoring_latest'
	};

	function pageEnabled(config) {
		const pages = config && typeof config === 'object' ? config.pages : null;

		return !(pages && typeof pages === 'object' && pages[PAGE_CONFIG_KEYS[MODE]] === false);
	}

	function disabledPages() {
		try {
			const list = JSON.parse(window.localStorage.getItem(CFG.disabled_key));

			return Array.isArray(list) ? list : [];
		}
		catch (e) {
			return [];
		}
	}

	function setPageDisabled(state) {
		const list = disabledPages().filter((mode) => mode !== MODE);

		if (state) {
			list.push(MODE);
		}

		try {
			if (list.length) {
				window.localStorage.setItem(CFG.disabled_key, JSON.stringify(list));
			}
			else {
				window.localStorage.removeItem(CFG.disabled_key);
			}
		}
		catch (e) {
			// Storage unavailable: config.json is checked with the data request on every load.
		}
	}

	// Page disabled at the last visit: only the configuration is asked; the tree is built if it is enabled again.
	function checkDisabledPage() {
		const url = new URL('zabbix.php', window.location.href);

		url.search = '';
		url.searchParams.set('action', CFG.data_action);
		url.searchParams.set('config_only', '1');

		fetch(url.toString(), {credentials: 'same-origin', headers: {'Accept': 'application/json'}})
			.then((response) => response.ok ? response.json() : null)
			.then((data) => {
				if (data && data.config && pageEnabled(data.config)) {
					setPageDisabled(false);
					boot();
				}
			})
			.catch((error) => console.warn('[hostgrouptree]', error));
	}

	// The tree was built, but config.json disables it on this page: the native page goes back as it was.
	function removeLayout() {
		disabled = true;

		if (dom.layout && dom.layout.parentNode) {
			while (dom.content.firstChild) {
				dom.layout.parentNode.insertBefore(dom.content.firstChild, dom.layout);
			}

			dom.layout.remove();
		}
	}

	// Module configuration (config.json) from the data endpoint: applied once, at the first load.
	function applyModuleConfig(config) {
		if (config && typeof config === 'object') {
			if (typeof config.open_forms_in_place === 'boolean') {
				CFG.open_forms_in_place = config.open_forms_in_place;
			}

			if (typeof config.show_expand_collapse_buttons === 'boolean') {
				CFG.show_expand_collapse_buttons = config.show_expand_collapse_buttons;
			}

			if (typeof config.show_column_headers === 'boolean') {
				CFG.show_column_headers = config.show_column_headers;
			}

			if (Number.isFinite(Number(config.refresh_interval)) && config.refresh_interval !== null) {
				CFG.refresh_interval = Math.max(0, Number(config.refresh_interval)) * 1000;
			}

			if (Array.isArray(config.subfilter_priority_tags)) {
				CFG.subfilter_priority_tags = config.subfilter_priority_tags.filter((tag) => typeof tag === 'string');
			}

			if (Number(config.maintenance_period_minutes) > 0) {
				CFG.maintenance_period_minutes = Math.round(Number(config.maintenance_period_minutes));
			}
		}

		// Latest data: no columns; the subfilter follows the native one, no counters to refresh.
		dom.columns.hidden = !CFG.show_column_headers || MODE === 'latest';
		dom.btn_fold.hidden = !CFG.show_expand_collapse_buttons;
		dom.layout.classList.toggle('hgt-no-headers', !CFG.show_column_headers || MODE === 'latest');

		if (CFG.refresh_interval > 0 && MODE !== 'latest') {
			window.setInterval(() => {
				if (!document.hidden) {
					loadData(true);
				}
			}, CFG.refresh_interval);
		}
	}

	function buildPanel() {
		const panel = el('aside', 'hgt-panel', {'aria-label': t(MODE === 'latest' ? 'sub_title' : 'title')});

		// Header.
		const header = el('div', 'hgt-header');
		const tools_right = el('div', 'hgt-tools');

		// One button: "Collapse all" while some group is expanded, otherwise "Expand all" (see updateFoldButton()).
		dom.btn_fold = iconButton('hgt-btn-fold', t('expand_all'), 'expand');
		dom.btn_hide = iconButton('hgt-btn-hide', t('collapse_panel'), 'close');

		// Expand/collapse all on the left edge (shown when config.json allows it), then the title; hide on the right.
		dom.btn_fold.hidden = true;
		tools_right.append(dom.btn_hide);
		header.append(dom.btn_fold, el('span', 'hgt-title', {text: t(MODE === 'latest' ? 'sub_title' : 'title')}), tools_right);

		// Search.
		const search_wrap = el('div', 'hgt-search');

		dom.search = el('input', null, {type: 'search', placeholder: t(MODE === 'latest' ? 'sub_search' : 'search'),
			'aria-label': t(MODE === 'latest' ? 'sub_search' : 'search'),
			autocomplete: 'off'
		});
		dom.search_clear = iconButton('hgt-search-clear', t('clear_search'), 'close');
		dom.search_clear.hidden = true;
		dom.search_clear.tabIndex = -1;
		search_wrap.append(dom.search, dom.search_clear);

		// Tree.
		dom.tree = el('div', 'hgt-tree', {role: 'tree', 'aria-label': t(MODE === 'latest' ? 'sub_title' : 'title')});
		dom.message = el('div', 'hgt-message');
		dom.message.hidden = true;

		// Resize handle.
		dom.resizer = el('div', 'hgt-resizer', {title: t('resize'), role: 'separator',
			'aria-orientation': 'vertical'
		});

		// Vertical strip shown when the panel is hidden: the whole strip is the button.
		dom.btn_show = el('button', 'hgt-show', {type: 'button', title: t('expand_panel'),
			'aria-label': t('expand_panel')
		});
		dom.btn_show.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">${
			ICONS.show}</svg>`;

		const body = el('div', 'hgt-body');

		// Column headers above the tree.
		dom.columns = el('div', 'hgt-columns', {'aria-hidden': 'true'});
		dom.columns.hidden = true;
		dom.columns.append(el('span', 'hgt-col-name', {text: t('col_groups')}));

		if (MODE !== 'problems') {
			dom.columns.append(el('span', 'hgt-col-count', {text: t('col_hosts')}));
		}

		dom.columns.append(el('span', 'hgt-col-ind', {text: t(MODE === 'config' ? 'col_availability' : 'col_problems')}));

		body.append(header, dom.columns, dom.tree, dom.message, search_wrap);
		panel.append(body, dom.btn_show, dom.resizer);

		bindPanelEvents();

		if (MODE === 'latest') {
			bindSubfilterEvents();
		}

		return panel;
	}

	/*
	 * Hidden panel = narrow vertical strip (CFG.strip_width), entirely clickable to show the panel again.
	 */
	function applyPanelGeometry(notify = true) {
		dom.layout.classList.toggle('hgt-collapsed', panel_collapsed);
		dom.layout.style.setProperty('--hgt-width', `${panel_width}px`);
		dom.layout.style.setProperty('--hgt-strip-width', `${CFG.strip_width}px`);

		// The hidden panel is the strip that shows it again: it must stay focusable and clickable.
		dom.panel.inert = false;
		dom.btn_show.setAttribute('aria-expanded', panel_collapsed ? 'false' : 'true');

		fitHeight();

		if (notify) {
			// Let native components (tab filter, tables) recalculate their widths, after the transition.
			window.setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
		}
	}

	function setPanelCollapsed(collapsed) {
		panel_collapsed = collapsed;
		saveState();
		applyPanelGeometry();
	}

	/*
	 * Top of the panel aligned with the top of the filter box (below the filter tab icons): the bottom of the tab
	 * labels of the tab filter (Monitoring) or of the classic filter (Data collection).
	 */
	function alignPanelTop() {
		if (disabled) {
			return;
		}

		const top = dom.layout.getBoundingClientRect().top;
		const box_top = filterBoxTop();
		let offset = 0;

		if (box_top !== null && box_top > top && box_top - top < 200) {
			offset = Math.round(box_top - top);
		}

		dom.panel.style.marginTop = `${offset}px`;
	}

	/*
	 * Top of the filter box. Monitoring (tab filter): bottom of the tab labels. Data collection (classic filter):
	 * top of the first opaque block of the filter at least as wide as most of it (the white box), or the bottom of
	 * its tab if the filter is collapsed. null if there is no filter.
	 */
	function filterBoxTop() {
		const tab_label = dom.content.querySelector('.tabfilter-container .tabfilter-item-label.selected')
			|| dom.content.querySelector('.tabfilter-container .tabfilter-item-label');

		if (tab_label) {
			return tab_label.getBoundingClientRect().bottom;
		}

		const container = dom.content.querySelector('.filter-container, #filter-tabs, .filter-space');

		if (!container) {
			return null;
		}

		const width = container.getBoundingClientRect().width;
		const opaque = (color) => color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);
		let best = null;
		let level = [...container.children];

		for (let depth = 0; depth < 4 && level.length; depth++) {
			for (const el of level) {
				const r = el.getBoundingClientRect();

				if (r.width >= width * 0.6 && r.height >= 20
						&& opaque(window.getComputedStyle(el).backgroundColor)
						&& (best === null || r.top < best)) {
					best = r.top;
				}
			}

			level = level.flatMap((el) => [...el.children]);
		}

		if (best !== null) {
			return best;
		}

		const tab = container.querySelector('li, .filter-trigger');

		return tab ? tab.getBoundingClientRect().bottom : null;
	}

	/*
	 * Panel height = from the panel top (or the sticky offset, once the page is scrolled) to the bottom of the
	 * window, so there is no empty space below it. A negative bottom margin of the same size keeps the panel out of
	 * the layout height: the page is never made longer by the panel (no extra scrollbar), the host list keeps its
	 * natural height, and the tree scrolls inside the panel.
	 */
	function initHeightManager() {
		let frame = null;

		const schedule = () => {
			if (frame === null) {
				frame = window.requestAnimationFrame(() => {
					frame = null;
					fitHeight();
				});
			}
		};

		window.addEventListener('resize', schedule);
		// Capture: catches scrolling of whichever element is the scroll container.
		document.addEventListener('scroll', schedule, {capture: true, passive: true});

		if ('ResizeObserver' in window) {
			const ro = new ResizeObserver(schedule);

			ro.observe(dom.main);
			ro.observe(dom.content);
		}

		fitHeight();
	}

	/*
	 * Space around the panel: the same as between the Zabbix main menu and the page content, so the panel sits in
	 * the page like the native blocks (left = right = bottom = sticky top).
	 */
	function measureGap() {
		if (CFG.gap !== null) {
			return CFG.gap;
		}

		const panel_left = dom.panel.getBoundingClientRect().left;
		const sidebar = document.querySelector('aside.sidebar, .sidebar');

		if (sidebar && sidebar.offsetWidth > 0) {
			const gap = panel_left - sidebar.getBoundingClientRect().right;

			if (gap >= 4 && gap <= 40) {
				return Math.round(gap);
			}
		}

		const padding = parseFloat(window.getComputedStyle(dom.main).paddingLeft);

		return padding >= 4 && padding <= 40 ? Math.round(padding) : 10;
	}

	function fitHeight() {
		if (!dom.panel || disabled) {
			return;
		}

		const gap = measureGap();

		dom.layout.style.setProperty('--hgt-gap', `${gap}px`);
		dom.panel.style.top = `${gap}px`;

		const top = Math.max(dom.panel.getBoundingClientRect().top, gap);
		const height = Math.floor(Math.max(CFG.min_height, window.innerHeight - top - gap));

		dom.panel.style.height = `${height}px`;
		dom.panel.style.marginBottom = `${-height}px`;
	}

	/*
	 * Copies the look of the native host list (card radius, border, shadow, background, header row) into CSS
	 * variables, so the panel matches the table next to it in every theme without hardcoding values.
	 */
	/*
	 * The native list: a <table class="list-table">, or (Zabbix 8.0 Monitoring pages) a <div class="datatable">
	 * grid with .datatable-header / .datatable-body / .datatable-cell-header / .datatable-cell-data.
	 */
	function syncNativeStyle() {
		// Not the Latest data subfilter: it is a table.list-table too, above the item list.
		const table = dom.content.querySelector('table.list-table:not(.tabfilter-subfilter)')
			|| dom.content.querySelector('.datatable') || dom.content.querySelector('table:not(.tabfilter-subfilter)');

		if (!table) {
			return;
		}

		const is_datatable = table.classList.contains('datatable');

		const set = (name, value) => {
			if (value) {
				dom.layout.style.setProperty(name, value);
			}
		};
		const opaque = (color) => color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);

		let card = null;
		let background = null;

		// Datatable: the background is on its body (or header), the container itself is transparent.
		if (is_datatable) {
			for (const part of table.querySelectorAll(':scope > .datatable-body, :scope > .datatable-header')) {
				const color = window.getComputedStyle(part).backgroundColor;

				if (opaque(color)) {
					background = color;
					break;
				}
			}
		}

		for (let node = table; node && node !== dom.content; node = node.parentElement) {
			const cs = window.getComputedStyle(node);

			if (!background && opaque(cs.backgroundColor)) {
				background = cs.backgroundColor;
			}

			if (parseFloat(cs.borderTopLeftRadius) > 0 || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none') {
				card = node;
				break;
			}
		}

		if (card) {
			const cs = window.getComputedStyle(card);

			set('--hgt-radius', cs.borderTopLeftRadius);
			set('--hgt-shadow', cs.boxShadow !== 'none' ? cs.boxShadow : null);
			set('--hgt-card-border', parseFloat(cs.borderTopWidth) > 0
				? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`
				: 'none'
			);

			if (!background && opaque(cs.backgroundColor)) {
				background = cs.backgroundColor;
			}
		}

		set('--hgt-panel-bg', background);

		const th = table.querySelector(is_datatable ? '.datatable-cell-header' : 'thead th');

		if (th) {
			const cs = window.getComputedStyle(th);

			set('--hgt-head-bg', opaque(cs.backgroundColor) ? cs.backgroundColor : null);
			set('--hgt-head-color', cs.color);
			set('--hgt-head-height', `${Math.round(th.getBoundingClientRect().height)}px`);

			if (parseFloat(cs.borderBottomWidth) > 0) {
				set('--hgt-head-border', cs.borderBottomColor);
			}
		}

		/*
		 * Row separator: the most frequent visible bottom border of the body cells. Not just the first cell: on
		 * Problems the first rows can be timeline rows (date/month) with no visible border.
		 */
		const votes = new Map();
		const panel_bg = background || 'rgb(255, 255, 255)';

		const cells = table.querySelectorAll(is_datatable ? '.datatable-body .datatable-cell-data' : 'tbody td');

		for (const cell of [...cells].slice(0, 60)) {
			const cs = window.getComputedStyle(cell);
			const color = cs.borderBottomColor;

			if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none' && opaque(color)
					&& color !== cs.backgroundColor && color !== panel_bg) {
				votes.set(color, (votes.get(color) || 0) + 1);
			}
		}

		if (votes.size) {
			set('--hgt-row-border', [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]);
		}
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Data                                                                                                       */
	/* ---------------------------------------------------------------------------------------------------------- */

	function loadData(silent = false) {
		if (disabled) {
			return Promise.resolve();
		}

		const url = new URL('zabbix.php', window.location.href);

		url.search = '';
		url.searchParams.set('action', CFG.data_action);

		// Data collection > Hosts: availability of the interfaces instead of problems.
		if (MODE === 'config') {
			url.searchParams.set('mode', 'config');
			url.searchParams.set('host_filter', hostFilterQuery());
		}

		// Latest data: only the configuration (pages, buttons); the subfilter comes from the page.
		if (MODE === 'latest') {
			url.searchParams.set('config_only', '1');
		}

		// Problems page: counters computed with all the fields of the applied filter (except Host groups).
		if (MODE === 'problems') {
			problem_query = problemQuery();
			url.searchParams.set('problem_filter', problem_query);
		}


		if (!silent && !model && MODE !== 'latest') {
			showMessage('', true);
		}

		return fetch(url.toString(), {credentials: 'same-origin', headers: {'Accept': 'application/json'}})
			.then((response) => {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				return response.json();
			})
			.then((data) => {
				if (MODE === 'latest') {
					if (!data || !data.config) {
						throw new Error(data && data.error ? data.error : 'Invalid response');
					}

					if (first_load && !pageEnabled(data.config)) {
						setPageDisabled(true);
						removeLayout();

						return;
					}

					if (first_load) {
						first_load = false;
						setPageDisabled(false);
						applyModuleConfig(data.config);
						// The configuration may change the tags listed first.
						render();
					}

					return;
				}

				if (!data || !Array.isArray(data.nodes)) {
					throw new Error(data && data.error ? data.error : 'Invalid response');
				}

				if (first_load && !pageEnabled(data.config)) {
					setPageDisabled(true);
					removeLayout();

					return;
				}

				model = buildModel(data);

				if (first_load) {
					first_load = false;
					setPageDisabled(false);
					applyModuleConfig(data.config);
					expandToSelection();
				}

				hideMessage();
				render();
			})
			.catch((error) => {
				console.warn('[hostgrouptree]', error);

				if (!model || !silent) {
					showError();
				}
			})
			;
	}

	function buildModel(data) {
		const by_path = new Map();
		const by_groupid = new Map();
		const roots = [];

		for (const raw of data.nodes) {
			const node = {
				path: String(raw.path),
				name: String(raw.name),
				parent: raw.parent === null ? null : String(raw.parent),
				groupid: raw.groupid === null ? null : String(raw.groupid),
				hosts: Number(raw.hosts) || 0,
				problems: Number(raw.problems) || 0,
				severity: raw.severity === null || raw.severity === undefined ? null : Number(raw.severity),
				sev_counts: severityCounts(raw),
				unavailable: Number(raw.unavailable) || 0,
				host_masks: raw.host_masks && typeof raw.host_masks === 'object' ? raw.host_masks : {},
				children: [],
				parent_node: null,
				depth: 0,
				cover: null
			};

			by_path.set(node.path, node);

			if (node.groupid !== null) {
				by_groupid.set(node.groupid, node);
			}
		}

		for (const node of by_path.values()) {
			const parent = node.parent !== null ? by_path.get(node.parent) : null;

			if (parent) {
				parent.children.push(node);
				node.parent_node = parent;
			}
			else {
				roots.push(node);
			}
		}

		const compare = (a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});

		const walk = (list, depth) => {
			list.sort(compare);

			for (const node of list) {
				node.depth = depth;
				walk(node.children, depth + 1);
			}
		};

		walk(roots, 1);

		/*
		 * Group IDs written into the filter for a node:
		 * - real group: the group itself (the native filter already includes subgroups);
		 * - virtual node: the top-most real groups below it (minimal set, fewer chips in the multiselect).
		 */
		const cover = (node) => {
			if (node.cover === null) {
				node.cover = node.groupid !== null ? [node.groupid] : node.children.flatMap(cover);
			}

			return node.cover;
		};

		by_path.forEach(cover);

		// Synthetic root: "All host groups" = no group in the filter.
		const total = data.total || {};
		const root = {
			path: ROOT_PATH,
			name: t('all_groups'),
			parent: null,
			groupid: null,
			hosts: Number(total.hosts) || 0,
			problems: Number(total.problems) || 0,
			severity: total.severity === null || total.severity === undefined ? null : Number(total.severity),
			sev_counts: severityCounts(total),
			unavailable: Number(total.unavailable) || 0,
			host_masks: total.host_masks && typeof total.host_masks === 'object' ? total.host_masks : {},
			children: roots,
			parent_node: null,
			depth: 0,
			cover: [],
			is_root: true
		};

		roots.forEach((node) => node.parent_node = root);
		by_path.set(ROOT_PATH, root);

		return {
			by_path,
			by_groupid,
			root,
			roots: [root],
			severity_names: data.severity_names || {},
			group_form: data.group_form === 'page' ? 'page' : 'popup',
			maintenance_form: data.maintenance_form === 'page' ? 'page' : 'popup',
			access: data.access || {}
		};
	}

	// Problems per severity (index = severity). Older endpoints: all problems counted at the worst severity.
	function severityCounts(raw) {
		if (Array.isArray(raw.sev_counts) && raw.sev_counts.length) {
			return raw.sev_counts.map((n) => Number(n) || 0);
		}

		const counts = [0, 0, 0, 0, 0, 0];

		if (raw.severity !== null && raw.severity !== undefined) {
			counts[Number(raw.severity)] = Number(raw.problems) || 0;
		}

		return counts;
	}

	/*
	 * Severities checked in the applied filter of the active tab (Monitoring > Hosts > Severity).
	 * Empty set = no severity checked = all severities, as in the native filter.
	 */
	function readFilterSeverities() {
		const severities = new Set();
		let has_key = false;

		for (const [key, value] of new URLSearchParams(window.location.search)) {
			if (/^severities\[\d*\]$/.test(key)) {
				has_key = true;

				if (value !== '') {
					severities.add(Number(value));
				}
			}
		}

		if (!has_key) {
			try {
				const {content} = getActiveFilterParts();

				if (content) {
					content.querySelectorAll('input[type="checkbox"][name^="severities"]:checked')
						.forEach((input) => severities.add(Number(input.value)));
				}
			}
			catch (e) {
				// Ignore.
			}
		}

		return severities;
	}

	// Problems of a node counted with the Severity filter: {count, worst}.
	function nodeProblems(node) {
		let count = 0;
		let worst = null;

		node.sev_counts.forEach((n, severity) => {
			if (n > 0 && (filter_severities.size === 0 || filter_severities.has(severity))) {
				count += n;
				worst = severity;
			}
		});

		return {count, worst};
	}

	// Filter of the Problems page as a query string, without the fields the tree does not use for counting.
	function problemQuery() {
		const params = new URLSearchParams(window.location.search);

		for (const key of [...params.keys()]) {
			if (key === 'action' || key === 'page' || /^groupids\[\d*\]$/.test(key)) {
				params.delete(key);
			}
		}

		params.sort();

		return params.toString();
	}

	/*
	 * Hosts with problems of the severities checked in the filter (all, if none is checked). host_masks counts the
	 * hosts of the subtree by the set of severities of their problems (bit N = severity N).
	 */
	function hostsWithProblems(node) {
		let filter_mask = 0;

		filter_severities.forEach((severity) => filter_mask |= 1 << severity);

		if (filter_mask === 0) {
			filter_mask = 0x3f;
		}

		let hosts = 0;

		for (const [mask, count] of Object.entries(node.host_masks)) {
			if (Number(mask) & filter_mask) {
				hosts += Number(count) || 0;
			}
		}

		return hosts;
	}

	function severitiesKey(set) {
		return [...set].sort((a, b) => a - b).join(',');
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Selection                                                                                                  */
	/* ---------------------------------------------------------------------------------------------------------- */

	function readUrlIds() {
		const params = new URLSearchParams(window.location.search);
		const ids = [];
		let has_key = false;

		for (const [key, value] of params) {
			if (/^groupids\[\d*\]$/.test(key)) {
				has_key = true;

				if (value !== '' && value !== '0') {
					ids.push(value);
				}
			}
		}

		return has_key ? ids : null;
	}

	function getActiveFilterParts() {
		// The selected filter tab (the time selector tab of Problems has no host group field).
		let content = null;
		let multiselect = null;

		for (const label of document.querySelectorAll('.tabfilter-container .tabfilter-item-label.selected')) {
			const target = label.dataset.target ? document.getElementById(label.dataset.target) : null;
			const field = target ? target.querySelector('.multiselect[id^="groupids_"]') : null;

			if (field) {
				content = target;
				multiselect = field;
				break;
			}
		}

		const apply = document.querySelector('.tabfilter-container button[name="filter_apply"]');

		return {content, multiselect, apply};
	}

	// Data collection > Hosts: classic filter form (not a tab filter), reloaded on Apply.
	function getConfigFilterForm() {
		return document.querySelector('form[name="zbx_filter"]');
	}

	function readSelectedIds() {
		if (MODE === 'config') {
			const form = getConfigFilterForm();
			const ids = new Set();

			if (form) {
				for (const [key, value] of new FormData(form)) {
					if (/^filter_groups\[\d*\]$/.test(key) && value !== '') {
						ids.add(String(value));
					}
				}
			}
			else {
				for (const [key, value] of new URLSearchParams(window.location.search)) {
					if (/^filter_groups\[\d*\]$/.test(key) && value !== '') {
						ids.add(value);
					}
				}
			}

			return ids;
		}

		const url_ids = readUrlIds();

		if (url_ids !== null) {
			return new Set(url_ids);
		}

		// URL does not carry the filter: read the multiselect of the active tab.
		try {
			const {multiselect} = getActiveFilterParts();

			if (multiselect && window.jQuery && typeof jQuery.fn.multiSelect === 'function') {
				return new Set((jQuery(multiselect).multiSelect('getData') || []).map((item) => String(item.id)));
			}
		}
		catch (e) {
			// Ignore.
		}

		return new Set();
	}

	function isCovered(node) {
		return node.cover.length > 0 && node.cover.every((id) => selected_ids.has(id));
	}

	/*
	 * Which rows are highlighted for the current filter.
	 * 1. If the filter is exactly what the last click produced, the clicked row (a virtual parent and its only
	 *    real child produce the same filter: the click decides which one is highlighted).
	 * 2. Otherwise the top-most rows whose groups are all in the filter. A virtual node whose groups are exactly
	 *    those of one child delegates to that child (e.g. "Company" when only "Company/websites" exists).
	 */
	function computeSelectedPaths() {
		const paths = new Set();

		if (!model) {
			return paths;
		}

		if (selected_ids.size === 0) {
			paths.add(ROOT_PATH);

			return paths;
		}

		const key = idsKey(selected_ids);

		if (last_click && last_click.key === key && model.by_path.has(last_click.path)) {
			paths.add(last_click.path);

			return paths;
		}

		for (const node of model.by_path.values()) {
			if (node.is_root || !isCovered(node)) {
				continue;
			}

			const own_key = idsKey(node.cover);

			if (node.groupid === null && node.children.some((child) => idsKey(child.cover) === own_key)) {
				continue;
			}

			let blocked = false;

			for (let p = node.parent_node; p !== null && !p.is_root; p = p.parent_node) {
				if (isCovered(p) && idsKey(p.cover) !== own_key) {
					blocked = true;
					break;
				}
			}

			if (!blocked) {
				paths.add(node.path);
			}
		}

		return paths;
	}

	function isSelected(node) {
		return selected_paths.has(node.path);
	}

	function containsSelection(node) {
		return node.children.some((child) => selected_paths.has(child.path) || containsSelection(child));
	}

	function expandToSelection() {
		if (!model) {
			return;
		}

		selected_paths = computeSelectedPaths();

		for (const node of model.by_path.values()) {
			if (isSelected(node)) {
				for (let p = node.parent_node; p !== null; p = p.parent_node) {
					setOpen(p, true);
				}

				focus_path = focus_path || node.path;
			}
		}

		saveState();
	}

	function selectNode(node, additive) {
		let ids;

		if (node.is_root) {
			ids = [];
		}
		else if (additive) {
			const set = new Set(selected_ids);

			if (isCovered(node)) {
				node.cover.forEach((id) => set.delete(id));
			}
			else {
				node.cover.forEach((id) => set.add(id));
			}

			ids = [...set];
		}
		else {
			ids = node.cover.slice();
		}

		last_click = additive ? null : {path: node.path, key: idsKey(ids)};
		focus_path = node.path;
		saveState();
		applyGroups(ids);
	}

	function applyGroups(ids) {
		selected_ids = new Set(ids);
		render();

		if (MODE === 'config') {
			applyConfigFilter(ids);

			return;
		}

		if (!applyInPage(ids)) {
			applyByUrl(ids);
		}
	}

	/*
	 * Preferred way: drive the native filter of the active tab. The tab becomes "unsaved" when it differs from
	 * the saved one, exactly as if the user had edited the field and pressed Apply.
	 */
	function applyInPage(ids) {
		try {
			const $ = window.jQuery;
			const {multiselect, apply} = getActiveFilterParts();

			if (!$ || !multiselect || !apply || typeof $.fn.multiSelect !== 'function') {
				return false;
			}

			const $ms = $(multiselect);
			const items = ids.map((id) => {
				const node = model.by_groupid.get(id);

				return {id, name: node ? node.path : id};
			});

			$ms.multiSelect('clean');

			if (items.length) {
				$ms.multiSelect('addData', items);
			}

			watchApply(ids);
			apply.click();

			return true;
		}
		catch (error) {
			console.warn('[hostgrouptree] native filter not available, falling back to URL', error);

			return false;
		}
	}

	// Falls back to a page reload if the native filter did not react (neither URL nor list changed).
	function watchApply(ids) {
		cancelPendingApply();

		const key = idsKey(ids);

		// Only a refresh of the host list counts as "the filter reacted" (changes inside the filter do not).
		const observer = new MutationObserver((mutations) => {
			const list_changed = mutations.some((m) => {
				const target = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;

				return target && !target.closest('.tabfilter-container');
			});

			if (list_changed) {
				cancelPendingApply();
			}
		});

		observer.observe(dom.content, {childList: true, subtree: true});

		pending_apply = {
			key,
			observer,
			timer: window.setTimeout(() => {
				const url_ids = readUrlIds();

				cancelPendingApply();

				if (url_ids === null || idsKey(url_ids) !== key) {
					console.warn('[hostgrouptree] native filter did not react, reloading with URL parameters');
					applyByUrl(ids);
				}
			}, CFG.apply_timeout)
		};
	}

	function cancelPendingApply() {
		if (pending_apply) {
			window.clearTimeout(pending_apply.timer);
			pending_apply.observer.disconnect();
			pending_apply = null;
		}
	}

	function idsKey(ids) {
		return [...ids].map(String).sort().join(',');
	}

	/*
	 * Data collection > Hosts: the filter form holds every field currently applied (also the ones restored from the
	 * user profile), so it is resubmitted as it is, with only the host groups replaced and the page reset.
	 */
	function applyConfigFilter(ids) {
		const form = getConfigFilterForm();
		const url = new URL('zabbix.php', window.location.href);

		url.search = '';

		if (form) {
			for (const [key, value] of new FormData(form)) {
				if (typeof value === 'string' && !/^filter_groups\[\d*\]$/.test(key)
						&& !['filter_set', 'filter_rst', 'page'].includes(key)) {
					url.searchParams.append(key, value);
				}
			}
		}

		if (!url.searchParams.get('action')) {
			url.searchParams.set('action', 'host.list');
		}

		ids.forEach((id) => url.searchParams.append('filter_groups[]', id));
		url.searchParams.set('filter_set', '1');
		window.location.assign(url.toString());
	}

	// Data collection > Hosts: applied filter fields (except host groups), counted by the tree on the server.
	function hostFilterQuery() {
		const form = getConfigFilterForm();
		const params = new URLSearchParams();

		if (form) {
			for (const [key, value] of new FormData(form)) {
				if (typeof value === 'string' && /^filter_/.test(key) && !/^filter_groups\[\d*\]$/.test(key)
						&& !['filter_set', 'filter_rst'].includes(key)) {
					params.append(key, value);
				}
			}
		}

		return params.toString();
	}

	function applyByUrl(ids) {
		const url = new URL(window.location.href);

		for (const key of [...url.searchParams.keys()]) {
			if (/^groupids\[\d*\]$/.test(key) || key === 'page') {
				url.searchParams.delete(key);
			}
		}

		ids.forEach((id) => url.searchParams.append('groupids[]', id));
		window.location.assign(url.toString());
	}

	// Keeps the tree highlight in sync with the filter (tab switch, manual edit, Reset, browser history).
	function initUrlWatcher() {
		const notify = () => window.dispatchEvent(new Event('hgt:urlchange'));

		for (const fn of ['pushState', 'replaceState']) {
			const original = window.history[fn];

			window.history[fn] = function (...args) {
				const result = original.apply(this, args);

				notify();

				return result;
			};
		}

		window.addEventListener('popstate', notify);

		window.addEventListener('hgt:urlchange', () => {
			const url_ids = readUrlIds();

			if (pending_apply && url_ids !== null && idsKey(url_ids) === pending_apply.key) {
				cancelPendingApply();
			}

			// Problems page: another filter applied -> reload the counters.
			if (MODE === 'problems' && problem_query !== null && problemQuery() !== problem_query) {
				window.clearTimeout(problem_reload_timer);
				problem_reload_timer = window.setTimeout(() => loadData(true), 300);
			}

			const next = readSelectedIds();
			const next_severities = readFilterSeverities();

			if (idsKey(next) !== idsKey(selected_ids)
					|| severitiesKey(next_severities) !== severitiesKey(filter_severities)) {
				selected_ids = next;
				filter_severities = next_severities;
				render();
			}
		});
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Rendering                                                                                                  */
	/* ---------------------------------------------------------------------------------------------------------- */

	function render() {
		if (MODE === 'latest' && !disabled) {
			renderSubfilter();

			return;
		}

		if (!model || disabled) {
			return;
		}

		selected_paths = computeSelectedPaths();

		const fragment = document.createDocumentFragment();
		const rows = [];

		const walk = (list) => {
			for (const node of list) {
				if (search_set !== null && !node.is_root && !search_set.has(node.path)) {
					continue;
				}

				const open = search_set !== null || isOpen(node);

				rows.push(node);
				fragment.appendChild(renderRow(node, open));

				if (open && node.children.length) {
					walk(node.children);
				}
			}
		};

		walk(model.roots);

		if (!rows.some((node) => node.path === focus_path)) {
			focus_path = rows.length ? rows[0].path : null;
		}

		const scroll_top = dom.tree.scrollTop;

		dom.tree.replaceChildren(fragment);

		// Keep the headers aligned with the rows when the tree shows a scrollbar.
		dom.columns.style.paddingRight = `${10 + dom.tree.offsetWidth - dom.tree.clientWidth}px`;
		dom.tree.scrollTop = scroll_top;

		const focusable = focus_path !== null ? rowByPath(focus_path) : null;

		if (focusable) {
			focusable.tabIndex = 0;
		}

		if (!rows.length) {
			showMessage(search_set !== null ? t('no_match') : t('no_groups'));
		}
		else if (!dom.message.classList.contains('is-error')) {
			hideMessage();
		}

		updateFoldButton();
	}

	function renderRow(node, open) {
		const selected = isSelected(node);
		const row = el('div', 'hgt-row', {
			role: 'treeitem',
			'aria-level': node.depth + 1,
			'aria-selected': selected ? 'true' : 'false',
			'data-path': node.path
		});

		row.tabIndex = -1;
		// 22 px gutter on the left for the menu handle.
		row.style.paddingLeft = `${22 + node.depth * CFG.indent}px`;

		if (node.children.length) {
			row.setAttribute('aria-expanded', open ? 'true' : 'false');
		}

		row.classList.toggle('is-selected', selected);
		row.classList.toggle('is-virtual', node.groupid === null && !node.is_root);
		row.classList.toggle('is-root', !!node.is_root);
		row.classList.toggle('has-selection', !selected && !open && containsSelection(node));

		// Expand/collapse arrow.
		const toggle = el('span', `hgt-toggle${node.children.length ? '' : ' is-leaf'}${open ? ' is-open' : ''}`,
			{'aria-hidden': 'true'}
		);

		// Label.
		const label = el('span', 'hgt-label', {text: node.name});

		// Hosts / Data collection: host count in its own column, right-aligned. Empty when 0.
		let host_count = null;

		if (MODE !== 'problems') {
			host_count = el('span', 'hgt-col-count', {
				title: node.hosts ? t('hosts_count', node.hosts) : null,
				text: node.hosts ? String(node.hosts) : ''
			});

			if (node.is_root && node.hosts) {
				host_count.append(countUnit(t('unit_hosts')));
			}
		}

		label.title = node.is_root
			? node.name
			: (node.groupid === null ? `${node.path}\n${t('virtual_tip')}` : node.path);

		// Only problems with the severities checked in the filter (all, if none is checked).
		const problems = nodeProblems(node);
		const sev_name = problems.worst !== null
			? (model.severity_names[problems.worst] || String(problems.worst))
			: '';
		const tip = problems.worst !== null
			? t('problems_tip', problems.count, sev_name) + (filter_severities.size ? ` ${t('sev_filtered')}` : '')
			: '';

		let indicators;

		if (MODE === 'problems') {
			// Same look as Monitoring > Hosts: worst severity dot + number of problems (in the red of "PROBLEM").
			let severity;

			if (problems.worst !== null) {
				// Not a link here (already on Problems): a click selects the row.
				severity = el('span', `hgt-sev is-disabled ${SEVERITY_CLASSES[problems.worst] || ''}`, {
					'data-severity': problems.worst,
					title: tip
				});
			}
			else {
				severity = el('span', 'hgt-sev is-none', {'aria-hidden': 'true'});
			}

			const count = el('span', `hgt-pcount red${problems.count === 0 ? ' is-zero' : ''}`, {
				title: tip || null,
				text: problems.count ? String(problems.count) : ''
			});

			if (node.is_root && problems.count) {
				count.append(countUnit(t('unit_problems')));
			}

			indicators = [severity, count];
		}
		else if (MODE === 'config') {
			// Red dot when hosts of the group have unavailable interfaces (logic of the "Host availability" widget).
			let availability;

			if (node.unavailable > 0) {
				const unavailable_tip = t('unavailable_tip', node.unavailable);

				availability = el('span', 'hgt-sev hgt-unavailable status-red is-disabled', {
					title: unavailable_tip,
					'aria-label': unavailable_tip
				});
			}
			else {
				availability = el('span', 'hgt-sev is-none', {'aria-hidden': 'true'});
			}

			indicators = [availability];
		}
		else {
			// Worst severity dot (opens Problems). <span>, not <button>: theme button styles would deform it.
			let severity;

			if (problems.worst !== null) {
				const hosts_tip = t('hosts_problems_tip', hostsWithProblems(node))
					+ (filter_severities.size ? ` ${t('sev_filtered')}` : '');

				severity = el('span', `hgt-sev ${SEVERITY_CLASSES[problems.worst] || ''}`, {
					role: 'button',
					'data-severity': problems.worst,
					title: hosts_tip,
					'aria-label': hosts_tip
				});

				if (!model.access.problems) {
					severity.classList.add('is-disabled');
				}
			}
			else {
				severity = el('span', 'hgt-sev is-none', {'aria-hidden': 'true'});
			}

			indicators = [severity];
		}

		// Context menu handle on the left edge, visible while hovering the row.
		const handle = el('span', 'hgt-handle', {role: 'button', title: t('actions'), 'aria-label': t('actions'),
			'aria-haspopup': 'menu'
		});

		handle.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">${
			ICONS.more}</svg>`;

		row.append(handle, toggle, label);

		if (host_count) {
			row.append(host_count);
		}

		// Last column: problems (dot, plus count on Problems) or availability.
		const indicator_cell = el('span', 'hgt-col-ind');

		indicator_cell.append(...indicators);
		row.append(indicator_cell);

		return row;
	}

	// Unit after the number, only on the root row ("All"): "123 Hosts" / "45 Problems".
	function countUnit(text) {
		return el('span', 'hgt-count-unit', {text: ` ${text}`});
	}

	// The row handle (always rendered, only its opacity changes).
	function menuAnchor(node) {
		const row = rowByPath(node.path);

		return row.querySelector('.hgt-handle') || row.querySelector('.hgt-label');
	}

	function rowByPath(path) {
		return [...dom.tree.children].find((row) => row.dataset.path === path) || null;
	}

	function showMessage(text, loading = false) {
		dom.message.hidden = false;
		dom.message.className = `hgt-message${loading ? ' is-loading' : ''}`;
		dom.message.textContent = text;
	}

	function showError() {
		showMessage(t('load_error'));
		dom.message.classList.add('is-error');

		const retry = el('button', 'btn-link hgt-retry', {type: 'button', text: t('retry')});

		retry.addEventListener('click', () => loadData());
		dom.message.append(' ', retry);
	}

	function hideMessage() {
		dom.message.hidden = true;
		dom.message.className = 'hgt-message';
		dom.message.textContent = '';
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Monitoring > Latest data: subfilter                                                                        */
	/* ---------------------------------------------------------------------------------------------------------- */

	/*
	 * The native subfilter (table#latest-data-subfilter, inside the tab filter) stays the engine: it is hidden by CSS
	 * while the panel is shown, read here and drawn vertically. A click on an item clicks the native link
	 * (view.setSubfilter / view.unsetSubfilter), so counts, limits and combinations stay the native ones. The page
	 * replaces the native subfilter at every refresh: a MutationObserver redraws the panel.
	 *
	 * Native markup (7.0 and 8.0): one row per section (h3 title); items are span.subfilter (.subfilter-enabled when
	 * selected) with a.link-action[data-key][data-value] and a <sup> count, or a span.grey when the count is 0;
	 * "..." when the server trimmed the list. Tag values: one div.subfilter-option-grid per tag (label "tag: ").
	 */
	function nativeSubfilter() {
		return document.getElementById('latest-data-subfilter');
	}

	function readSubfilterItems(container) {
		const items = [];

		for (const node of container.querySelectorAll('span')) {
			if (node.classList.contains('subfilter')) {
				const link = node.querySelector('.link-action, a');
				const grey = node.querySelector('.grey');
				const sup = node.querySelector('sup');
				const label = link || grey;

				if (!label) {
					continue;
				}

				items.push({
					name: label.textContent,
					count: sup ? sup.textContent.trim() : '',
					selected: node.classList.contains('subfilter-enabled'),
					link: link || null,
					italic: !!(link && link.style.fontStyle === 'italic'),
					key: link ? `${link.dataset.key}\n${link.dataset.value}` : `grey\n${label.textContent}`
				});
			}
			else if (!node.closest('.subfilter') && node.children.length === 0 && node.textContent.trim() === '...') {
				items.push({more: true, key: 'more'});
			}
		}

		return items;
	}

	function readSubfilter() {
		const table = nativeSubfilter();

		if (!table) {
			return null;
		}

		const sections = [];

		table.querySelectorAll('tr').forEach((row, index) => {
			const h3 = row.querySelector('h3');

			if (!h3) {
				return;
			}

			const grids = row.querySelectorAll('.subfilter-option-grid');

			if (grids.length) {
				const groups = [...grids].map((grid) => {
					const label = grid.querySelector('label');
					const tag = label ? label.textContent.replace(/:\s*$/, '') : '';

					return {tag, items: readSubfilterItems(grid)};
				});

				sections.push({id: 'tags', title: h3.textContent, groups});

				return;
			}

			const items = readSubfilterItems(row);
			const first = items.find((item) => item.link);

			sections.push({
				id: first ? first.link.dataset.key : `section${index}`,
				title: h3.textContent,
				items
			});
		});

		return sections;
	}

	// Redraw when the page replaces or changes the native subfilter (refresh, filter or subfilter applied).
	function initSubfilterWatcher() {
		const target = dom.content.querySelector('.tabfilter-content-container') || dom.content;
		let timer = null;

		new MutationObserver(() => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				const table = nativeSubfilter();
				const signature = table ? table.innerHTML : '';

				if (signature !== sub_signature) {
					render();
				}
			}, 50);
		}).observe(target, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
	}

	function subMatches(text) {
		return search_term === '' || text.toLowerCase().includes(search_term);
	}

	function subItemRow(item, depth) {
		const indent = depth === 1 ? 22 : 38;

		if (item.more) {
			return el('div', 'hgt-row hgt-sub-item hgt-sub-more', {title: t('sub_more'), text: '...',
				style: `padding-left: ${indent}px`
			});
		}

		const row = el('div', 'hgt-row hgt-sub-item', {
			role: item.link ? 'button' : null,
			'aria-pressed': item.link ? (item.selected ? 'true' : 'false') : null,
			'aria-disabled': item.link ? null : 'true',
			'data-sub-key': item.key,
			title: item.name,
			style: `padding-left: ${indent}px`
		});

		if (item.link) {
			row.tabIndex = -1;
		}

		row.classList.toggle('is-disabled', !item.link);

		// Same markup as the native subfilter, so the theme styles it the same way (link, selected badge, grey).
		const value = el('span', `subfilter${item.selected ? ' subfilter-enabled' : ''}`);
		const name = item.link
			? el('a', 'link-action', {text: item.name})
			: el('span', 'grey', {text: item.name});

		if (item.italic) {
			name.style.fontStyle = 'italic';
		}

		value.append(name, ' ', el('sup', null, {text: item.count}));
		row.append(value);
		row._sub_item = item;

		return row;
	}

	/*
	 * Accordion header: a section title as the native one (<h3>), or a tag name in bold; then the badge with the
	 * number of selected values. No arrows: a click on the header opens/closes it.
	 */
	function subHeadRow(class_name, title, open, selected_count, attrs) {
		const head = el('div', `hgt-row ${class_name}`, {role: 'button', 'aria-expanded': open ? 'true' : 'false',
			...attrs
		});

		head.tabIndex = -1;
		head.append(el(class_name === 'hgt-sub-head' ? 'h3' : 'span', 'hgt-label', {text: title, title}));

		if (selected_count > 0) {
			head.append(el('span', 'hgt-sub-badge', {text: String(selected_count),
				title: t('sub_active', selected_count)
			}));
		}

		return head;
	}

	/*
	 * Default state: only "Tag values" is open; inside it the priority tags (config.json subfilter_priority_tags)
	 * and the tags with selected values. What the user opens or closes is remembered.
	 */
	function subSectionOpen(id) {
		return Object.prototype.hasOwnProperty.call(sub_sections, id) ? !!sub_sections[id] : id === 'tags';
	}

	function subGroupOpen(tag, has_selected) {
		if (sub_open_groups.has(tag)) {
			return true;
		}

		if (sub_open_groups.has(`!${tag}`)) {
			return false;
		}

		return has_selected || priorityIndex(tag) >= 0;
	}

	// Position of a tag in subfilter_priority_tags, case-insensitive ("Application" = "application"); -1 if absent.
	function priorityIndex(tag) {
		const name = tag.toLowerCase();

		return CFG.subfilter_priority_tags.findIndex((priority) => priority.toLowerCase() === name);
	}

	// Priority tags first (in the configured order), then the others in the native order.
	function sortTagGroups(groups) {
		const rank = (group) => {
			const index = priorityIndex(group.tag);

			return index < 0 ? CFG.subfilter_priority_tags.length : index;
		};

		return groups.map((group, index) => ({group, index}))
			.sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index)
			.map(({group}) => group);
	}

	function renderSubfilter() {
		const sections = readSubfilter();
		const table = nativeSubfilter();
		const searching = search_term !== '';

		sub_signature = table ? table.innerHTML : '';

		const fragment = document.createDocumentFragment();

		for (const section of sections || []) {
			const is_open = searching || subSectionOpen(section.id);
			let selected = 0;
			const body = el('div', 'hgt-sub-body');

			if (section.groups) {
				for (const group of sortTagGroups(section.groups)) {
					const tag_match = subMatches(group.tag);
					const items = group.items.filter((item) => tag_match || (!item.more && subMatches(item.name)));
					const group_selected = group.items.filter((item) => item.selected).length;

					selected += group_selected;

					if (!items.length) {
						continue;
					}

					const group_open = searching || subGroupOpen(group.tag, group_selected > 0);
					const wrap = el('div', `hgt-sub-group${group_open ? ' is-open' : ''}`);

					wrap.append(subHeadRow('hgt-sub-group-head', group.tag, group_open, group_selected,
						{'data-sub-group': group.tag}
					));

					const group_body = el('div', 'hgt-sub-body');

					items.forEach((item) => group_body.append(subItemRow(item, 2)));
					wrap.append(group_body);
					body.append(wrap);
				}
			}
			else {
				const items = section.items.filter((item) => !item.more || !searching)
					.filter((item) => item.more || subMatches(item.name));

				selected = section.items.filter((item) => item.selected).length;
				items.forEach((item) => body.append(subItemRow(item, 1)));
			}

			if (!body.children.length) {
				continue;
			}

			const wrap = el('div', `hgt-sub-section${is_open ? ' is-open' : ''}`, {'data-sub-section': section.id});

			// "Tags" of the native subfilter = the tag names.
			const title = section.id === 'tagnames' ? t('sub_tag_names') : section.title;

			wrap.append(subHeadRow('hgt-sub-head', title, is_open, selected, {}), body);
			fragment.append(wrap);
		}

		const scroll_top = dom.tree.scrollTop;

		dom.tree.replaceChildren(fragment);
		dom.tree.scrollTop = scroll_top;

		// Tab enters the list on its first row; arrows move from there.
		const first_row = dom.tree.querySelector('.hgt-row[tabindex]');

		if (first_row) {
			first_row.tabIndex = 0;
		}

		if (!dom.tree.children.length) {
			showMessage(sections === null ? t('sub_empty') : (searching ? t('no_match') : t('sub_empty')));
		}
		else {
			hideMessage();
		}

		updateSubfilterFoldButton();
	}

	function subAnyOpen() {
		return [...dom.tree.querySelectorAll('.hgt-sub-section, .hgt-sub-group')]
			.some((node) => node.classList.contains('is-open'));
	}

	function updateSubfilterFoldButton() {
		const collapse = subAnyOpen();

		dom.btn_fold.title = t(collapse ? 'collapse_all' : 'expand_all');
		dom.btn_fold.setAttribute('aria-label', dom.btn_fold.title);
		dom.btn_fold.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${
			ICONS[collapse ? 'collapse' : 'expand']}</svg>`;
		dom.btn_fold.disabled = search_term !== '' || !dom.tree.children.length;
	}

	// Expand all / collapse all: sections and tag groups together.
	function foldSubfilter() {
		const collapse = subAnyOpen();

		sub_open_groups.clear();

		for (const section of dom.tree.querySelectorAll('.hgt-sub-section')) {
			sub_sections[section.dataset.subSection] = !collapse;
		}

		for (const head of dom.tree.querySelectorAll('.hgt-sub-group-head')) {
			// "!tag" = closed although it has selected values (open by default).
			sub_open_groups.add(collapse ? `!${head.dataset.subGroup}` : head.dataset.subGroup);
		}

		saveState();
		render();
	}

	function toggleSubfilterHead(head, open = head.getAttribute('aria-expanded') !== 'true') {
		if (search_term !== '') {
			return;
		}

		const section = head.parentElement.dataset.subSection;

		if (head.classList.contains('hgt-sub-head')) {
			sub_sections[section] = open;
		}
		else {
			const tag = head.dataset.subGroup;

			sub_open_groups.delete(tag);
			sub_open_groups.delete(`!${tag}`);
			sub_open_groups.add(open ? tag : `!${tag}`);
		}

		saveState();
		render();
		focusSubRow(head.classList.contains('hgt-sub-head')
			? `.hgt-sub-section[data-sub-section="${CSS.escape(section)}"] > .hgt-sub-head`
			: `.hgt-sub-group-head[data-sub-group="${CSS.escape(head.dataset.subGroup)}"]`
		);
	}

	function activateSubItem(row) {
		const item = row._sub_item;

		if (!item || !item.link) {
			return;
		}

		row.classList.add('is-pending');
		// Native handler (view.setSubfilter / view.unsetSubfilter in the onclick attribute).
		item.link.click();
	}

	function focusSubRow(selector) {
		const row = dom.tree.querySelector(selector);

		if (row) {
			[...dom.tree.querySelectorAll('.hgt-row[tabindex="0"]')].forEach((r) => r.tabIndex = -1);
			row.tabIndex = 0;
			row.focus();
		}
	}

	function bindSubfilterEvents() {
		dom.tree.addEventListener('click', (e) => {
			const row = e.target.closest('.hgt-row');

			if (!row) {
				return;
			}

			if (row.classList.contains('hgt-sub-head') || row.classList.contains('hgt-sub-group-head')) {
				toggleSubfilterHead(row);
			}
			else {
				activateSubItem(row);
			}
		});

		dom.tree.addEventListener('keydown', (e) => {
			const row = e.target.closest('.hgt-row');

			if (!row) {
				return;
			}

			const is_head = row.classList.contains('hgt-sub-head') || row.classList.contains('hgt-sub-group-head');
			const rows = [...dom.tree.querySelectorAll('.hgt-row')].filter((r) => r.offsetParent !== null
				&& !r.classList.contains('hgt-sub-more'));
			const index = rows.indexOf(row);
			const move = (next) => {
				if (next) {
					rows.forEach((r) => r.tabIndex = -1);
					next.tabIndex = 0;
					next.focus();
				}
			};

			switch (e.key) {
				case 'ArrowDown':
					move(rows[index + 1]);
					break;

				case 'ArrowUp':
					move(rows[index - 1]);
					break;

				case 'ArrowRight':
				case 'ArrowLeft':
					if (is_head) {
						toggleSubfilterHead(row, e.key === 'ArrowRight');
					}
					break;

				case 'Enter':
				case ' ':
					if (is_head) {
						toggleSubfilterHead(row);
					}
					else {
						activateSubItem(row);
					}
					break;

				default:
					return;
			}

			e.preventDefault();
		});
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Search                                                                                                     */
	/* ---------------------------------------------------------------------------------------------------------- */

	function updateSearch(term) {
		dom.search_clear.hidden = term === '';
		search_term = term.trim().toLowerCase();

		if (search_term === '' || !model) {
			search_set = null;
		}
		else {
			search_set = new Set();

			for (const node of model.by_path.values()) {
				if (!node.is_root && node.name.toLowerCase().includes(search_term)) {
					// The match, its ancestors and its whole subtree stay visible.
					for (let p = node; p !== null; p = p.parent_node) {
						search_set.add(p.path);
					}

					const add_subtree = (n) => n.children.forEach((c) => {
						search_set.add(c.path);
						add_subtree(c);
					});

					add_subtree(node);
				}
			}
		}

		render();
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Context menu                                                                                               */
	/* ---------------------------------------------------------------------------------------------------------- */

	function zabbixUrl(action, array_key, ids, extra = {}) {
		return pageUrl('zabbix.php', array_key, ids, {action, ...extra});
	}

	function pageUrl(page, array_key, ids, extra = {}) {
		const url = new URL(page, window.location.href);

		url.search = '';

		for (const [key, value] of Object.entries(extra)) {
			url.searchParams.set(key, value);
		}

		ids.forEach((id) => url.searchParams.append(array_key, id));

		return url.toString();
	}

	// Problems page for the node, with the same severities as the Hosts filter.
	function problemsUrl(node) {
		const url = new URL(zabbixUrl('problem.view', 'groupids[]', node.cover, {filter_set: 1}));

		[...filter_severities].sort().forEach((severity) => url.searchParams.append('severities[]', severity));

		return url.toString();
	}

	function openMenu(node, anchor, event) {
		const access = model.access;
		const ids = node.cover;
		const action = (callback) => function (e) {
			closeMenus(this);
			callback();

			if (e && e.preventDefault) {
				e.preventDefault();
			}

			return false;
		};

		const monitoring = [];

		// The other monitoring pages: Problems from Hosts, Hosts from Problems, both from Data collection.
		if (MODE !== 'hosts' && access.hosts) {
			monitoring.push({label: t('hosts'), url: zabbixUrl('host.view', 'groupids[]', ids, {filter_set: 1})});
		}

		if (MODE !== 'problems' && access.problems) {
			monitoring.push({label: t('problems'), url: problemsUrl(node)});
		}

		if (access.latest) {
			monitoring.push({label: t('latest'), url: zabbixUrl('latest.view', 'groupids[]', ids, {filter_set: 1})});
		}

		if (access.inventory) {
			monitoring.push({label: t('inventory'), url: pageUrl('hostinventories.php', 'filter_groups[]', ids,
				{filter_set: 1}
			)});
		}

		const configuration = [];

		if (access.hosts_config && MODE !== 'config') {
			configuration.push({label: t('hosts'), url: zabbixUrl('host.list', 'filter_groups[]', ids,
				{filter_set: 1}
			)});
		}

		if (access.maintenance) {
			configuration.push({label: t('maintenance'), url: zabbixUrl('maintenance.list', 'filter_groups[]', ids,
				{filter_set: 1}
			)});
		}

		const actions = [];

		if (access.create_group) {
			actions.push({label: t('add_nested'),
				clickCallback: action(() => openGroupPopup({}, node.is_root ? '' : `${node.path}/`, anchor))
			});
		}

		if (access.edit_group) {
			if (node.groupid !== null) {
				actions.push({label: t('rename'),
					clickCallback: action(() => openGroupPopup({groupid: node.groupid}, null, anchor, true))
				});
			}
			else {
				actions.push({label: t('rename'), disabled: true});
			}
		}

		if (access.create_maintenance) {
			if (ids.length && !node.is_root) {
				actions.push({label: t('create_maintenance'),
					clickCallback: action(() => openMaintenance(node))
				});
			}
			else {
				actions.push({label: t('create_maintenance'), disabled: true});
			}
		}

		const sections = [];

		if (!monitoring.length && !configuration.length && !actions.length) {
			return;
		}

		if (monitoring.length) {
			sections.push({label: t('monitoring').toUpperCase(), items: monitoring});
		}

		if (configuration.length) {
			sections.push({label: t('configuration').toUpperCase(), items: configuration});
		}

		if (actions.length) {
			sections.push({label: t('actions_section').toUpperCase(), items: actions});
		}

		// Keep the handle visible while its menu is open (until the next click or Escape).
		if (anchor && anchor.classList.contains('hgt-handle')) {
			anchor.setAttribute('aria-expanded', 'true');

			const release = (e) => {
				if (e.type === 'keydown' && e.key !== 'Escape') {
					return;
				}

				anchor.removeAttribute('aria-expanded');
				document.removeEventListener('mousedown', release, true);
				document.removeEventListener('keydown', release, true);
			};

			window.setTimeout(() => {
				document.addEventListener('mousedown', release, true);
				document.addEventListener('keydown', release, true);
			});
		}

		// Native Zabbix popup menu, same look and keyboard handling as the rest of the UI.
		if (window.jQuery && typeof jQuery.fn.menuPopup === 'function') {
			try {
				jQuery(anchor).menuPopup(sections, jQuery.Event(event), {
					position: {of: anchor, my: 'left top', at: 'left bottom'}
				});

				return;
			}
			catch (e) {
				console.warn('[hostgrouptree] menuPopup failed, using fallback menu', e);
			}
		}

		openFallbackMenu(sections, anchor);
	}

	function closeMenus(item) {
		try {
			if (item && window.jQuery) {
				jQuery(item).closest('.menu-popup-top').menuPopup('close', null);
			}
		}
		catch (e) {
			// Ignore.
		}

		closeFallbackMenu();
	}

	let fallback_menu = null;

	function openFallbackMenu(sections, anchor) {
		closeFallbackMenu();

		const menu = el('ul', 'hgt-menu', {role: 'menu'});

		for (const section of sections) {
			menu.appendChild(el('li', 'hgt-menu-header', {text: section.label}));

			for (const item of section.items) {
				const li = el('li', null, {role: 'none'});

				if (item.disabled) {
					li.appendChild(el('span', 'is-disabled', {role: 'menuitem', 'aria-disabled': 'true',
						text: item.label
					}));
					menu.appendChild(li);
					continue;
				}

				const link = el('a', null, {role: 'menuitem', href: item.url || '#', text: item.label});

				if (item.clickCallback) {
					link.addEventListener('click', (e) => {
						e.preventDefault();
						item.clickCallback.call(link, e);
					});
				}

				li.appendChild(link);
				menu.appendChild(li);
			}
		}

		document.body.appendChild(menu);

		const rect = anchor.getBoundingClientRect();

		menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
		menu.style.top = `${Math.min(rect.bottom + 2, window.innerHeight - menu.offsetHeight - 8)}px`;

		fallback_menu = menu;
		menu.querySelector('a').focus();

		window.setTimeout(() => document.addEventListener('mousedown', outsideClose, true));
		document.addEventListener('keydown', escClose, true);
	}

	function outsideClose(e) {
		if (fallback_menu && !fallback_menu.contains(e.target)) {
			closeFallbackMenu();
		}
	}

	function escClose(e) {
		if (e.key === 'Escape') {
			closeFallbackMenu();
		}
	}

	function closeFallbackMenu() {
		if (fallback_menu) {
			fallback_menu.remove();
			fallback_menu = null;
			document.removeEventListener('mousedown', outsideClose, true);
			document.removeEventListener('keydown', escClose, true);
		}
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Create host group (Super admin)                                                                            */
	/* ---------------------------------------------------------------------------------------------------------- */

	/*
	 * Host group form: new group (with a name prefix, for "Add group") or existing group (params.groupid, "Rename").
	 *
	 * - Form as a page (Zabbix 7.0): opened directly.
	 * - Form as a popup: opened by the native "Create host group" button or group link of Data collection >
	 *   Host groups, so the dialog opens exactly as Zabbix opens it (with the dialog id its own script expects);
	 *   the request travels in sessionStorage (one use, 60 s). After saving, the host group list is shown.
	 */
	function openGroupPopup(params, prefill_name, trigger_element, select_name = false) {
		if (model && model.group_form === 'page') {
			openGroupPage(params, prefill_name);

			return;
		}

		// In place, on the current page (falls back to the host group list page if the popup API is missing).
		if (openFormInPlace('hostgroup.edit', params, trigger_element, (dialogue) => {
			if (prefill_name) {
				prefillName(dialogue, prefill_name);
			}
			else if (select_name) {
				waitFor(() => dialogue && dialogue.querySelector('[name="name"]'), (field) => {
					field.focus();

					if (typeof field.select === 'function') {
						field.select();
					}
				});
			}
		}, params.groupid ? 'group_updated' : 'group_created')) {
			return;
		}

		const node = params.groupid ? model.by_groupid.get(String(params.groupid)) : null;
		const request = {
			kind: params.groupid ? 'rename' : 'create',
			groupid: params.groupid ? String(params.groupid) : null,
			name: prefill_name || '',
			select_name,
			stage: 'list',
			ts: Date.now()
		};

		try {
			window.sessionStorage.setItem(GROUP_KEY, JSON.stringify(request));
		}
		catch (e) {
			// No automation without storage: the list page opens anyway.
		}

		// Rename: filter the list on the group name, so its link is on the first page.
		window.location.assign(node
			? zabbixUrl('hostgroup.list', '', [], {filter_set: 1, filter_name: node.path})
			: zabbixUrl('hostgroup.list', '', [])
		);
	}

	/*
	 * Opens a native form popup (e.g. "hostgroup.edit") on the current page.
	 *
	 * The form script finds its dialog with overlays_stack.getById(<id>), where <id> is the dialog id the native page
	 * uses, which differs between versions. The module opens the dialog with the id learned on a previous run (or a
	 * guess) and, while the dialog loads, answers a lookup of an unknown id with this dialog and remembers that id
	 * (localStorage), so from the next time the dialog opens with the right id directly.
	 *
	 * Returns false if the popup API is not available (the caller then uses the list page).
	 */
	const DIALOGUE_IDS_KEY = 'hostgrouptree.dialogueids';

	// Dialog just opened by the module, whose id may still be unknown: {action, overlay, until}.
	let pending_form = null;

	// Ids learned for open dialogs: id -> overlay. Valid only while the dialog is in the page.
	const dialogue_aliases = new Map();

	function loadDialogueIds() {
		try {
			return JSON.parse(window.localStorage.getItem(DIALOGUE_IDS_KEY)) || {};
		}
		catch (e) {
			return {};
		}
	}

	function isOpenOverlay(overlay) {
		const element = overlay && overlay.$dialogue ? overlay.$dialogue[0] : null;

		return !!element && element.isConnected;
	}

	function hookOverlayLookup() {
		const stack = window.overlays_stack;

		if (!stack || typeof stack.getById !== 'function') {
			return false;
		}

		if (!stack.hgt_hooked) {
			const original = stack.getById;

			stack.getById = function (id) {
				const found = original.apply(this, arguments);

				if (found || typeof id !== 'string') {
					return found;
				}

				// An id already learned for a dialog that is still open.
				if (dialogue_aliases.has(id)) {
					const overlay = dialogue_aliases.get(id);

					if (isOpenOverlay(overlay)) {
						return overlay;
					}

					dialogue_aliases.delete(id);
				}

				// A dialog the module has just opened (still in the page) looked up with another id of the same kind
				// (e.g. "hostgroup..." for "hostgroup.edit"): that is its id. Never a closed dialog, never other dialogs.
				if (!pending_form || Date.now() > pending_form.until || !isOpenOverlay(pending_form.overlay)) {
					pending_form = null;

					return found;
				}

				const kind = pending_form.action.split('.')[0].toLowerCase();

				if (!id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(kind)) {
					return found;
				}

				dialogue_aliases.set(id, pending_form.overlay);

				try {
					const ids = loadDialogueIds();

					ids[pending_form.action] = id;
					window.localStorage.setItem(DIALOGUE_IDS_KEY, JSON.stringify(ids));
				}
				catch (e) {
					// Not remembered: the lookup is answered again next time.
				}

				return pending_form.overlay;
			};

			stack.hgt_hooked = true;
		}

		return true;
	}

	function openFormInPlace(action, params, trigger_element, on_open, success_key) {
		if (!CFG.open_forms_in_place || typeof window.PopUp !== 'function' || !hookOverlayLookup()) {
			return false;
		}

		const dialogueid = loadDialogueIds()[action] || `hgt-${action.replace(/\W/g, '-')}`;

		// No answer from the hook while PopUp checks whether this dialog is already open.
		pending_form = null;

		try {
			const overlay = window.PopUp(action, params, {
				dialogueid,
				dialogue_class: 'modal-popup-static',
				prevent_navigation: true,
				trigger_element
			});

			if (!overlay) {
				return false;
			}

			pending_form = {action, overlay, until: Date.now() + 15000};

			const dialogue = overlay.$dialogue ? overlay.$dialogue[0] : null;

			on_open(dialogue);

			if (dialogue) {
				dialogue.addEventListener('dialogue.submit', (e) => {
					const success = e.detail && e.detail.success;

					try {
						if (success && typeof window.addMessage === 'function'
								&& typeof window.makeMessageBox === 'function') {
							window.clearMessages && window.clearMessages();
							window.addMessage(window.makeMessageBox('good', success.messages || [],
								success.title || t(success_key)
							));
						}
					}
					catch (err) {
						// Message is cosmetic.
					}

					loadData();
				}, {once: true});
			}

			return true;
		}
		catch (error) {
			console.warn(`[hostgrouptree] ${action} popup failed, using the list page`, error);

			return false;
		}
	}

	function groupFormFromList() {
		let request = null;

		try {
			request = JSON.parse(window.sessionStorage.getItem(GROUP_KEY));
		}
		catch (e) {
			return;
		}

		if (!request || request.stage !== 'list' || Date.now() - request.ts > 60000) {
			return;
		}

		const findTarget = () => {
			if (request.kind === 'rename') {
				const id = CSS.escape(request.groupid);

				return document.querySelector(`main table a[data-groupid="${id}"]`)
					|| [...document.querySelectorAll('main table a[href*="hostgroup.edit"]')]
						.find((a) => new URL(a.href, window.location.href).searchParams.get('groupid') === request.groupid);
			}

			return document.querySelector('.js-create-hostgroup, [data-action="hostgroup.edit"]')
				|| [...document.querySelectorAll('header button, .header-controls button, main > header button')]
					.find((b) => /group|grupp/i.test(b.textContent))
				|| document.querySelector('.header-controls button');
		};

		const run = () => waitFor(findTarget, (target) => {
			try {
				window.sessionStorage.removeItem(GROUP_KEY);

				// If the form opens as a page instead, the edit page prefills the name.
				if (request.kind === 'create' && request.name) {
					window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({name: request.name, ts: Date.now()}));
				}
			}
			catch (e) {
				// Ignore.
			}

			const before = new Set(document.querySelectorAll('.overlay-dialogue'));

			target.click();

			if (request.kind === 'create' && request.name) {
				prefillName(null, request.name);
			}
			else if (request.select_name) {
				waitFor(() => [...document.querySelectorAll('.overlay-dialogue')]
					.filter((d) => !before.has(d))
					.map((d) => d.querySelector('[name="name"]'))
					.find(Boolean),
					(field) => {
						field.focus();

						if (typeof field.select === 'function') {
							field.select();
						}
					}
				);
			}
		}, 8000, () => console.warn('[hostgrouptree] host group: native button/link not found'));

		if (document.readyState === 'complete') {
			window.setTimeout(run, 300);
		}
		else {
			window.addEventListener('load', () => window.setTimeout(run, 300), {once: true});
		}
	}

	/*
	 * The popup content loads asynchronously and its form script may initialize the fields after they appear:
	 * wait for the "name" field (input, textarea or Zabbix custom element) in the host group popup, set the value,
	 * and set it again for a while if the form script resets it. Stops as soon as the user types something else.
	 */
	function prefillName(dialogue, value) {
		const started = Date.now();
		let filled_at = null;

		const findField = () => {
			const scopes = [
				dialogue,
				...document.querySelectorAll('.overlay-dialogue[data-dialogueid="hostgroup_edit"]'),
				...[...document.querySelectorAll('.overlay-dialogue')].reverse()
			];

			for (const scope of scopes) {
				const field = scope ? scope.querySelector('[name="name"]') : null;

				if (field) {
					return field;
				}
			}

			return document.querySelector('#hostgroup-form [name="name"], form[name="hostgroupForm"] [name="name"]');
		};

		const getValue = (field) => (field.value === undefined || field.value === null) ? '' : String(field.value);

		const setValue = (field) => {
			const proto = field instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: (field instanceof HTMLInputElement ? HTMLInputElement.prototype : null);

			if (proto) {
				Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
			}
			else {
				field.value = value;
			}

			field.dispatchEvent(new Event('input', {bubbles: true}));
			field.dispatchEvent(new Event('change', {bubbles: true}));

			const focusable = field.matches('input, textarea') ? field : field.querySelector('input, textarea');

			if (focusable) {
				focusable.focus();

				if (typeof focusable.setSelectionRange === 'function') {
					focusable.setSelectionRange(value.length, value.length);
				}
			}
		};

		const attempt = () => {
			const field = findField();

			if (field) {
				const current = getValue(field);

				if (filled_at === null) {
					if (current === '') {
						setValue(field);
					}

					filled_at = Date.now();
				}
				else if (current === '') {
					setValue(field);
				}
				else if (current !== value) {
					return;	// The user is typing.
				}

				if (Date.now() - filled_at < 3000) {
					window.setTimeout(attempt, 100);
				}
			}
			else if (Date.now() - started < 10000) {
				window.setTimeout(attempt, 100);
			}
			else {
				console.warn('[hostgrouptree] host group name field not found. Fields in open dialogs:',
					[...document.querySelectorAll('.overlay-dialogue [name]')].map((el) =>
						`${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`
					)
				);
			}
		};

		attempt();
	}

	// Zabbix 7.0: the host group form is a page. The name prefix travels in sessionStorage (one use, 60 s).
	function openGroupPage(params, prefill_name) {
		const extra = {action: 'hostgroup.edit'};

		if (params.groupid) {
			extra.groupid = params.groupid;
		}

		if (prefill_name) {
			try {
				window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({name: prefill_name, ts: Date.now()}));
			}
			catch (e) {
				// No prefill without storage.
			}
		}

		window.location.assign(pageUrl('zabbix.php', '', [], extra));
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Create maintenance                                                                                         */
	/* ---------------------------------------------------------------------------------------------------------- */

	// Polls fn() every 100 ms until it returns something, then calls done(result). Gives up after timeout.
	function waitFor(fn, done, timeout = 10000, on_timeout = null) {
		const started = Date.now();

		const attempt = () => {
			let result = null;

			try {
				result = fn();
			}
			catch (e) {
				result = null;
			}

			if (result) {
				done(result);
			}
			else if (Date.now() - started < timeout) {
				window.setTimeout(attempt, 100);
			}
			else if (on_timeout) {
				on_timeout();
			}
		};

		attempt();
	}

	function findDialogueField(dialogue, dialogueid, name) {
		const scopes = [
			dialogue,
			...document.querySelectorAll(`.overlay-dialogue[data-dialogueid="${dialogueid}"]`)
		];

		for (const scope of scopes) {
			const field = scope ? scope.querySelector(`[name="${name}"]`) : null;

			if (field) {
				return field;
			}
		}

		return null;
	}

	function setFieldValue(field, value) {
		const proto = field instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: (field instanceof HTMLInputElement ? HTMLInputElement.prototype : null);

		if (proto) {
			Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
		}
		else {
			field.value = value;
		}

		field.dispatchEvent(new Event('input', {bubbles: true}));
		field.dispatchEvent(new Event('change', {bubbles: true}));
	}

	function maintenanceData(node) {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
			+ `${pad(now.getHours())}:${pad(now.getMinutes())}`;

		return {
			name: `${node.path} ${stamp}`,
			groups: node.cover.map((id) => {
				const group = model.by_groupid.get(id);

				return {id, name: group ? group.path : id};
			}),
			period_minutes: CFG.maintenance_period_minutes,
			ts: Date.now()
		};
	}

	/*
	 * New maintenance with: name = group + date/time, the group(s) of the node, one period "One time only" of 1 hour
	 * starting now. Nothing is saved: the native form opens filled in and the user confirms it.
	 *
	 * The form is opened by the native "Create maintenance period" button of Data collection > Maintenance, so it
	 * opens exactly as Zabbix opens it (popup or page, with the dialog id its own script expects). The data travels
	 * in sessionStorage (one use, 60 s).
	 */
	function openMaintenance(node) {
		try {
			window.sessionStorage.setItem(MAINTENANCE_KEY, JSON.stringify({...maintenanceData(node), stage: 'list'}));
		}
		catch (e) {
			// No prefill without storage: the list page opens anyway.
		}

		window.location.assign(zabbixUrl('maintenance.list', '', []));
	}

	function readMaintenanceData(stage) {
		try {
			const data = JSON.parse(window.sessionStorage.getItem(MAINTENANCE_KEY));

			if (data && typeof data.name === 'string' && data.stage === stage && Date.now() - data.ts < 60000) {
				return data;
			}
		}
		catch (e) {
			// Ignore.
		}

		return null;
	}

	function createMaintenanceFromList() {
		const data = readMaintenanceData('list');

		if (!data) {
			return;
		}

		const findButton = () => document.querySelector('.js-create-maintenance, .js-create, [data-action="maintenance.edit"]')
			|| [...document.querySelectorAll('header button, .header-controls button, main > header button')]
				.find((b) => /maintenance|manutenzion/i.test(b.textContent))
			|| document.querySelector('.header-controls button');

		const run = () => waitFor(findButton, (button) => {
			const before = new Set(document.querySelectorAll('.overlay-dialogue'));

			// If the form is a page, the edit page reads this stage.
			try {
				window.sessionStorage.setItem(MAINTENANCE_KEY, JSON.stringify({...data, stage: 'form'}));
			}
			catch (e) {
				// Ignore.
			}

			button.click();
			fillMaintenanceForm(null, data, false, before);
		}, 8000, () => console.warn('[hostgrouptree] maintenance: "Create maintenance period" button not found'));

		// After the page scripts have bound their handlers.
		if (document.readyState === 'complete') {
			window.setTimeout(run, 300);
		}
		else {
			window.addEventListener('load', () => window.setTimeout(run, 300), {once: true});
		}
	}

	/*
	 * Fills the native maintenance form (popup or page): name, host groups, and one period added through the native
	 * "Add" period dialog with its defaults (One time only, starting now, 1 hour). Each step is skipped if its field is
	 * not found, leaving the rest of the form to the user.
	 */
	function fillMaintenanceForm(dialogue, data, in_page = false, before = new Set()) {
		// Popup: a newly opened dialog with the name and host group fields (never the page behind it). Page: main form.
		const root = () => {
			if (in_page) {
				const name = document.querySelector('main form [name="name"]');

				return name ? name.closest('form') : null;
			}

			const scopes = dialogue ? [dialogue] : [...document.querySelectorAll('.overlay-dialogue')].reverse();
			const found = scopes.find((d) => !before.has(d) && d.querySelector('[name="name"]')
				&& d.querySelector('.multiselect[id^="groupids_"]'));

			return found ? found.querySelector('form') || found : null;
		};

		waitFor(root, (form) => {
			try {
				window.sessionStorage.removeItem(MAINTENANCE_KEY);
			}
			catch (e) {
				// Ignore.
			}

			const name = form.querySelector('[name="name"]');

			if (name && String(name.value || '') === '') {
				setFieldValue(name, data.name);
			}

			// Host groups (jQuery multiselect of Zabbix).
			try {
				const ms = form.querySelector('.multiselect[id^="groupids_"]');

				if (ms && window.jQuery && typeof jQuery.fn.multiSelect === 'function' && data.groups.length) {
					const current = (jQuery(ms).multiSelect('getData') || []).map((item) => String(item.id));
					const missing = data.groups.filter((group) => !current.includes(String(group.id)));

					if (missing.length) {
						jQuery(ms).multiSelect('addData', missing);
					}
				}
			}
			catch (e) {
				console.warn('[hostgrouptree] maintenance: host groups not set', e);
			}

			addMaintenancePeriod(form, data);
		}, 10000, () => console.warn('[hostgrouptree] maintenance form not found'));
	}

	function addMaintenancePeriod(form, data) {
		// Already has a period: nothing to do.
		if (form.querySelector('[name^="timeperiods["]')) {
			return;
		}

		const visible = (el) => el.offsetParent !== null;
		const add = form.querySelector('#timeperiods .js-add, [id^="timeperiods"] .js-add')
			|| [...form.querySelectorAll('[id*="timeperiod"] button, [id*="timeperiod"] a')]
				.find((el) => visible(el) && /add|aggiungi/i.test(el.textContent))
			// Periods table "Add" link of the first (visible) tab; the dialog footer is outside the form.
			|| [...form.querySelectorAll('button, a')]
				.find((el) => visible(el) && /^\s*(add|aggiungi)\s*$/i.test(el.textContent));

		if (!add) {
			console.warn('[hostgrouptree] maintenance: period "Add" button not found');

			return;
		}

		const before = new Set(document.querySelectorAll('.overlay-dialogue'));

		add.click();

		// The period dialog: a new overlay with the period type field. Its defaults are One time only / now / 1 hour.
		waitFor(() => [...document.querySelectorAll('.overlay-dialogue')]
			.find((d) => !before.has(d) && d.querySelector('[name="timeperiod_type"]')),
			(period_dialogue) => {
				const field = (name) => period_dialogue.querySelector(`[name="${name}"]`);
				const type = field('timeperiod_type');

				// 0 = TIMEPERIOD_TYPE_ONETIME.
				if (type && String(type.value) !== '0') {
					setFieldValue(type, '0');
				}

				const minutes = Number(data.period_minutes) > 0 ? Number(data.period_minutes) : 60;
				const length = [
					['period_days', String(Math.floor(minutes / 1440))],
					['period_hours', String(Math.floor((minutes % 1440) / 60))],
					['period_minutes', String(minutes % 60)]
				];

				length.forEach(([name, value]) => {
					const input = field(name);

					if (input) {
						setFieldValue(input, value);
					}
				});

				// Primary button of the dialog footer ("Add").
				window.setTimeout(() => {
					const submit = period_dialogue.querySelector('.overlay-dialogue-footer button:not(.btn-alt)');

					if (submit) {
						submit.click();
					}
				}, 200);
			},
			8000,
			() => console.warn('[hostgrouptree] maintenance: period dialog not found')
		);
	}

	/* ---------------------------------------------------------------------------------------------------------- */
	/* Events                                                                                                     */
	/* ---------------------------------------------------------------------------------------------------------- */

	function nodeFromEvent(e) {
		const row = e.target.closest('.hgt-row');

		return row && model ? model.by_path.get(row.dataset.path) || null : null;
	}

	function isOpen(node) {
		return node.is_root ? !root_collapsed : expanded.has(node.path);
	}

	function setOpen(node, open) {
		if (node.is_root) {
			root_collapsed = !open;
		}
		else if (open) {
			expanded.add(node.path);
		}
		else {
			expanded.delete(node.path);
		}
	}

	function toggleNode(node, open = !isOpen(node)) {
		if (!node.children.length || search_set !== null) {
			return;
		}

		setOpen(node, open);
		saveState();
		render();
	}

	// Alt+click on an arrow / "*" key: the node and all its descendants, opened or closed together.
	function toggleSubtree(node, open = !isOpen(node)) {
		if (!node.children.length || search_set !== null) {
			return;
		}

		const walk = (n) => {
			if (n.children.length) {
				// Collapsing the root keeps it open: only its branches are closed.
				if (!(n.is_root && !open)) {
					setOpen(n, open);
				}

				n.children.forEach(walk);
			}
		};

		walk(node);
		saveState();
		render();
	}

	// At least one group (not the root) is expanded.
	function anyGroupOpen() {
		for (const node of model.by_path.values()) {
			if (!node.is_root && node.children.length && expanded.has(node.path)) {
				return true;
			}
		}

		return false;
	}

	// Expand all / collapse all: one button, its action depends on the state of the tree.
	function updateFoldButton() {
		if (MODE === 'latest') {
			updateSubfilterFoldButton();

			return;
		}

		if (!dom.btn_fold || !model) {
			return;
		}

		const collapse = anyGroupOpen();
		const title = `${t(collapse ? 'collapse_all' : 'expand_all')}\n${t('subtree_tip')}`;

		dom.btn_fold.title = title;
		dom.btn_fold.setAttribute('aria-label', t(collapse ? 'collapse_all' : 'expand_all'));
		dom.btn_fold.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${
			ICONS[collapse ? 'collapse' : 'expand']}</svg>`;
		// While searching every match is shown expanded: nothing to expand or collapse.
		dom.btn_fold.disabled = search_set !== null
			|| ![...model.by_path.values()].some((node) => !node.is_root && node.children.length);
	}

	function focusRow(path) {
		const row = rowByPath(path);

		if (row) {
			[...dom.tree.querySelectorAll('.hgt-row[tabindex="0"]')].forEach((r) => r.tabIndex = -1);
			row.tabIndex = 0;
			row.focus();
			focus_path = path;
		}
	}

	function bindPanelEvents() {
		dom.tree.addEventListener('click', (e) => {
			const node = nodeFromEvent(e);

			if (!node) {
				return;
			}

			if (e.target.closest('.hgt-toggle')) {
				if (e.altKey) {
					toggleSubtree(node);
				}
				else {
					toggleNode(node);
				}
			}
			else if (e.target.closest('.hgt-handle')) {
				openMenu(node, e.target.closest('.hgt-handle'), e);
			}
			else if (e.target.closest('.hgt-sev:not(.is-none):not(.is-disabled)')) {
				if (model.access.problems) {
					window.location.assign(problemsUrl(node));
				}
			}
			else {
				selectNode(node, e.ctrlKey || e.metaKey);
			}
		});

		dom.tree.addEventListener('dblclick', (e) => {
			const node = nodeFromEvent(e);

			if (node && e.target.closest('.hgt-label')) {
				toggleNode(node);
			}
		});

		dom.tree.addEventListener('keydown', (e) => {
			const node = nodeFromEvent(e);

			if (!node) {
				return;
			}

			const rows = [...dom.tree.children];
			const index = rows.findIndex((row) => row.dataset.path === node.path);

			switch (e.key) {
				case 'ArrowDown':
					if (rows[index + 1]) {
						focusRow(rows[index + 1].dataset.path);
					}
					break;

				case 'ArrowUp':
					if (rows[index - 1]) {
						focusRow(rows[index - 1].dataset.path);
					}
					break;

				case 'ArrowRight':
					if (node.children.length && !isOpen(node)) {
						toggleNode(node, true);
						focusRow(node.path);
					}
					else if (node.children.length && rows[index + 1]) {
						focusRow(rows[index + 1].dataset.path);
					}
					break;

				case 'ArrowLeft':
					if (node.children.length && isOpen(node)) {
						toggleNode(node, false);
						focusRow(node.path);
					}
					else if (node.parent_node) {
						focusRow(node.parent_node.path);
					}
					break;

				case 'Enter':
				case ' ':
					selectNode(node, e.ctrlKey || e.metaKey);
					break;

				case '*':
					toggleSubtree(node, true);
					focusRow(node.path);
					break;

				case 'ContextMenu':
					openMenu(node, menuAnchor(node), e);
					break;

				default:
					return;
			}

			e.preventDefault();
		});

		dom.tree.addEventListener('contextmenu', (e) => {
			const node = nodeFromEvent(e);

			if (node) {
				e.preventDefault();
				openMenu(node, menuAnchor(node), e);
			}
		});

		let search_timer = null;

		dom.search_clear.addEventListener('click', () => {
			window.clearTimeout(search_timer);
			dom.search.value = '';
			updateSearch('');
			dom.search.focus();
		});

		dom.search.addEventListener('input', () => {
			dom.search_clear.hidden = dom.search.value === '';
			window.clearTimeout(search_timer);
			search_timer = window.setTimeout(() => updateSearch(dom.search.value), 150);
		});

		dom.search.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				dom.search.value = '';
				updateSearch('');
			}
			else if (e.key === 'ArrowDown' && dom.tree.firstElementChild) {
				e.preventDefault();
				focusRow(dom.tree.firstElementChild.dataset.path);
			}
		});



		dom.btn_fold.addEventListener('click', () => {
			if (MODE === 'latest') {
				foldSubfilter();

				return;
			}

			if (!model || search_set !== null) {
				return;
			}

			if (anyGroupOpen()) {
				// The root stays open, otherwise the tree would be reduced to a single row.
				expanded.clear();
				root_collapsed = false;
			}
			else {
				model.by_path.forEach((node) => node.children.length && setOpen(node, true));
			}

			saveState();
			render();
		});


		dom.btn_hide.addEventListener('click', () => setPanelCollapsed(true));
		dom.btn_show.addEventListener('click', () => setPanelCollapsed(false));

		// Resize.
		dom.resizer.addEventListener('pointerdown', (e) => {
			if (panel_collapsed) {
				return;
			}

			e.preventDefault();
			dom.resizer.setPointerCapture(e.pointerId);

			const start_x = e.clientX;
			const start_width = panel_width;

			dom.layout.classList.add('hgt-resizing');

			const move = (ev) => {
				panel_width = clamp(start_width + ev.clientX - start_x, CFG.min_width, CFG.max_width);
				dom.layout.style.setProperty('--hgt-width', `${panel_width}px`);
			};

			const up = () => {
				dom.resizer.removeEventListener('pointermove', move);
				dom.resizer.removeEventListener('pointerup', up);
				dom.resizer.removeEventListener('pointercancel', up);
				dom.layout.classList.remove('hgt-resizing');
				saveState();
				applyPanelGeometry();
			};

			dom.resizer.addEventListener('pointermove', move);
			dom.resizer.addEventListener('pointerup', up);
			dom.resizer.addEventListener('pointercancel', up);
		});

		dom.resizer.addEventListener('dblclick', () => {
			panel_width = CFG.default_width;
			saveState();
			applyPanelGeometry();
		});
	}

	function prefillMaintenancePage() {
		const data = readMaintenanceData('form');

		if (!data) {
			return;
		}

		const start = () => fillMaintenanceForm(null, data, true);

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', start);
		}
		else {
			start();
		}
	}

	function prefillGroupPage() {
		let data = null;

		try {
			data = JSON.parse(window.sessionStorage.getItem(PREFILL_KEY));
			window.sessionStorage.removeItem(PREFILL_KEY);
		}
		catch (e) {
			return;
		}

		if (!data || typeof data.name !== 'string' || Date.now() - data.ts > 60000) {
			return;
		}

		const fill = () => {
			const field = document.querySelector('main form [name="name"]') || document.querySelector('[name="name"]');

			if (field && 'value' in field && String(field.value || '') === '') {
				field.value = data.name;
				field.dispatchEvent(new Event('input', {bubbles: true}));
				field.focus();

				if (typeof field.setSelectionRange === 'function') {
					field.setSelectionRange(data.name.length, data.name.length);
				}
			}
		};

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fill);
		}
		else {
			fill();
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	}
	else {
		boot();
	}
})();
