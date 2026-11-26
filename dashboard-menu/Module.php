<?php declare(strict_types = 0);

namespace Modules\DashboardMenu;

use API;
use APP;
use CLegacyAction;
use CMenu;
use CMenuItem;
use CProfile;
use CRouter;
use CUrl;
use CViewHelper;
use CWebUser;
use Throwable;
use Zabbix\Core\CModule;

/**
 * Dashboard menu: the main menu item "Dashboards" becomes a submenu.
 *
 * Dashboards named "<menu>/<dashboard>" are grouped in a submenu per <menu>; the others go to "Other".
 * Items, in this order: All dashboards (dashboard.list), Last viewed (dashboard.view without dashboardid, which
 * opens the dashboard stored in the user profile), the menus, Other.
 *
 * Dashboards come from dashboard.get (the API returns only the dashboards the user can read); menus and dashboards are sorted like the list (natural, case-insensitive, by name).
 */
class Module extends CModule {

	// Legacy pages that never render the menu (images, maps).
	private const NO_MENU_PAGES = ['chart.php', 'chart2.php', 'chart3.php', 'chart4.php', 'chart6.php', 'chart7.php',
		'image.php', 'imgstore.php', 'map.php'
	];

	/**
	 * No parameter type: the base method takes CAction (7.0, later 8.0) or CController (8.0.0), and an untyped
	 * parameter is compatible with both (a typed one is a fatal error when it differs).
	 *
	 * @param CAction|CController $action
	 */
	public function onBeforeAction($action): void {
		try {
			if ($this->rendersMenu($action)) {
				$this->buildMenu($action->getAction());
			}
		}
		catch (Throwable $e) {
			// Never break a page because of the menu: the native "Dashboards" item stays.
			error_log('[dashboard-menu] '.$e->getMessage());
		}
	}

	private function rendersMenu($action): bool {
		if (!CWebUser::isLoggedIn() || !APP::Component()->has('menu.main')
				|| CViewHelper::loadLayoutMode() == ZBX_LAYOUT_KIOSKMODE) {
			return false;
		}

		if ($action instanceof CLegacyAction) {
			return !in_array($action->getAction(), self::NO_MENU_PAGES, true);
		}

		return self::router()->getLayout() === 'layout.htmlpage';
	}

	// 7.0 registers the router as a component; 8.0 has a CRouter singleton.
	private static function router(): CRouter {
		return APP::Component()->has('router') ? APP::Component()->get('router') : CRouter::getInstance();
	}

	private function buildMenu(string $action_name): void {
		$item = self::findDashboardItem(APP::Component()->get('menu.main'));

		if ($item === null) {
			return;
		}

		// No "limit": 8.0 dashboard.get rejects it (the call returns false and adds an error message).
		$dashboards = API::Dashboard()->get([
			'output' => ['dashboardid', 'name']
		]);

		$menu = self::groupDashboards($dashboards ?: []);

		$submenu = new CMenu([
			(new CMenuItem(_('All dashboards')))
				->setUrl((new CUrl('zabbix.php'))->setArgument('action', 'dashboard.list'), 'dashboard.list'),
			(new CMenuItem(_('Last viewed')))
				->setUrl((new CUrl('zabbix.php'))->setArgument('action', 'dashboard.view'))
		]);

		foreach ($menu['menus'] as $name => $items) {
			$submenu->add((new CMenuItem($name))->setSubMenu(self::dashboardMenu($items)));
		}

		if ($menu['other']) {
			$submenu->add((new CMenuItem(_('Other')))->setSubMenu(self::dashboardMenu($menu['other'])));
		}

		$item->setSubMenu($submenu);

		/*
		 * The native selection already ran on the old item. Select the current dashboard (dashboard.view without
		 * dashboardid shows the one in the profile). Only "Dashboards" is opened, as the native menu does: the menus
		 * of the third level are fixed popups placed by the sidebar JS when they open, an open one at page load stays
		 * at the top of the window.
		 */
		$params = $_REQUEST;

		if ($action_name === 'dashboard.view' && !array_key_exists('dashboardid', $params)) {
			$dashboardid = CProfile::get('web.dashboard.dashboardid');

			if ($dashboardid !== null) {
				$params['dashboardid'] = (string) $dashboardid;
			}
		}

		if ($submenu->setSelectedByAction($action_name, $params)) {
			if (!$item->isSelected()) {
				$item->setSelected();
			}

			if (CViewHelper::loadSidebarMode() != ZBX_SIDEBAR_VIEW_MODE_COMPACT) {
				$item->addClass('is-expanded');
			}
		}
	}

	// Top-level item of dashboard.view (looked up by action: the label is translated).
	private static function findDashboardItem(CMenu $menu): ?CMenuItem {
		foreach ($menu->getMenuItems() as $item) {
			if ($item->getAction() === 'dashboard.view') {
				return $item;
			}
		}

		return null;
	}

	/**
	 * @param array $dashboards  [['dashboardid' => .., 'name' => ..], ...]
	 *
	 * @return array  ['menus' => [<menu> => [['dashboardid', 'name'], ...]], 'other' => [['dashboardid', 'name'], ...]]
	 *                Menus and dashboards in natural case-insensitive order; "name" without the menu prefix.
	 */
	private static function groupDashboards(array $dashboards): array {
		$menus = [];
		$other = [];

		foreach ($dashboards as $dashboard) {
			$parts = explode('/', $dashboard['name'], 2);
			$menu = trim($parts[0]);
			$name = count($parts) == 2 ? trim($parts[1]) : '';

			// "Name", "/Name" or "Menu/" have no menu or no name: shown as they are among the others.
			if ($menu === '' || $name === '') {
				$other[] = ['dashboardid' => $dashboard['dashboardid'], 'name' => $dashboard['name']];
			}
			else {
				$menus[$menu][] = ['dashboardid' => $dashboard['dashboardid'], 'name' => $name];
			}
		}

		uksort($menus, 'strnatcasecmp');

		$by_name = static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']);

		foreach ($menus as &$items) {
			usort($items, $by_name);
		}
		unset($items);

		usort($other, $by_name);

		return ['menus' => $menus, 'other' => $other];
	}

	private static function dashboardMenu(array $items): CMenu {
		$menu = new CMenu();

		foreach ($items as $dashboard) {
			$menu->add(
				(new CMenuItem($dashboard['name']))
					->setTitle($dashboard['name'])
					->setUrl(
						(new CUrl('zabbix.php'))
							->setArgument('action', 'dashboard.view')
							->setArgument('dashboardid', $dashboard['dashboardid']),
						'dashboard.view?dashboardid='.$dashboard['dashboardid']
					)
			);
		}

		return $menu;
	}
}
