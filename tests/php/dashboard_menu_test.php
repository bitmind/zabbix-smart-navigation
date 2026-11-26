<?php
// Dashboard menu: grouping and order of the dashboards. Run: php tests/php/dashboard_menu_test.php
namespace Zabbix\Core {
	class CModule {}
}

namespace {
	require __DIR__.'/stubs.php';
	require __DIR__.'/../../dashboard-menu/Module.php';

	$group = (new ReflectionClass('Modules\DashboardMenu\Module'))->getMethod('groupDashboards');

	$dashboards = [];

	foreach (['Network/Core', 'servers/Web 10', 'Global view', 'Servers/Web 2', 'Network/Access', 'Zabbix server',
			'/Leading slash', 'Trailing/', 'Servers/DB/Primary', 'alpha', ' Network / Edge '] as $i => $name) {
		$dashboards[] = ['dashboardid' => (string) ($i + 1), 'name' => $name];
	}

	$result = $group->invoke(null, $dashboards);
	$names = static fn(array $list): array => array_column($list, 'name');

	check('menus in natural case-insensitive order', array_keys($result['menus']), ['Network', 'servers', 'Servers']);
	check('Network: names without prefix, sorted, trimmed', $names($result['menus']['Network']),
		['Access', 'Core', 'Edge']
	);
	check('Servers: rest of the name after the first "/", natural order', $names($result['menus']['Servers']),
		['DB/Primary', 'Web 2']
	);
	check('ids kept', array_column($result['menus']['Network'], 'dashboardid'), ['5', '1', '11']);
	check('other: no menu or no name, full name, sorted', $names($result['other']),
		['/Leading slash', 'alpha', 'Global view', 'Trailing/', 'Zabbix server']
	);
	check('no dashboards', $group->invoke(null, []), ['menus' => [], 'other' => []]);

	done();
}
