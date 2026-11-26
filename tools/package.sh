#!/bin/sh
# Release packages from a git ref (default HEAD), in dist/:
#   hostgrouptree-<version>.zip          panel module
#   hostgrouptree-widget-<version>.zip   widget module
#   dashboard-menu-<version>.zip         dashboard menu module
#   hostgrouptree-all-<version>.zip      all the folders, to extract into <Zabbix frontend>/modules/
set -eu

cd "$(dirname "$0")/.."
ref="${1:-HEAD}"
version=$(git show "$ref:hostgrouptree/manifest.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')

for module in hostgrouptree-widget dashboard-menu; do
	module_version=$(git show "$ref:$module/manifest.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')

	if [ "$version" != "$module_version" ]; then
		echo "Version mismatch: hostgrouptree $version, $module $module_version" >&2
		exit 1
	fi
done

mkdir -p dist
git archive --format=zip --prefix=hostgrouptree/ -o "dist/hostgrouptree-$version.zip" "$ref:hostgrouptree"
git archive --format=zip --prefix=hostgrouptree-widget/ -o "dist/hostgrouptree-widget-$version.zip" \
	"$ref:hostgrouptree-widget"
git archive --format=zip --prefix=dashboard-menu/ -o "dist/dashboard-menu-$version.zip" "$ref:dashboard-menu"
git archive --format=zip -o "dist/hostgrouptree-all-$version.zip" "$ref" hostgrouptree hostgrouptree-widget dashboard-menu

ls -l dist/*-"$version".zip
