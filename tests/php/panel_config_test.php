<?php
// Panel: config.json reading (comments, wrong types, "pages"). Works on temporary files only, never on the
// real config.json. Run: php tests/php/panel_config_test.php
require __DIR__.'/stubs.php';
require __DIR__.'/../../hostgrouptree/actions/HostGroupTreeData.php';

$class = new ReflectionClass('Modules\HostGroupTree\Actions\HostGroupTreeData');
$read = $class->getMethod('readConfig');
$strip = $class->getMethod('stripJsonComments');
$tmp = tempnam(sys_get_temp_dir(), 'hgt');

$defaults = [
	'pages' => ['monitoring_hosts' => true, 'monitoring_problems' => true, 'data_collection_hosts' => true,
		'monitoring_latest' => true
	],
	'show_column_headers' => false,
	'show_expand_collapse_buttons' => true,
	'open_forms_in_place' => true,
	'refresh_interval' => 60,
	'maintenance_period_minutes' => 60,
	'problem_limit' => 50000,
	'subfilter_priority_tags' => ['target', 'component']
];

copy(__DIR__.'/../../hostgrouptree/config.json', $tmp);
check('shipped config.json = defaults', $read->invoke(null, $tmp), $defaults);

file_put_contents($tmp, "/* x */{\"pages\": {\"monitoring_problems\": false, \"monitoring_hosts\": \"no\"}, // c\n"
	."\"refresh_interval\": \"30\", \"maintenance_period_minutes\": -5, \"problem_limit\": \"x\","
	."\"show_column_headers\": true, \"other\": \"a//b /* c */\"}"
);
check('comments, wrong types, partial pages', $read->invoke(null, $tmp), array_replace($defaults, [
	'pages' => ['monitoring_hosts' => true, 'monitoring_problems' => false, 'data_collection_hosts' => true,
		'monitoring_latest' => true
	],
	'show_column_headers' => true,
	'refresh_interval' => 30
]));

file_put_contents($tmp, '{"subfilter_priority_tags": ["app", 3, "env"]}');
check('priority tags: strings only', $read->invoke(null, $tmp)['subfilter_priority_tags'], ['app', 'env']);

file_put_contents($tmp, '{"subfilter_priority_tags": []}');
check('priority tags: empty list allowed', $read->invoke(null, $tmp)['subfilter_priority_tags'], []);

file_put_contents($tmp, '{"subfilter_priority_tags": {"a": "x"}}');
check('priority tags: object ignored', $read->invoke(null, $tmp)['subfilter_priority_tags'], ['target', 'component']);

file_put_contents($tmp, '{bad');
check('invalid JSON = defaults', $read->invoke(null, $tmp), $defaults);

file_put_contents($tmp, '{"pages": true}');
check('pages not an object', $read->invoke(null, $tmp)['pages'], $defaults['pages']);

check('comment markers inside strings', $strip->invoke(null, '{"a":"x\\"//y","b":1}//z'), "{\"a\":\"x\\\"//y\",\"b\":1}\n");

unlink($tmp);
done();
