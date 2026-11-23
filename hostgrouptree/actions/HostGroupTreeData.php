<?php declare(strict_types = 0);

namespace Modules\HostGroupTree\Actions;

use API;
use CController;
use CControllerResponseData;
use CRoleHelper;
use CSeverityHelper;
use CWebUser;

/**
 * Returns the host group tree as JSON:
 *
 * {
 *   "nodes": [
 *     {"path": "Sites/Stabilimenti/Bagnasco", "name": "Bagnasco", "parent": "Sites/Stabilimenti",
 *      "groupid": "42" | null, "hosts": 12, "problems": 3, "severity": 4 | null,
 *      "sev_counts": [0, 0, 1, 0, 2, 0]},
 *     ...
 *   ],
 *   "severity_names": {"0": "Not classified", ...},
 *   "access": {"problems": true, "latest": true, "inventory": true, "hosts_config": false,
 *              "edit_group": false, "create_group": false},
 *   "total": {"hosts": 120, "problems": 7, "severity": 5}
 * }
 *
 * - Nodes with "groupid": null are "virtual": the name prefix exists only as part of other group names
 *   (e.g. "Sites" when only "Sites/Sede" is defined) or the user has no permission on it.
 * - "hosts", "problems" and "severity" are aggregated over the whole subtree, counting every host and
 *   every problem only once, which matches the native filter (subgroups are included).
 * - All API calls run with the permissions of the current user.
 */
class HostGroupTreeData extends CController {

	// Defaults of config.json (module folder). Missing or invalid values fall back to these.
	private const CONFIG_DEFAULTS = [
		// Pages where the tree is shown.
		'pages' => [
			'monitoring_hosts' => true,
			'monitoring_problems' => true,
			'data_collection_hosts' => true,
			// Monitoring > Latest data: the native subfilter in the panel (no tree).
			'monitoring_latest' => true
		],
		// Column headers above the tree (Host groups / Hosts / Problems ...).
		'show_column_headers' => false,
		// Expand all / collapse all button in the panel header.
		'show_expand_collapse_buttons' => true,
		// Rename / Add group: open the host group form on the current page (false = through Data collection >
		// Host groups).
		'open_forms_in_place' => true,
		// Seconds between automatic refreshes of the tree counters; 0 = only on page load.
		'refresh_interval' => 60,
		// Length of the period of "Create maintenance", in minutes.
		'maintenance_period_minutes' => 60,
		// Max problems read for the counters on Monitoring > Problems.
		'problem_limit' => 50000,
		// Monitoring > Latest data subfilter: tags listed first in "Tag values", open by default (case-insensitive).
		'subfilter_priority_tags' => ['target', 'component', 'application']
	];

	private array $config = self::CONFIG_DEFAULTS;

	// Public: matches CController::init() in Zabbix 7.0 (a protected override can be a fatal error there).
	public function init(): void {
		// Read-only GET endpoint.
		$this->disableCsrfValidation();
	}

	protected function checkInput(): bool {
		$ret = $this->validateInput([
			// Query string of Monitoring > Problems (all filter fields of the active tab).
			'problem_filter' => 'string',
			// "config": Data collection > Hosts, adds interface availability per group.
			'mode' => 'in config',
			// Query string of the Data collection > Hosts filter (applied fields, without host groups).
			'host_filter' => 'string',
			// Only the module configuration (pages where the tree is disabled ask only for this).
			'config_only' => 'in 1'
		]);

		if (!$ret) {
			$this->setResponse(new CControllerResponseData([
				'main_block' => json_encode(['error' => _('Incorrect request.')])
			]));
		}

		return $ret;
	}

	protected function checkPermissions(): bool {
		// Used by Monitoring > Hosts, Problems, Latest data (configuration only) and Data collection > Hosts.
		return $this->checkAccess(CRoleHelper::UI_MONITORING_HOSTS)
			|| $this->checkAccess(CRoleHelper::UI_MONITORING_PROBLEMS)
			|| $this->hasUiAccess('UI_MONITORING_LATEST_DATA')
			|| $this->hasUiAccess('UI_CONFIGURATION_HOSTS');
	}

	protected function doAction(): void {
		$this->config = self::readConfig();

		if ($this->hasInput('config_only')) {
			$this->setResponse(new CControllerResponseData([
				'main_block' => json_encode(['config' => $this->config])
			]));

			return;
		}

		$groups = API::HostGroup()->get([
			'output' => ['groupid', 'name'],
			'preservekeys' => true
		]);

		// 1. Build the node map from the group names ("A/B/C" => A, A/B, A/B/C).
		$nodes = [];
		$group_path = [];

		foreach ($groups as $groupid => $group) {
			$parts = array_values(array_filter(explode('/', $group['name']), 'strlen'));

			if (!$parts) {
				continue;
			}

			$path = null;

			foreach ($parts as $part) {
				$parent = $path;
				$path = ($path === null) ? $part : $path.'/'.$part;

				if (!array_key_exists($path, $nodes)) {
					$nodes[$path] = [
						'path' => $path,
						'name' => $part,
						'parent' => $parent,
						'groupid' => null,
						'hosts' => 0,
						'events' => []
					];
				}
			}

			$nodes[$path]['groupid'] = (string) $groupid;
			$group_path[$groupid] = $path;
		}

		// 2. Current problems -> events per host.
		$host_events = [];

		if ($nodes) {
			$problems = $this->hasInput('problem_filter')
				? $this->getFilteredProblems($this->getInput('problem_filter'))
				: API::Problem()->get([
					'output' => ['eventid', 'objectid', 'severity'],
					'source' => EVENT_SOURCE_TRIGGERS,
					'object' => EVENT_OBJECT_TRIGGER,
					'suppressed' => false
				]);

			if ($problems) {
				$triggers = API::Trigger()->get([
					'output' => [],
					'selectHosts' => ['hostid'],
					'triggerids' => array_values(array_unique(array_column($problems, 'objectid'))),
					'monitored' => true,
					'preservekeys' => true
				]);

				foreach ($problems as $problem) {
					if (!array_key_exists($problem['objectid'], $triggers)) {
						continue;
					}

					foreach ($triggers[$problem['objectid']]['hosts'] as $host) {
						$host_events[$host['hostid']][$problem['eventid']] = (int) $problem['severity'];
					}
				}
			}
		}

		// 3. Hosts -> distinct counts over every node of the subtree (a host in several groups counts once).
		$total = ['hosts' => 0, 'events' => [], 'unavailable' => 0, 'host_masks' => []];
		$unavailable = ($nodes && $this->getInput('mode', '') === 'config') ? self::getUnavailableHosts() : [];

		foreach ($nodes as &$node) {
			$node['unavailable'] = 0;
			$node['host_masks'] = [];
		}
		unset($node);

		if ($nodes) {
			$host_options = [
				'output' => ['hostid'],
				'selectHostGroups' => ['groupid'],
				'preservekeys' => true
			];
			$hosts = API::Host()->get($host_options + $this->getHostFilterOptions());

			// A filter option not supported by this version: count without the filter rather than fail.
			if ($hosts === false) {
				$hosts = API::Host()->get($host_options) ?: [];
			}

			$total['hosts'] = count($hosts);
			$total['unavailable'] = count(array_intersect_key($unavailable, $hosts));

			foreach ($hosts as $hostid => $host) {
				// Severities of the problems of the host as a bit mask (bit N = severity N), 0 = no problems.
				$mask = 0;

				if (array_key_exists($hostid, $host_events)) {
					$total['events'] = $host_events[$hostid] + $total['events'];

					foreach ($host_events[$hostid] as $severity) {
						$mask |= 1 << $severity;
					}

					$total['host_masks'][$mask] = ($total['host_masks'][$mask] ?? 0) + 1;
				}

				$paths = [];

				foreach ($host['hostgroups'] as $hostgroup) {
					if (!array_key_exists($hostgroup['groupid'], $group_path)) {
						continue;
					}

					for ($p = $group_path[$hostgroup['groupid']]; $p !== null && !array_key_exists($p, $paths);
							$p = $nodes[$p]['parent']) {
						$paths[$p] = true;
					}
				}

				foreach (array_keys($paths) as $p) {
					$nodes[$p]['hosts']++;

					if (array_key_exists($hostid, $unavailable)) {
						$nodes[$p]['unavailable']++;
					}

					if (array_key_exists($hostid, $host_events)) {
						$nodes[$p]['events'] = $host_events[$hostid] + $nodes[$p]['events'];
						$nodes[$p]['host_masks'][$mask] = ($nodes[$p]['host_masks'][$mask] ?? 0) + 1;
					}
				}
			}
		}

		// 4. Output.
		$output_nodes = [];

		foreach ($nodes as $node) {
			$output_nodes[] = [
				'path' => $node['path'],
				'name' => $node['name'],
				'parent' => $node['parent'],
				'groupid' => $node['groupid'],
				'hosts' => $node['hosts'],
				'problems' => count($node['events']),
				'severity' => $node['events'] ? max($node['events']) : null,
				'sev_counts' => self::countBySeverity($node['events']),
				'unavailable' => $node['unavailable'],
				// Hosts with problems by set of severities: {mask: hosts}.
				'host_masks' => (object) $node['host_masks']
			];
		}

		$severity_names = [];

		for ($severity = TRIGGER_SEVERITY_NOT_CLASSIFIED; $severity < TRIGGER_SEVERITY_COUNT; $severity++) {
			$severity_names[$severity] = CSeverityHelper::getName($severity);
		}

		$this->setResponse(new CControllerResponseData([
			'main_block' => json_encode([
				'nodes' => $output_nodes,
				// "All host groups" root of the tree.
				'total' => [
					'hosts' => $total['hosts'],
					'problems' => count($total['events']),
					'severity' => $total['events'] ? max($total['events']) : null,
					'sev_counts' => self::countBySeverity($total['events']),
					'unavailable' => $total['unavailable'],
					'host_masks' => (object) $total['host_masks']
				],
				// Module configuration (config.json).
				'config' => $this->config,
				'severity_names' => $severity_names,
				// How this Zabbix version opens the host group form: "popup" or "page".
				'group_form' => $this->getFormMode('hostgroup.edit', '7.2'),
				// Maintenance form: popup since 6.4 (detected the same way).
				'maintenance_form' => $this->getFormMode('maintenance.edit', '6.4'),
				'access' => [
					'problems' => $this->hasUiAccess('UI_MONITORING_PROBLEMS'),
					'latest' => $this->hasUiAccess('UI_MONITORING_LATEST_DATA'),
					'hosts' => $this->hasUiAccess('UI_MONITORING_HOSTS'),
					'inventory' => $this->hasUiAccess('UI_INVENTORY_HOSTS'),
					'hosts_config' => $this->hasUiAccess('UI_CONFIGURATION_HOSTS'),
					// Admins with write permission can edit host groups, only Super admins can create them.
					'edit_group' => CWebUser::getType() >= USER_TYPE_ZABBIX_ADMIN
						&& $this->hasUiAccess('UI_CONFIGURATION_HOST_GROUPS'),
					'maintenance' => $this->hasUiAccess('UI_CONFIGURATION_MAINTENANCE'),
					'create_maintenance' => CWebUser::getType() >= USER_TYPE_ZABBIX_ADMIN
						&& $this->hasUiAccess('UI_CONFIGURATION_MAINTENANCE'),
					'create_group' => CWebUser::getType() == USER_TYPE_SUPER_ADMIN
						&& $this->hasUiAccess('UI_CONFIGURATION_HOST_GROUPS')
				]
			])
		]));
	}

	/**
	 * config.json in the module folder, merged over CONFIG_DEFAULTS (unknown keys and wrong types are ignored).
	 * The file may contain line (//) and block comments.
	 */
	private static function readConfig(?string $file = null): array {
		$config = self::CONFIG_DEFAULTS;
		$file = $file ?? dirname(__DIR__).'/config.json';

		if (!is_readable($file)) {
			return $config;
		}

		$data = json_decode(self::stripJsonComments((string) file_get_contents($file)), true);

		if (!is_array($data)) {
			return $config;
		}

		foreach (self::CONFIG_DEFAULTS as $key => $default) {
			if (!array_key_exists($key, $data)) {
				continue;
			}

			if (is_array($default) && $default === array_values($default)) {
				// List of strings (subfilter_priority_tags); an empty list is allowed.
				if (is_array($data[$key]) && $data[$key] === array_values($data[$key])) {
					$config[$key] = array_values(array_filter($data[$key], 'is_string'));
				}
			}
			elseif (is_array($default)) {
				// Object of booleans (pages): every key on its own.
				if (is_array($data[$key])) {
					foreach ($default as $sub_key => $sub_default) {
						if (array_key_exists($sub_key, $data[$key]) && is_bool($data[$key][$sub_key])) {
							$config[$key][$sub_key] = $data[$key][$sub_key];
						}
					}
				}
			}
			elseif (is_bool($default) && is_bool($data[$key])) {
				$config[$key] = $data[$key];
			}
			elseif (is_int($default) && is_numeric($data[$key]) && $data[$key] >= 0) {
				$config[$key] = (int) $data[$key];
			}
		}

		$config['maintenance_period_minutes'] = max(1, $config['maintenance_period_minutes']);
		$config['problem_limit'] = max(1, $config['problem_limit']);

		return $config;
	}

	/**
	 * JSON with comments -> JSON: removes line (//) and block comments outside strings.
	 */
	private static function stripJsonComments(string $json): string {
		$out = '';
		$length = strlen($json);
		$in_string = false;

		for ($i = 0; $i < $length; $i++) {
			$char = $json[$i];

			if ($in_string) {
				$out .= $char;

				if ($char === '\\' && $i + 1 < $length) {
					$out .= $json[++$i];
				}
				elseif ($char === '"') {
					$in_string = false;
				}
			}
			elseif ($char === '"') {
				$in_string = true;
				$out .= $char;
			}
			elseif ($char === '/' && $i + 1 < $length && $json[$i + 1] === '/') {
				while ($i < $length && $json[$i] !== "\n") {
					$i++;
				}

				$out .= "\n";
			}
			elseif ($char === '/' && $i + 1 < $length && $json[$i + 1] === '*') {
				$end = strpos($json, '*/', $i + 2);
				$i = ($end === false) ? $length : $end + 1;
				$out .= ' ';
			}
			else {
				$out .= $char;
			}
		}

		return $out;
	}

	/**
	 * Hosts with at least one unavailable interface, with the logic of the "Host availability" dashboard widget
	 * (default settings): monitored hosts not in maintenance; agent, SNMP, IPMI and JMX interfaces plus active
	 * agent checks; "not available" = INTERFACE_AVAILABLE_FALSE.
	 *
	 * @return array  hostid => true
	 */
	private static function getUnavailableHosts(): array {
		$options = [
			'output' => ['hostid', 'active_available'],
			'selectInterfaces' => ['type', 'available'],
			'filter' => [
				'status' => HOST_STATUS_MONITORED,
				'maintenance_status' => HOST_MAINTENANCE_STATUS_OFF
			],
			'preservekeys' => true
		];

		try {
			$hosts = API::Host()->get($options);
		}
		catch (\Throwable $e) {
			$hosts = false;
		}

		// Versions without active agent availability.
		if ($hosts === false) {
			$options['output'] = ['hostid'];
			$hosts = API::Host()->get($options) ?: [];
		}

		$unavailable = [];

		foreach ($hosts as $hostid => $host) {
			$is_unavailable = array_key_exists('active_available', $host)
				&& $host['active_available'] == INTERFACE_AVAILABLE_FALSE;

			foreach ($host['interfaces'] as $interface) {
				if ($interface['available'] == INTERFACE_AVAILABLE_FALSE) {
					$is_unavailable = true;
					break;
				}
			}

			if ($is_unavailable) {
				$unavailable[$hostid] = true;
			}
		}

		return $unavailable;
	}

	/**
	 * Problems matching the filter of Monitoring > Problems, except "Host groups" (counted per group by the tree).
	 * Uses the same function as the native problem list (CScreenProblem::getData), so every filter field is applied
	 * exactly as in the list. If that is not available, applies the main fields through the API.
	 *
	 * @return array  [['eventid' => ..., 'objectid' => ..., 'severity' => ...], ...]
	 */
	private function getFilteredProblems(string $query): array {
		parse_str(ltrim($query, '?'), $params);

		$filter = self::problemFilter(is_array($params) ? $params : []);

		try {
			if (class_exists('CScreenProblem') && method_exists('CScreenProblem', 'getData')) {
				$data = \CScreenProblem::getData($filter, (int) $this->config['problem_limit']);
				$problems = [];

				foreach ($data['problems'] ?? [] as $eventid => $problem) {
					if (isset($problem['objectid'], $problem['severity'])) {
						$problems[] = [
							'eventid' => $problem['eventid'] ?? $eventid,
							'objectid' => $problem['objectid'],
							'severity' => $problem['severity']
						];
					}
				}

				return $problems;
			}
		}
		catch (\Throwable $e) {
			// Fall back to the API below.
		}

		return self::getProblemsByApi($filter);
	}

	/**
	 * Filter array in the format of the Problems page, from its URL parameters.
	 */
	private static function problemFilter(array $params): array {
		$c = static function (string $name, $default) {
			return defined($name) ? constant($name) : $default;
		};

		$filter = [
			'show' => $c('TRIGGERS_OPTION_RECENT_PROBLEM', 1),
			'groupids' => [],
			'hostids' => [],
			'triggerids' => [],
			'name' => '',
			'severities' => [],
			'age_state' => 0,
			'age' => 14,
			'inventory' => [],
			'evaltype' => $c('TAG_EVAL_TYPE_AND_OR', 0),
			'tags' => [],
			'show_tags' => $c('SHOW_TAGS_3', 3),
			'tag_name_format' => $c('TAG_NAME_FULL', 0),
			'tag_priority' => '',
			'show_suppressed' => 0,
			'unacknowledged' => 0,
			'acknowledgement_status' => $c('ZBX_ACK_STATUS_ALL', 0),
			'acknowledged_by_me' => 0,
			'compact_view' => 0,
			'show_timeline' => 1,
			'details' => 0,
			'highlight_row' => 0,
			'show_opdata' => $c('OPERATIONAL_DATA_SHOW_NONE', 0),
			'show_symptoms' => 0,
			'from' => 'now-1h',
			'to' => 'now',
			'sort' => 'clock',
			'sortorder' => $c('ZBX_SORT_DOWN', 'DESC')
		];

		foreach ($filter as $key => $default) {
			if (!array_key_exists($key, $params)) {
				continue;
			}

			$value = $params[$key];

			if (is_array($default)) {
				$filter[$key] = is_array($value) ? array_values($value) : [];
			}
			elseif (!is_array($value)) {
				$filter[$key] = $value;
			}
		}

		// Counted per group by the tree.
		$filter['groupids'] = [];

		// Empty rows of the tag and inventory editors.
		$filter['tags'] = array_values(array_filter($filter['tags'], static function ($tag) {
			return is_array($tag) && (($tag['tag'] ?? '') !== '' || ($tag['value'] ?? '') !== '');
		}));
		$filter['inventory'] = array_values(array_filter($filter['inventory'], static function ($row) {
			return is_array($row) && ($row['value'] ?? '') !== '';
		}));

		// "History" mode: the time selector period as timestamps.
		foreach (['from' => true, 'to' => false] as $key => $is_start) {
			if (is_numeric($filter[$key])) {
				$filter[$key] = (int) $filter[$key];
				continue;
			}

			$timestamp = null;

			try {
				$parser = new \CRangeTimeParser();

				if ($parser->parse((string) $filter[$key]) == \CParser::PARSE_SUCCESS) {
					$timestamp = $parser->getDateTime($is_start)->getTimestamp();
				}
			}
			catch (\Throwable $e) {
				// Default below.
			}

			$filter[$key] = $timestamp ?? ($is_start ? time() - SEC_PER_HOUR : time());
		}

		return $filter;
	}

	/**
	 * Fallback: main filter fields applied with problem.get.
	 */
	private static function getProblemsByApi(array $filter): array {
		$options = [
			'output' => ['eventid', 'objectid', 'severity'],
			'source' => EVENT_SOURCE_TRIGGERS,
			'object' => EVENT_OBJECT_TRIGGER
		];

		if (defined('TRIGGERS_OPTION_RECENT_PROBLEM') && $filter['show'] == TRIGGERS_OPTION_RECENT_PROBLEM) {
			$options['recent'] = true;
		}

		if (!$filter['show_suppressed']) {
			$options['suppressed'] = false;
		}

		if ($filter['severities']) {
			$options['severities'] = $filter['severities'];
		}

		if ($filter['hostids']) {
			$options['hostids'] = $filter['hostids'];
		}

		if ($filter['triggerids']) {
			$options['objectids'] = $filter['triggerids'];
		}

		if ($filter['name'] !== '') {
			$options['search'] = ['name' => $filter['name']];
		}

		if ($filter['tags']) {
			$options['evaltype'] = $filter['evaltype'];
			$options['tags'] = $filter['tags'];
		}

		if ($filter['unacknowledged']
				|| (defined('ZBX_ACK_STATUS_UNACK') && $filter['acknowledgement_status'] == ZBX_ACK_STATUS_UNACK)) {
			$options['acknowledged'] = false;
		}
		elseif (defined('ZBX_ACK_STATUS_ACK') && $filter['acknowledgement_status'] == ZBX_ACK_STATUS_ACK) {
			$options['acknowledged'] = true;
		}

		if (!$filter['show_symptoms']) {
			$options['symptom'] = false;
		}

		if ($filter['age_state']) {
			$options['time_from'] = time() - (int) $filter['age'] * SEC_PER_DAY;
		}

		try {
			return API::Problem()->get($options) ?: [];
		}
		catch (\Throwable $e) {
			return [];
		}
	}

	/**
	 * Number of problems per severity: [not classified, information, warning, average, high, disaster].
	 * Lets the frontend apply the Severity filter of the page without another request.
	 *
	 * @param array $events  eventid => severity
	 */
	private static function countBySeverity(array $events): array {
		$counts = array_fill(TRIGGER_SEVERITY_NOT_CLASSIFIED, TRIGGER_SEVERITY_COUNT, 0);

		foreach ($events as $severity) {
			$counts[$severity]++;
		}

		return array_values($counts);
	}

	/**
	 * Whether a form action opens as a popup (JSON layout) or as a full page in this Zabbix version.
	 * Asks the frontend router how the action is registered; falls back to the version number
	 * ($popup_since = first version with the popup).
	 */
	private function getFormMode(string $action, string $popup_since): string {
		try {
			if (class_exists('CRouter')) {
				$router = new \CRouter();

				if (method_exists($router, 'setAction') && method_exists($router, 'getLayout')) {
					$router->setAction($action);
					$layout = $router->getLayout();

					if ($layout !== null) {
						return $layout === 'layout.json' ? 'popup' : 'page';
					}
				}
			}
		}
		catch (\Throwable $e) {
			// Use the version check below.
		}

		return (defined('ZABBIX_VERSION') && version_compare(ZABBIX_VERSION, $popup_since, '<')) ? 'page' : 'popup';
	}

	/**
	 * host.get options for the applied filter of Data collection > Hosts (all fields except host groups), so the
	 * tree counts the hosts the list shows. Empty array on other pages.
	 */
	private function getHostFilterOptions(): array {
		if ($this->getInput('mode', '') !== 'config' || !$this->hasInput('host_filter')) {
			return [];
		}

		parse_str($this->getInput('host_filter'), $f);

		if (!is_array($f)) {
			return [];
		}

		$str = static function ($key) use ($f): string {
			return (array_key_exists($key, $f) && !is_array($f[$key])) ? trim((string) $f[$key]) : '';
		};
		$ids = static function ($key) use ($f): array {
			return (array_key_exists($key, $f) && is_array($f[$key]))
				? array_values(array_filter($f[$key], static fn($id) => is_scalar($id) && ctype_digit((string) $id)))
				: [];
		};

		$options = [];
		$search = array_filter([
			'name' => $str('filter_name'),
			'dns' => $str('filter_dns'),
			'ip' => $str('filter_ip')
		], 'strlen');

		if ($search) {
			$options['search'] = $search;
		}

		$filter = [];

		if ($str('filter_port') !== '') {
			$filter['port'] = $str('filter_port');
		}

		// -1 = any status.
		if ($str('filter_status') !== '' && $str('filter_status') != -1) {
			$filter['status'] = $str('filter_status');
		}

		// Monitored by: the filter values are the ones of the host "monitored_by" field; any other value = any.
		$monitored_by = $str('filter_monitored_by');

		if (defined('ZBX_MONITORED_BY_ANY') && $monitored_by !== '' && $monitored_by == ZBX_MONITORED_BY_ANY) {
			$monitored_by = '';
		}

		if (defined('ZBX_MONITORED_BY_SERVER') && defined('ZBX_MONITORED_BY_PROXY')
				&& defined('ZBX_MONITORED_BY_PROXY_GROUP') && $monitored_by !== ''
				&& in_array((int) $monitored_by, [ZBX_MONITORED_BY_SERVER, ZBX_MONITORED_BY_PROXY,
					ZBX_MONITORED_BY_PROXY_GROUP], true)) {
			$filter['monitored_by'] = (int) $monitored_by;

			if ((int) $monitored_by === ZBX_MONITORED_BY_PROXY && $ids('filter_proxyids')) {
				$options['proxyids'] = $ids('filter_proxyids');
			}
			elseif ((int) $monitored_by === ZBX_MONITORED_BY_PROXY_GROUP && $ids('filter_proxy_groupids')) {
				$filter['proxy_groupid'] = $ids('filter_proxy_groupids');
			}
		}

		if ($filter) {
			$options['filter'] = $filter;
		}

		if ($ids('filter_templates')) {
			$options['templateids'] = $ids('filter_templates');
		}

		$tags = (array_key_exists('filter_tags', $f) && is_array($f['filter_tags']))
			? array_values(array_filter($f['filter_tags'], static function ($tag) {
				return is_array($tag) && (($tag['tag'] ?? '') !== '' || ($tag['value'] ?? '') !== '');
			}))
			: [];

		if ($tags) {
			$options['evaltype'] = (int) $str('filter_evaltype');
			$options['tags'] = array_map(static function ($tag) {
				return [
					'tag' => (string) ($tag['tag'] ?? ''),
					'operator' => (int) ($tag['operator'] ?? 0),
					'value' => (string) ($tag['value'] ?? '')
				];
			}, $tags);
		}

		return $options;
	}

	/**
	 * Checks access to a UI element by CRoleHelper constant name, tolerating constants renamed or
	 * removed in future versions.
	 */
	private function hasUiAccess(string $constant): bool {
		$name = CRoleHelper::class.'::'.$constant;

		return defined($name) && $this->checkAccess(constant($name));
	}
}
