/*
 * Host group tree widget (Zabbix 7.0 / 8.0 dashboards).
 *
 * The tree of the Host group tree module as a navigation widget: clicking a group broadcasts it to the widgets
 * that use this widget as their host group source (_hostgroupid, _hostgroupids). "All" broadcasts no group (or,
 * with root/excluded groups in the widget filter, all the groups of the tree).
 *
 * The selection is shared by all the Host group tree widgets of the same dashboard: a copy of the widget on
 * another dashboard page picks it up when that page is shown (sessionStorage, per browser tab). The open
 * branches are shared too (localStorage).
 *
 * Keep this file ASCII-only (non-ASCII as \uXXXX): module assets may be served without charset.
 */

class CWidgetHostGroupTree extends CWidget {

	static ROOT_PATH = '\u0000root';

	static ICONS = {
		// Expand all (chevrons pointing outwards) / collapse all (chevrons pointing inwards).
		expand: '<path d="m4.5 6 3.5-3.5L11.5 6M4.5 10l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
		collapse: '<path d="m4.5 2.5 3.5 3.5 3.5-3.5M4.5 13.5l3.5-3.5 3.5 3.5" fill="none" stroke="currentColor"'
			+ ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
		close: '<path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6"'
			+ ' stroke-linecap="round"/>',
		more: '<circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>'
			+ '<circle cx="12.5" cy="8" r="1.4" fill="currentColor"/>'
	};

	static SEVERITY_CLASSES = ['na-bg', 'info-bg', 'warning-bg', 'average-bg', 'high-bg', 'disaster-bg'];

	static I18N = {
		en: {
			title: 'Host groups',
			search: 'Search host group...',
			expand_all: 'Expand all',
			collapse_all: 'Collapse all',
			subtree_tip: 'Alt+click on an arrow: the whole branch',
			all_groups: 'All',
			clear_search: 'Clear search',
			monitoring: 'Monitoring',
			configuration: 'Configuration',
			hosts: 'Hosts',
			problems: 'Problems',
			latest: 'Latest data',
			inventory: 'Inventory',
			maintenance: 'Maintenance',
			actions: 'Actions',
			hosts_count: '%1 hosts',
			// Units after the totals of the "All" row.
			unit_hosts: 'hosts',
			unit_problems: 'problems',
			problems_tip: '%1 problems, worst severity: %2',
			virtual_tip: 'Not a host group: selects all its subgroups',
			no_match: 'No matching groups',
			no_groups: 'No host groups'
		},
		it: {
			title: 'Gruppi host',
			search: 'Cerca un gruppo...',
			expand_all: 'Espandi tutto',
			collapse_all: 'Comprimi tutto',
			subtree_tip: 'Alt+clic su una freccia: tutto il ramo',
			all_groups: 'Tutti',
			clear_search: 'Cancella ricerca',
			monitoring: 'Monitoraggio',
			configuration: 'Configurazione',
			hosts: 'Host',
			problems: 'Problemi',
			latest: 'Dati recenti',
			inventory: 'Inventario',
			maintenance: 'Manutenzione',
			actions: 'Azioni',
			hosts_count: '%1 host',
			unit_hosts: 'host',
			unit_problems: 'problemi',
			problems_tip: '%1 problemi, severit\u00E0 peggiore: %2',
			virtual_tip: 'Non \u00E8 un gruppo host: seleziona tutti i sottogruppi',
			no_match: 'Nessun gruppo trovato',
			no_groups: 'Nessun gruppo host'
		}
	};

	#model = null;
	#dom = null;

	// Selected rows (paths). Empty = "All".
	#selected = new Set();
	#expanded = new Set();
	#root_collapsed = false;
	#search_set = null;
	#focus_path = null;
	#scroll_top = 0;
	#search_timer = null;

	// Not onInitialize(): it runs inside the base constructor, before the private fields of this class exist.
	onStart() {
		super.onStart();

		this.#loadExpanded();
		this.#selected = new Set(this.#loadSelection() || []);
	}

	// The tree fills the widget, like the panel (rows go to the widget borders).
	hasPadding() {
		return false;
	}

	onActivate() {
		super.onActivate();

		// Another copy of the widget (another dashboard page) may have changed the selection meanwhile.
		const stored = this.#loadSelection();

		if (stored !== null && this.#model !== null && this.#isValidSelection(stored)
				&& this.#selectionKey(stored) !== this.#selectionKey([...this.#selected])) {
			this.#selected = new Set(stored);
			this.#loadExpanded();
			this.#expandToSelection();
			this.#render();
			this.#broadcast();
		}
		else if (this.#model !== null) {
			// Open branches may have changed on another page: redraw only in that case.
			const before = this.#expandedKey();

			this.#loadExpanded();

			if (this.#expandedKey() !== before) {
				this.#render();
			}
		}

		if (this.#dom !== null) {
			this.#dom.tree.scrollTop = this.#scroll_top;
		}
	}

	onDeactivate() {
		super.onDeactivate();

		if (this.#dom !== null) {
			this.#scroll_top = this.#dom.tree.scrollTop;
		}
	}

	onClearContents() {
		this.#dom = null;
	}

	setContents(response) {
		const first = this.#model === null;

		this.#model = this.#buildModel(response);

		if (this.#dom === null || !this._body.contains(this.#dom.root)) {
			this._body.innerHTML = '';
			this._body.appendChild(this.#buildDom());
		}

		// Selection from another page, or rows that no longer exist (filter changed): back to a valid one.
		let changed = false;
		const stored = this.#loadSelection();

		if (first && stored !== null && this.#isValidSelection(stored)) {
			this.#selected = new Set(stored);
		}

		if (!this.#isValidSelection([...this.#selected])) {
			this.#selected = new Set();
			changed = true;
		}

		if (first) {
			this.#expandToSelection();
		}

		this.#updateSearch(this.#dom.search.value, false);
		this.#render();

		if (first || changed) {
			this.#saveSelection();
			this.#broadcast();
		}
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Storage                                                                                                */
	/* ------------------------------------------------------------------------------------------------------ */

	// Shared by every Host group tree widget of the dashboard (all its pages).
	#storageKey(name) {
		const dashboard = this._dashboard.dashboardid ?? this._dashboard.templateid ?? window.location.pathname;

		return `hostgrouptree.widget.${name}.${dashboard}`;
	}

	#loadSelection() {
		try {
			const data = JSON.parse(window.sessionStorage.getItem(this.#storageKey('selection')));

			return data && Array.isArray(data.paths) ? data.paths.map(String) : null;
		}
		catch (e) {
			return null;
		}
	}

	#saveSelection() {
		try {
			window.sessionStorage.setItem(this.#storageKey('selection'), JSON.stringify({paths: [...this.#selected]}));
		}
		catch (e) {
			// Storage unavailable: the selection stays on this page only.
		}
	}

	#loadExpanded() {
		try {
			const data = JSON.parse(window.localStorage.getItem(this.#storageKey('tree'))) || {};

			this.#expanded = new Set(Array.isArray(data.expanded) ? data.expanded.map(String) : []);
			this.#root_collapsed = !!data.root_collapsed;
		}
		catch (e) {
			this.#expanded = new Set();
			this.#root_collapsed = false;
		}
	}

	#expandedKey() {
		return `${this.#root_collapsed ? 1 : 0}|${[...this.#expanded].sort().join('\n')}`;
	}

	#saveExpanded() {
		try {
			window.localStorage.setItem(this.#storageKey('tree'), JSON.stringify({
				expanded: [...this.#expanded],
				root_collapsed: this.#root_collapsed
			}));
		}
		catch (e) {
			// Storage unavailable.
		}
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Model                                                                                                  */
	/* ------------------------------------------------------------------------------------------------------ */

	#buildModel(data) {
		const by_path = new Map();
		const roots = [];
		const nodes = Array.isArray(data.nodes) ? data.nodes : [];

		const counters = (raw) => ({
			hosts: Number(raw.hosts) || 0,
			sev_counts: Array.isArray(raw.sev_counts) ? raw.sev_counts.map((n) => Number(n) || 0) : [0, 0, 0, 0, 0, 0]
		});

		for (const raw of nodes) {
			const node = {
				path: String(raw.path),
				name: String(raw.name),
				parent: raw.parent === null ? null : String(raw.parent),
				groupid: raw.groupid === null ? null : String(raw.groupid),
				...counters(raw),
				children: [],
				parent_node: null,
				depth: 0,
				cover: null
			};

			by_path.set(node.path, node);
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

		// Groups broadcast for a node: the group itself, or the top-most real groups below a virtual node.
		const cover = (node) => {
			if (node.cover === null) {
				node.cover = node.groupid !== null ? [node.groupid] : node.children.flatMap(cover);
			}

			return node.cover;
		};

		by_path.forEach(cover);

		const root = {
			path: CWidgetHostGroupTree.ROOT_PATH,
			name: this.#t('all_groups'),
			parent: null,
			groupid: null,
			...counters(data.total || {}),
			children: roots,
			parent_node: null,
			depth: 0,
			// Root/excluded groups in the widget filter: "All" = the groups of the tree, otherwise no group.
			cover: data.filtered ? roots.flatMap((node) => node.cover) : [],
			is_root: true
		};

		roots.forEach((node) => node.parent_node = root);
		by_path.set(root.path, root);

		return {
			by_path,
			root,
			severity_names: data.severity_names || {},
			access: data.access || {},
			show_problems: data.show_problems !== false,
			show_hosts: data.show_hosts !== false
		};
	}

	#problems(node) {
		let count = 0;
		let worst = null;

		node.sev_counts.forEach((n, severity) => {
			if (n > 0) {
				count += n;
				worst = severity;
			}
		});

		return {count, worst};
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Selection and broadcast                                                                                */
	/* ------------------------------------------------------------------------------------------------------ */

	#isValidSelection(paths) {
		return paths.every((path) => this.#model.by_path.has(path) && path !== CWidgetHostGroupTree.ROOT_PATH);
	}

	#selectionKey(paths) {
		return [...paths].sort().join('\n');
	}

	#isSelected(node) {
		return node.is_root ? this.#selected.size === 0 : this.#selected.has(node.path);
	}

	#containsSelection(node) {
		return node.children.some((child) => this.#selected.has(child.path) || this.#containsSelection(child));
	}

	#selectedGroupIds() {
		if (this.#selected.size === 0) {
			return this.#model.root.cover.slice();
		}

		const ids = new Set();

		for (const path of this.#selected) {
			this.#model.by_path.get(path).cover.forEach((id) => ids.add(id));
		}

		return [...ids];
	}

	#broadcast() {
		const ids = this.#selectedGroupIds();

		this.broadcast({
			[CWidgetsData.DATA_TYPE_HOST_GROUP_ID]: ids.length ? [ids[0]] : [],
			[CWidgetsData.DATA_TYPE_HOST_GROUP_IDS]: ids
		});
	}

	/*
	 * Click (or Enter) on a row: selects the group and opens its children; on the group already selected alone,
	 * opens/closes it without broadcasting again. Ctrl/Cmd: adds/removes the group, nothing is opened.
	 */
	#activateNode(node, additive) {
		if (!additive) {
			const alone = node.is_root ? this.#selected.size === 0
				: this.#selected.size === 1 && this.#selected.has(node.path);

			if (alone) {
				this.#toggleNode(node);

				return;
			}

			if (node.children.length && !this.#isOpen(node) && this.#search_set === null) {
				this.#setOpen(node, true);
				this.#saveExpanded();
			}
		}

		this.#selectNode(node, additive);
	}

	#selectNode(node, additive) {
		if (node.is_root) {
			this.#selected.clear();
		}
		else if (additive) {
			if (this.#selected.has(node.path)) {
				this.#selected.delete(node.path);
			}
			else {
				this.#selected.add(node.path);
			}
		}
		else {
			this.#selected = new Set([node.path]);
		}

		this.#focus_path = node.path;
		this.#saveSelection();
		this.#render();
		this.#broadcast();
	}

	#expandToSelection() {
		for (const path of this.#selected) {
			const node = this.#model.by_path.get(path);

			for (let p = node ? node.parent_node : null; p !== null; p = p.parent_node) {
				this.#setOpen(p, true);
			}
		}

		this.#saveExpanded();
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Tree state                                                                                             */
	/* ------------------------------------------------------------------------------------------------------ */

	#isOpen(node) {
		return node.is_root ? !this.#root_collapsed : this.#expanded.has(node.path);
	}

	#setOpen(node, open) {
		if (node.is_root) {
			this.#root_collapsed = !open;
		}
		else if (open) {
			this.#expanded.add(node.path);
		}
		else {
			this.#expanded.delete(node.path);
		}
	}

	#toggleNode(node, open = !this.#isOpen(node)) {
		if (!node.children.length || this.#search_set !== null) {
			return;
		}

		this.#setOpen(node, open);
		this.#saveExpanded();
		this.#render();
	}

	// Alt+click on an arrow / "*" key: the node and all its descendants, opened or closed together.
	#toggleSubtree(node, open = !this.#isOpen(node)) {
		if (!node.children.length || this.#search_set !== null) {
			return;
		}

		const walk = (n) => {
			if (n.children.length) {
				// Collapsing the root keeps it open: only its branches are closed.
				if (!(n.is_root && !open)) {
					this.#setOpen(n, open);
				}

				n.children.forEach(walk);
			}
		};

		walk(node);
		this.#saveExpanded();
		this.#render();
	}

	#anyGroupOpen() {
		for (const node of this.#model.by_path.values()) {
			if (!node.is_root && node.children.length && this.#expanded.has(node.path)) {
				return true;
			}
		}

		return false;
	}

	#foldAll() {
		if (this.#model === null || this.#search_set !== null) {
			return;
		}

		if (this.#anyGroupOpen()) {
			// The root stays open, otherwise the tree would be reduced to a single row.
			this.#expanded.clear();
			this.#root_collapsed = false;
		}
		else {
			this.#model.by_path.forEach((node) => node.children.length && this.#setOpen(node, true));
		}

		this.#saveExpanded();
		this.#render();
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* DOM                                                                                                    */
	/* ------------------------------------------------------------------------------------------------------ */

	#t(key, ...args) {
		const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
		const strings = CWidgetHostGroupTree.I18N;
		let str = (strings[lang] && strings[lang][key]) || strings.en[key] || key;

		args.forEach((arg, i) => {
			str = str.replace(`%${i + 1}`, String(arg));
		});

		return str;
	}

	#el(tag, class_name, attrs = {}) {
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

	#iconButton(class_name, title, icon) {
		const btn = this.#el('button', `hgtw-icon-btn ${class_name}`, {type: 'button', title, 'aria-label': title});

		// Static markup from ICONS only, never user data.
		btn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${
			CWidgetHostGroupTree.ICONS[icon]}</svg>`;

		return btn;
	}

	#buildDom() {
		const dom = {};

		dom.root = this.#el('div', 'hgtw');

		// Header: expand/collapse all on the left edge, then the title (no "hide": the widget is always shown).
		const header = this.#el('div', 'hgtw-header');

		dom.btn_fold = this.#iconButton('hgtw-btn-fold', this.#t('expand_all'), 'expand');
		header.append(dom.btn_fold, this.#el('span', 'hgtw-title', {text: this.#t('title')}));

		dom.tree = this.#el('div', 'hgtw-tree', {role: 'tree', 'aria-label': this.#t('title')});
		dom.message = this.#el('div', 'hgtw-message');
		dom.message.hidden = true;

		// Search at the bottom, as in the panel.
		const search_wrap = this.#el('div', 'hgtw-search');

		dom.search = this.#el('input', null, {type: 'search', placeholder: this.#t('search'),
			'aria-label': this.#t('search'), autocomplete: 'off'
		});
		dom.search_clear = this.#iconButton('hgtw-search-clear', this.#t('clear_search'), 'close');
		dom.search_clear.hidden = true;
		dom.search_clear.tabIndex = -1;
		search_wrap.append(dom.search, dom.search_clear);

		dom.root.append(header, dom.tree, dom.message, search_wrap);

		this.#dom = dom;
		this.#bindEvents(dom);

		return dom.root;
	}

	#render() {
		const dom = this.#dom;

		if (this.#model === null || dom === null) {
			return;
		}

		const fragment = document.createDocumentFragment();
		const rows = [];

		const walk = (list) => {
			for (const node of list) {
				if (this.#search_set !== null && !node.is_root && !this.#search_set.has(node.path)) {
					continue;
				}

				const open = this.#search_set !== null || this.#isOpen(node);

				rows.push(node);
				fragment.appendChild(this.#renderRow(node, open));

				if (open && node.children.length) {
					walk(node.children);
				}
			}
		};

		walk([this.#model.root]);

		if (!rows.some((node) => node.path === this.#focus_path)) {
			this.#focus_path = rows.length ? rows[0].path : null;
		}

		const scroll_top = dom.tree.scrollTop;

		dom.tree.replaceChildren(fragment);
		dom.tree.scrollTop = scroll_top;

		const focusable = this.#focus_path !== null ? this.#rowByPath(this.#focus_path) : null;

		if (focusable) {
			focusable.tabIndex = 0;
		}

		const empty = rows.length <= 1 && this.#model.root.children.length === 0;
		const no_match = this.#search_set !== null && rows.length <= 1;

		dom.message.hidden = !(empty || no_match);
		dom.message.textContent = no_match ? this.#t('no_match') : (empty ? this.#t('no_groups') : '');

		this.#updateFoldButton();
	}

	#renderRow(node, open) {
		const selected = this.#isSelected(node);
		const row = this.#el('div', 'hgtw-row', {
			role: 'treeitem',
			'aria-level': node.depth + 1,
			'aria-selected': selected ? 'true' : 'false',
			'data-path': node.path
		});

		row.tabIndex = -1;
		row.style.paddingLeft = `${22 + node.depth * 16}px`;

		if (node.children.length) {
			row.setAttribute('aria-expanded', open ? 'true' : 'false');
		}

		row.classList.toggle('is-selected', selected);
		row.classList.toggle('is-virtual', node.groupid === null && !node.is_root);
		row.classList.toggle('is-root', !!node.is_root);
		row.classList.toggle('has-selection', !selected && !open && this.#containsSelection(node));

		const toggle = this.#el('span', `hgtw-toggle${node.children.length ? '' : ' is-leaf'}${open ? ' is-open' : ''}`,
			{'aria-hidden': 'true'}
		);

		const label = this.#el('span', 'hgtw-label', {text: node.name});

		label.title = node.is_root
			? node.name
			: (node.groupid === null ? `${node.path}\n${this.#t('virtual_tip')}` : node.path);

		// Context menu handle on the left edge, visible while hovering the row.
		const handle = this.#el('span', 'hgtw-handle', {role: 'button', title: this.#t('actions'),
			'aria-label': this.#t('actions'), 'aria-haspopup': 'menu'
		});

		handle.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">${
			CWidgetHostGroupTree.ICONS.more}</svg>`;

		row.append(handle, toggle, label);

		// Number of hosts in its own column, right-aligned. Empty when 0. "All" shows the unit.
		if (this.#model.show_hosts) {
			const count = this.#el('span', 'hgtw-col-count', {
				title: node.hosts ? this.#t('hosts_count', node.hosts) : null,
				text: node.hosts ? String(node.hosts) : ''
			});

			if (node.is_root && node.hosts) {
				count.append(this.#el('span', 'hgtw-count-unit', {text: ` ${this.#t('unit_hosts')}`}));
			}

			row.append(count);
		}

		// Problems: worst severity dot + number of problems (in the red of "PROBLEM").
		if (this.#model.show_problems) {
			const problems = this.#problems(node);
			const cell = this.#el('span', 'hgtw-col-ind');
			const tip = problems.worst !== null
				? this.#t('problems_tip', problems.count,
					this.#model.severity_names[problems.worst] || String(problems.worst))
				: null;

			if (problems.worst !== null) {
				cell.append(this.#el('span',
					`hgtw-sev ${CWidgetHostGroupTree.SEVERITY_CLASSES[problems.worst] || ''}`,
					{'data-severity': problems.worst, title: tip}
				));
			}
			else {
				cell.append(this.#el('span', 'hgtw-sev is-none', {'aria-hidden': 'true'}));
			}

			const count = this.#el('span', `hgtw-pcount red${problems.count === 0 ? ' is-zero' : ''}`, {
				title: tip,
				text: problems.count ? String(problems.count) : ''
			});

			if (node.is_root && problems.count) {
				count.append(this.#el('span', 'hgtw-count-unit', {text: ` ${this.#t('unit_problems')}`}));
			}

			cell.append(count);
			row.append(cell);
		}

		return row;
	}

	#updateFoldButton() {
		const collapse = this.#anyGroupOpen();
		const btn = this.#dom.btn_fold;

		btn.title = `${this.#t(collapse ? 'collapse_all' : 'expand_all')}\n${this.#t('subtree_tip')}`;
		btn.setAttribute('aria-label', this.#t(collapse ? 'collapse_all' : 'expand_all'));
		btn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${
			CWidgetHostGroupTree.ICONS[collapse ? 'collapse' : 'expand']}</svg>`;
		// While searching every match is shown expanded: nothing to expand or collapse.
		btn.disabled = this.#search_set !== null
			|| ![...this.#model.by_path.values()].some((node) => !node.is_root && node.children.length);
	}

	#rowByPath(path) {
		return [...this.#dom.tree.children].find((row) => row.dataset.path === path) || null;
	}

	#focusRow(path) {
		const row = this.#rowByPath(path);

		if (row) {
			[...this.#dom.tree.querySelectorAll('.hgtw-row[tabindex="0"]')].forEach((r) => r.tabIndex = -1);
			row.tabIndex = 0;
			row.focus();
			this.#focus_path = path;
		}
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Search                                                                                                 */
	/* ------------------------------------------------------------------------------------------------------ */

	#updateSearch(term, render = true) {
		this.#dom.search_clear.hidden = term === '';

		const search_term = term.trim().toLowerCase();

		if (search_term === '' || this.#model === null) {
			this.#search_set = null;
		}
		else {
			this.#search_set = new Set();

			for (const node of this.#model.by_path.values()) {
				if (!node.is_root && node.name.toLowerCase().includes(search_term)) {
					// The match, its ancestors and its whole subtree stay visible.
					for (let p = node; p !== null; p = p.parent_node) {
						this.#search_set.add(p.path);
					}

					const add_subtree = (n) => n.children.forEach((c) => {
						this.#search_set.add(c.path);
						add_subtree(c);
					});

					add_subtree(node);
				}
			}
		}

		if (render) {
			this.#render();
		}
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Context menu                                                                                           */
	/* ------------------------------------------------------------------------------------------------------ */

	#pageUrl(page, array_key, ids, extra = {}) {
		const url = new URL(page, window.location.href);

		url.search = '';

		for (const [key, value] of Object.entries(extra)) {
			url.searchParams.set(key, value);
		}

		ids.forEach((id) => url.searchParams.append(array_key, id));

		return url.toString();
	}

	#zabbixUrl(action, array_key, ids, extra = {}) {
		return this.#pageUrl('zabbix.php', array_key, ids, {action, ...extra});
	}

	#openMenu(node, anchor, event) {
		const access = this.#model.access;
		const ids = node.cover;
		const monitoring = [];
		const configuration = [];

		if (access.hosts) {
			monitoring.push({label: this.#t('hosts'),
				url: this.#zabbixUrl('host.view', 'groupids[]', ids, {filter_set: 1})
			});
		}

		if (access.problems) {
			monitoring.push({label: this.#t('problems'),
				url: this.#zabbixUrl('problem.view', 'groupids[]', ids, {filter_set: 1})
			});
		}

		if (access.latest) {
			monitoring.push({label: this.#t('latest'),
				url: this.#zabbixUrl('latest.view', 'groupids[]', ids, {filter_set: 1})
			});
		}

		if (access.inventory) {
			monitoring.push({label: this.#t('inventory'),
				url: this.#pageUrl('hostinventories.php', 'filter_groups[]', ids, {filter_set: 1})
			});
		}

		if (access.hosts_config) {
			configuration.push({label: this.#t('hosts'),
				url: this.#zabbixUrl('host.list', 'filter_groups[]', ids, {filter_set: 1})
			});
		}

		if (access.maintenance) {
			configuration.push({label: this.#t('maintenance'),
				url: this.#zabbixUrl('maintenance.list', 'filter_groups[]', ids, {filter_set: 1})
			});
		}

		const sections = [];

		if (monitoring.length) {
			sections.push({label: this.#t('monitoring').toUpperCase(), items: monitoring});
		}

		if (configuration.length) {
			sections.push({label: this.#t('configuration').toUpperCase(), items: configuration});
		}

		if (!sections.length || !window.jQuery || typeof jQuery.fn.menuPopup !== 'function') {
			return;
		}

		// Keep the handle visible while its menu is open (until the next click or Escape).
		if (anchor.classList.contains('hgtw-handle')) {
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

		// Native Zabbix popup menu.
		jQuery(anchor).menuPopup(sections, jQuery.Event(event), {
			position: {of: anchor, my: 'left top', at: 'left bottom'}
		});
	}

	#menuAnchor(node) {
		const row = this.#rowByPath(node.path);

		return row.querySelector('.hgtw-handle') || row.querySelector('.hgtw-label');
	}

	/* ------------------------------------------------------------------------------------------------------ */
	/* Events                                                                                                 */
	/* ------------------------------------------------------------------------------------------------------ */

	#nodeFromEvent(e) {
		const row = e.target.closest('.hgtw-row');

		return row && this.#model !== null ? this.#model.by_path.get(row.dataset.path) || null : null;
	}

	#bindEvents(dom) {
		dom.btn_fold.addEventListener('click', () => this.#foldAll());

		dom.tree.addEventListener('click', (e) => {
			const node = this.#nodeFromEvent(e);

			if (!node) {
				return;
			}

			if (e.target.closest('.hgtw-toggle')) {
				if (e.altKey) {
					this.#toggleSubtree(node);
				}
				else {
					this.#toggleNode(node);
				}
			}
			else if (e.target.closest('.hgtw-handle')) {
				this.#openMenu(node, e.target.closest('.hgtw-handle'), e);
			}
			else {
				this.#activateNode(node, e.ctrlKey || e.metaKey);
			}
		});

		dom.tree.addEventListener('contextmenu', (e) => {
			const node = this.#nodeFromEvent(e);

			if (node) {
				e.preventDefault();
				this.#openMenu(node, this.#menuAnchor(node), e);
			}
		});

		dom.tree.addEventListener('keydown', (e) => {
			const node = this.#nodeFromEvent(e);

			if (!node) {
				return;
			}

			const rows = [...dom.tree.children];
			const index = rows.findIndex((row) => row.dataset.path === node.path);

			switch (e.key) {
				case 'ArrowDown':
					if (rows[index + 1]) {
						this.#focusRow(rows[index + 1].dataset.path);
					}
					break;

				case 'ArrowUp':
					if (rows[index - 1]) {
						this.#focusRow(rows[index - 1].dataset.path);
					}
					break;

				case 'ArrowRight':
					if (node.children.length && !this.#isOpen(node)) {
						this.#toggleNode(node, true);
						this.#focusRow(node.path);
					}
					else if (node.children.length && rows[index + 1]) {
						this.#focusRow(rows[index + 1].dataset.path);
					}
					break;

				case 'ArrowLeft':
					if (node.children.length && this.#isOpen(node)) {
						this.#toggleNode(node, false);
						this.#focusRow(node.path);
					}
					else if (node.parent_node) {
						this.#focusRow(node.parent_node.path);
					}
					break;

				case 'Enter':
				case ' ':
					this.#activateNode(node, e.ctrlKey || e.metaKey);
					this.#focusRow(node.path);
					break;

				case '*':
					this.#toggleSubtree(node, true);
					this.#focusRow(node.path);
					break;

				case 'ContextMenu':
					this.#openMenu(node, this.#menuAnchor(node), e);
					break;

				default:
					return;
			}

			e.preventDefault();
		});

		dom.search_clear.addEventListener('click', () => {
			window.clearTimeout(this.#search_timer);
			dom.search.value = '';
			this.#updateSearch('');
			dom.search.focus();
		});

		dom.search.addEventListener('input', () => {
			dom.search_clear.hidden = dom.search.value === '';
			window.clearTimeout(this.#search_timer);
			this.#search_timer = window.setTimeout(() => this.#updateSearch(dom.search.value), 150);
		});

		dom.search.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				dom.search.value = '';
				this.#updateSearch('');
			}
			else if (e.key === 'ArrowDown' && dom.tree.firstElementChild) {
				e.preventDefault();
				this.#focusRow(dom.tree.firstElementChild.dataset.path);
			}
		});
	}
}
