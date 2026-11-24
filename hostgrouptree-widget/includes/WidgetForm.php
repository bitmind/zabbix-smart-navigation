<?php declare(strict_types = 0);

namespace Modules\HostGroupTreeWidget\Includes;

use Zabbix\Widgets\CWidgetForm;

use Zabbix\Widgets\Fields\{
	CWidgetFieldCheckBox,
	CWidgetFieldMultiSelectGroup,
	CWidgetFieldRadioButtonList,
	CWidgetFieldSeverities,
	CWidgetFieldTags,
	CWidgetFieldTextBox
};

/**
 * Host group tree widget form.
 *
 * Filters: root host groups, excluded host groups, show number of hosts (All / Enabled / None), show problems
 * (All / Unacknowledged / None), problem name, severities, problem tags.
 * Display options: show suppressed problems.
 */
class WidgetForm extends CWidgetForm {

	public const PROBLEMS_ALL = 0;
	public const PROBLEMS_UNACKNOWLEDGED = 1;
	public const PROBLEMS_NONE = 2;

	// "Show number of hosts". 0 = None, so values saved by the former checkbox (0 = unchecked) keep their meaning.
	public const HOSTS_NONE = 0;
	public const HOSTS_ALL = 1;
	public const HOSTS_ENABLED = 2;

	public function addFields(): self {
		return $this
			// Roots of the tree: these groups and their subgroups ("<name>/..."). Empty = all host groups.
			->addField($this->isTemplateDashboard()
				? null
				: new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
			)
			// Removed from the tree together with their subgroups.
			->addField($this->isTemplateDashboard()
				? null
				: new CWidgetFieldMultiSelectGroup('exclude_groupids', _('Exclude host groups'))
			)
			->addField(
				(new CWidgetFieldRadioButtonList('show_hosts', _('Show number of hosts'), [
					self::HOSTS_ALL => _('All'),
					self::HOSTS_ENABLED => _('Enabled'),
					self::HOSTS_NONE => _('None')
				]))->setDefault(self::HOSTS_NONE)
			)
			->addField(
				(new CWidgetFieldRadioButtonList('problems', _('Show problems'), [
					self::PROBLEMS_ALL => _('All'),
					self::PROBLEMS_UNACKNOWLEDGED => _('Unacknowledged'),
					self::PROBLEMS_NONE => _('None')
				]))->setDefault(self::PROBLEMS_ALL)
			)
			// Problems counted in the tree: name contains this text, as in the Problems widget.
			->addField(
				new CWidgetFieldTextBox('problem', _('Problem'))
			)
			// None checked = all severities.
			->addField(
				new CWidgetFieldSeverities('severities', _('Severity'))
			)
			->addField(
				(new CWidgetFieldRadioButtonList('evaltype', _('Problem tags'), [
					TAG_EVAL_TYPE_AND_OR => _('And/Or'),
					TAG_EVAL_TYPE_OR => _('Or')
				]))->setDefault(TAG_EVAL_TYPE_AND_OR)
			)
			->addField(
				new CWidgetFieldTags('tags')
			)
			->addField(
				new CWidgetFieldCheckBox('show_suppressed', _('Show suppressed problems'))
			);
	}
}
