<?php declare(strict_types = 0);

namespace Modules\HostGroupTreeWidget\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;
use CRoleHelper;
use CSeverityHelper;

use Modules\HostGroupTreeWidget\Includes\WidgetForm;

/**
 * Host group tree widget: the tree with its counters, as JSON variables for class.widget.js.
 *
 * Same structure as the hostgrouptree.data endpoint of the Host group tree module:
 * - nesting comes from "/" in the group names; prefixes that are not (readable) groups are virtual nodes;
 * - "hosts" and "sev_counts" are distinct hosts / problems of the whole subtree.
 *
 * Widget filters: "groupids" = roots of the tree (the groups and their subgroups), "exclude_groupids" = groups
 * removed with their subgroups, "show_hosts", "problems" (all / unacknowledged / none), "problem" (name
 * contains), "severities", "evaltype" + "tags", "show_suppressed".
 */
class WidgetView extends CControllerDashboardWidgetView {

	protected function doAction(): void {
		$data = [
			'name' => $this->getInput('name', $this->widget->getDefaultName()),
			'user' => [
				'debug_mode' => $this->getDebugMode()
			],
			'vars' => $this->getTree() + [
				'show_problems' => (int) $this->fields_values['problems'] !== WidgetForm::PROBLEMS_NONE,
				'show_hosts' => (int) $this->fields_values['show_hosts'] !== WidgetForm::HOSTS_NONE,
				// Root or excluded groups: "All" broadcasts the groups of the tree instead of no group.
				'filtered' => (bool) (($this->fields_values['groupids'] ?? [])
					|| ($this->fields_values['exclude_groupids'] ?? [])),
				'severity_names' => self::getSeverityNames(),
				'access' => [
					'problems' => $this->hasUiAccess('UI_MONITORING_PROBLEMS'),
					'hosts' => $this->hasUiAccess('UI_MONITORING_HOSTS'),
					'latest' => $this->hasUiAccess('UI_MONITORING_LATEST_DATA'),
					'inventory' => $this->hasUiAccess('UI_INVENTORY_HOSTS'),
					'hosts_config' => $this->hasUiAccess('UI_CONFIGURATION_HOSTS'),
					'maintenance' => $this->hasUiAccess('UI_CONFIGURATION_MAINTENANCE')
				]
			]
		];

		$this->setResponse(new CControllerResponseData($data));
	}

	private function getTree(): array {
		$groups = API::HostGroup()->get([
			'output' => ['groupid', 'name'],
			'preservekeys' => true
		]);

		$groups = self::filterGroups($groups, $this->fields_values['groupids'] ?? [],
			$this->fields_values['exclude_groupids'] ?? []
		);

		// 1. Node map from the group names ("A/B/C" => A, A/B, A/B/C).
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

		/*
		 * Roots or exclusions: only the kept groups and their own prefixes remain. A prefix above a root (e.g.
		 * "Sites" for the root "Sites/Rome") is dropped and the root is shown with its full name.
		 */
		if ($this->fields_values['groupids'] ?? []) {
			$nodes = self::dropPrefixesAboveRoots($nodes, $groups);
		}

		$total = ['hosts' => 0, 'events' => []];

		if (!$nodes) {
			return self::outputTree([], $total);
		}

		$show_problems = (int) $this->fields_values['problems'] !== WidgetForm::PROBLEMS_NONE;

		// Neither hosts nor problems are shown: the tree only.
		if (!$show_problems && (int) $this->fields_values['show_hosts'] === WidgetForm::HOSTS_NONE) {
			return self::outputTree($nodes, $total);
		}

		// Roots or exclusions: the API reads only the groups of the tree (all groups otherwise, no list to send).
		$groupids = (($this->fields_values['groupids'] ?? []) || ($this->fields_values['exclude_groupids'] ?? []))
			? array_keys($group_path)
			: null;

		// 2. Current problems -> events per host.
		$host_events = $show_problems ? $this->getHostEvents($groupids) : [];

		// 3. Hosts -> distinct counts over every node of the subtree (a host in several groups counts once).
		$host_options = [
			'output' => ['hostid', 'status'],
			'selectHostGroups' => ['groupid'],
			'preservekeys' => true
		];

		if ($groupids !== null) {
			$host_options['groupids'] = $groupids;
		}

		$hosts = API::Host()->get($host_options) ?: [];

		// "Enabled": only monitored hosts are counted (problems are counted on all the hosts of the group).
		$counted = static fn(array $host): bool => true;

		if ((int) $this->fields_values['show_hosts'] === WidgetForm::HOSTS_ENABLED) {
			$counted = static fn(array $host): bool => $host['status'] == HOST_STATUS_MONITORED;
		}

		foreach ($hosts as $hostid => $host) {
			$is_counted = $counted($host);

			if ($is_counted) {
				$total['hosts']++;
			}

			if (array_key_exists($hostid, $host_events)) {
				$total['events'] = $host_events[$hostid] + $total['events'];
			}

			$paths = [];

			foreach ($host['hostgroups'] as $hostgroup) {
				if (!array_key_exists($hostgroup['groupid'], $group_path)) {
					continue;
				}

				for ($p = $group_path[$hostgroup['groupid']]; $p !== null && array_key_exists($p, $nodes)
						&& !array_key_exists($p, $paths); $p = $nodes[$p]['parent']) {
					$paths[$p] = true;
				}
			}

			foreach (array_keys($paths) as $p) {
				if ($is_counted) {
					$nodes[$p]['hosts']++;
				}

				if (array_key_exists($hostid, $host_events)) {
					$nodes[$p]['events'] = $host_events[$hostid] + $nodes[$p]['events'];
				}
			}
		}

		return self::outputTree($nodes, $total);
	}

	private static function outputTree(array $nodes, array $total): array {
		$output_nodes = [];

		foreach ($nodes as $node) {
			$output_nodes[] = [
				'path' => $node['path'],
				'name' => $node['name'],
				'parent' => $node['parent'],
				'groupid' => $node['groupid']
			] + self::outputCounters($node);
		}

		return ['nodes' => $output_nodes, 'total' => self::outputCounters($total)];
	}

	/**
	 * Roots: the root groups and the groups named "<root>/...". Exclusions: the excluded groups and the groups
	 * named "<excluded>/..." are removed.
	 */
	private static function filterGroups(array $groups, array $root_ids, array $exclude_ids): array {
		$prefixes = static function (array $ids) use ($groups): array {
			$names = [];

			foreach ($ids as $id) {
				if (array_key_exists($id, $groups)) {
					$names[] = $groups[$id]['name'];
				}
			}

			return $names;
		};

		$in = static function (string $name, array $names): bool {
			foreach ($names as $prefix) {
				if ($name === $prefix || strpos($name, $prefix.'/') === 0) {
					return true;
				}
			}

			return false;
		};

		$roots = $prefixes($root_ids);
		$excluded = $prefixes($exclude_ids);

		// Root groups not readable by the user: nothing to show.
		if ($root_ids && !$roots) {
			return [];
		}

		return array_filter($groups, static function (array $group) use ($roots, $excluded, $in): bool {
			return (!$roots || $in($group['name'], $roots)) && !$in($group['name'], $excluded);
		});
	}

	// Nodes above the root groups are removed; a node whose parent is gone becomes top-level with its full path.
	private static function dropPrefixesAboveRoots(array $nodes, array $groups): array {
		$keep = [];

		foreach ($groups as $group) {
			$keep[implode('/', array_values(array_filter(explode('/', $group['name']), 'strlen')))] = true;
		}

		$all = $nodes;

		foreach ($all as $path => $node) {
			// A node stays if it is a kept group or a prefix below one (virtual node inside a root).
			$inside = array_key_exists($path, $keep);

			for ($p = $node['parent']; !$inside && $p !== null; $p = $all[$p]['parent']) {
				$inside = array_key_exists($p, $keep);
			}

			if (!$inside) {
				unset($nodes[$path]);
			}
		}

		foreach ($nodes as $path => &$node) {
			if ($node['parent'] !== null && !array_key_exists($node['parent'], $nodes)) {
				$node['parent'] = null;
				$node['name'] = $path;
			}
		}
		unset($node);

		return $nodes;
	}

	/**
	 * Problems of the widget (severities, acknowledgement, suppression) as [hostid => [eventid => severity]].
	 *
	 * @param array|null $groupids  Groups of the tree when it is filtered (null = all groups).
	 */
	private function getHostEvents(?array $groupids): array {
		$options = [
			'output' => ['eventid', 'objectid', 'severity'],
			'source' => EVENT_SOURCE_TRIGGERS,
			'object' => EVENT_OBJECT_TRIGGER
		];

		if ($groupids !== null) {
			$options['groupids'] = $groupids;
		}

		if ((int) $this->fields_values['show_suppressed'] !== 1) {
			$options['suppressed'] = false;
		}

		if ((int) $this->fields_values['problems'] === WidgetForm::PROBLEMS_UNACKNOWLEDGED) {
			$options['acknowledged'] = false;
		}

		if ($this->fields_values['problem'] !== '') {
			$options['search'] = ['name' => $this->fields_values['problem']];
		}

		if ($this->fields_values['severities']) {
			$options['severities'] = $this->fields_values['severities'];
		}

		if ($this->fields_values['tags']) {
			$options['evaltype'] = (int) $this->fields_values['evaltype'];
			$options['tags'] = $this->fields_values['tags'];
		}

		$problems = API::Problem()->get($options);

		if (!$problems) {
			return [];
		}

		$triggers = API::Trigger()->get([
			'output' => [],
			'selectHosts' => ['hostid'],
			'triggerids' => array_values(array_unique(array_column($problems, 'objectid'))),
			'monitored' => true,
			'preservekeys' => true
		]);

		$host_events = [];

		foreach ($problems as $problem) {
			if (!array_key_exists($problem['objectid'], $triggers)) {
				continue;
			}

			foreach ($triggers[$problem['objectid']]['hosts'] as $host) {
				$host_events[$host['hostid']][$problem['eventid']] = (int) $problem['severity'];
			}
		}

		return $host_events;
	}

	private static function outputCounters(array $node): array {
		$sev_counts = array_fill(TRIGGER_SEVERITY_NOT_CLASSIFIED, TRIGGER_SEVERITY_COUNT, 0);

		foreach ($node['events'] as $severity) {
			$sev_counts[$severity]++;
		}

		return [
			'hosts' => $node['hosts'],
			'problems' => count($node['events']),
			'severity' => $node['events'] ? max($node['events']) : null,
			'sev_counts' => array_values($sev_counts)
		];
	}

	private static function getSeverityNames(): array {
		$names = [];

		for ($severity = TRIGGER_SEVERITY_NOT_CLASSIFIED; $severity < TRIGGER_SEVERITY_COUNT; $severity++) {
			$names[$severity] = CSeverityHelper::getName($severity);
		}

		return $names;
	}

	// UI_* constants not defined in this version count as "no access".
	private function hasUiAccess(string $constant): bool {
		$name = CRoleHelper::class.'::'.$constant;

		return defined($name) && $this->checkAccess(constant($name));
	}
}
