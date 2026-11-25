"""
Mock of the Zabbix pages for the panel module (no Zabbix needed).

    python3 tests/mock/panel_server.py      then open http://localhost:8765/zabbix.php?action=host.view

Serves a page with the Zabbix DOM used by the panel (main > header.header-title, filter, list table), the panel
assets from hostgrouptree/assets/ and a fake hostgrouptree.data endpoint with a small tree.
Page options: &theme=<Zabbix theme id> (e.g. dark-blue-theme) and &datatable=1 (Zabbix 8.0 div-based list
instead of table.list-table).
GET /set?page=<pages key>&v=0|1 changes config.json "pages" in the fake endpoint; GET /calls lists its requests.
"""
import http.server, json, sys, urllib.parse, os
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
STATE = {'pages': {'monitoring_hosts': True, 'monitoring_problems': True, 'data_collection_hosts': True, 'monitoring_latest': True, 'data_collection_templates': True, 'users_users': True}, 'calls': []}
# Classic filter forms (CFilter, form zbx_filter) of Data collection > Templates and Users > Users.
CLASSIC = {
    'template.list': '<input name="filter_name" value="Linux"><input type="hidden" name="filter_groups[]" value="__G__">',
    'user.list': '<input name="filter_username" value=""><input type="hidden" name="filter_roles[]" value="3"><input type="hidden" name="filter_usrgrpids[]" value="7">'
}
DATATABLE = """<div class="datatable" style="border:1px solid #003a7a;border-radius:4px"><div class="datatable-header"><div class="datatable-cell-header" style="color:#939ca4;padding:6px;border-bottom:2px solid #002e61">Name</div></div>
<div class="datatable-body" style="background:#001f42"><div class="datatable-row"><div class="datatable-cell-data" style="padding:6px;border-bottom:1px solid #003a7a">host1</div></div><div class="datatable-row"><div class="datatable-cell-data" style="padding:6px;border-bottom:1px solid #003a7a">host2</div></div></div></div>"""
# Monitoring > Latest data: native subfilter markup (app/partials/monitoring.latest.subfilter.php) and a fake
# "view" whose setSubfilter/unsetSubfilter rebuild it, as the page refresh does.
LATEST = r"""<style>/* Zabbix blue-theme rules used by the subfilter */
h3 { font-size: 0.917em; text-transform: uppercase; color: #768d99; letter-spacing: .0688em; }
a { color: #0275b8; text-decoration: none; } a:hover { border-bottom: 1px solid rgba(2, 117, 184, 0.5); }
.link-action { border-bottom: 1px dotted; cursor: pointer; } .grey { color: #768d99; }
.subfilter { display: inline-block; margin-right: 10px; white-space: nowrap; line-height: 14px; height: 16px; margin-bottom: 2px; position: relative; }
.subfilter-enabled { background-color: #768d99; border-radius: 2px; color: #fff; padding: 0 4px; }
.subfilter-enabled .link-action { color: #fff; text-decoration: none; } .subfilter-enabled sup { color: #bfcacf; }
</style>
<div class="tabfilter-container"><div class="tabfilter-content-container"><div class="filter" style="border:1px solid #ccc;padding:10px">native filter</div>
<table class="list-table tabfilter-subfilter" id="latest-data-subfilter"></table></div></div>
<table class="list-table" style="width:100%;border:1px solid #ccc"><tbody><tr><td>item1</td></tr></tbody></table>
<script>
window.SUB = {hostids: [], tagnames: [], tags: {}, state: [], data: []};
window.SUB_CALLS = [];
const HOSTS = {'10084': ['Zabbix server', 120], '10500': ['web01', 40], '10501': ['db01', 0]};
const TAGNAMES = {component: 80, scope: 30, Application: 3, env: 9, target: 57};
const TAGS = {scope: {availability: 10, performance: 20}, component: {cpu: 20, memory: 15, network: 30, '': 5}, Application: {web: 3}, env: {prod: 9}, target: {linux: 50, windows: 7}};
function span(key, value, name, count, selected, tag) {
  const used = Object.values(SUB).some(v => Array.isArray(v) ? v.length : Object.keys(v).length);
  const fn = selected ? 'unsetSubfilter' : 'setSubfilter';
  const field = tag ? `subfilter_tags[${encodeURIComponent(tag)}][]` : `subfilter_${key}[]`;
  const style = name === '' ? ' style="font-style: italic;"' : '';
  if (!count && !selected) return `<span class="subfilter"><span class="grey">${name}</span> <sup>${count}</sup></span>`;
  return `<span class="subfilter${selected ? ' subfilter-enabled' : ''}"><a class="link-action"${style} data-key="${tag || key}" data-value="${value}" href="javascript:void(0)" onclick="view.${fn}(['${field}', this.dataset.value]);">${name === '' ? 'None' : name}</a> <sup>${selected || !used ? '' : '+'}${count}</sup></span>`;
}
function renderNative() {
  const t = document.getElementById('latest-data-subfilter');
  if (!t) return;
  const sel = (k, v) => SUB[k].includes(v);
  let h = '<tbody><tr class="hover-nobg"><td><h4>Subfilter <span class="grey">affects only filtered data</span></h4></td></tr>';
  h += '<tr><td><h3>Hosts</h3><div class="expandable-subfilter ten-lines" data-name="hostids"><div>' + Object.entries(HOSTS).map(([id, [n, c]]) => span('hostids', id, n, c, sel('hostids', id))).join(' ') + ' <span>...</span></div></div></td></tr>';
  h += '<tr><td><h3>Tags</h3><div class="expandable-subfilter ten-lines" data-name="tagnames"><div>' + Object.entries(TAGNAMES).map(([n, c]) => span('tagnames', n, n, c, sel('tagnames', n))).join(' ') + '</div></div></td></tr>';
  h += '<tr><td><h3>Tag values</h3>' + Object.entries(TAGS).map(([tag, vals], i) => `<div class="subfilter-option-grid${i > 0 ? ' display-none' : ''}"><label>${tag}: </label><div class="expandable-subfilter ten-lines subfilter-options" data-name="tagnames"><div>` + Object.entries(vals).map(([v, c]) => span('tags', v, v, c, (SUB.tags[tag] || []).includes(v), tag)).join(' ') + '</div></div></div>').join('') + '</td></tr>';
  h += '<tr><td><h3>State</h3>' + span('state', '0', 'Normal', 150, sel('state', '0')) + ' ' + span('state', '1', 'Not supported', 10, sel('state', '1')) + '</td></tr>';
  h += '<tr><td><h3>Data</h3>' + span('data', '1', 'With data', 140, sel('data', '1')) + ' ' + span('data', '0', 'Without data', 20, sel('data', '0')) + '</td></tr></tbody>';
  t.innerHTML = h;
}
function change(field, value, on) {
  SUB_CALLS.push([on ? 'set' : 'unset', field, value]);
  const m = field.match(/^subfilter_tags\[(.*)\]\[\]$/);
  const list = m ? (SUB.tags[decodeURIComponent(m[1])] ||= []) : SUB[field.replace(/^subfilter_|\[\]$/g, '')];
  const i = list.indexOf(value);
  if (on && i < 0) list.push(value); if (!on && i >= 0) list.splice(i, 1);
  setTimeout(renderNative, 100);  // like the page refresh (ajax)
}
window.view = {setSubfilter: ([f, v]) => change(f, v, true), unsetSubfilter: ([f, v]) => change(f, v, false)};
renderNative();
</script>"""
PAGE = """<!doctype html><html lang="en" theme="__THEME__"><head><meta charset="utf-8">
<link rel="stylesheet" href="/modules/hostgrouptree/assets/css/hostgrouptree.css"></head>
<body><aside class="sidebar" style="position:fixed;left:0;top:0;bottom:0;width:200px;background:#333"></aside>
<div style="margin-left:220px"><main><header class="header-title"><h1>Hosts</h1></header>
__FILTER__
__LIST__
</main></div><script src="/modules/hostgrouptree/assets/js/hostgrouptree.js"></script></body></html>"""
def node(path, gid, hosts, probs, sev, hosts_with_problems=None):
    parent = path.rsplit('/',1)[0] if '/' in path else None
    sc=[0]*6
    if sev is not None: sc[sev]=probs
    return {'path':path,'name':path.split('/')[-1],'parent':parent,'groupid':gid,'hosts':hosts,'problems':probs,'severity':sev,'sev_counts':sc,'host_masks':({str(1 << sev): hosts_with_problems or probs} if sev is not None else {}),'unavailable':0}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self, body, ctype):
        b = body.encode() if isinstance(body,str) else body
        self.send_response(200); self.send_header('Content-Type',ctype); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path.startswith('/modules/hostgrouptree/'):
            f = os.path.join(REPO, 'hostgrouptree', u.path[len('/modules/hostgrouptree/'):])
            return self.send(open(f,'rb').read(), 'text/css' if f.endswith('.css') else 'application/javascript')
        if u.path == '/set':
            STATE['pages'][q['page'][0]] = q['v'][0] == '1'; return self.send(json.dumps(STATE), 'application/json')
        if u.path == '/calls':
            return self.send(json.dumps(STATE['calls']), 'application/json')
        if u.path == '/zabbix.php':
            a = q.get('action',[''])[0]
            if a == 'hostgrouptree.data':
                STATE['calls'].append(u.query)
                cfg = {'pages': STATE['pages'], 'show_column_headers': False, 'show_expand_collapse_buttons': True, 'open_forms_in_place': True, 'refresh_interval': 0, 'maintenance_period_minutes': 60, 'problem_limit': 50000}
                if 'config_only' in q: return self.send(json.dumps({'config': cfg}), 'application/json')
                mode = q.get('mode', [''])[0]
                if mode == 'users':
                    return self.send(json.dumps({'config': cfg, 'users': {
                        'roles': [{'id': '1', 'name': 'Admin role', 'count': 2}, {'id': '3', 'name': 'Super admin role', 'count': 1}, {'id': '4', 'name': 'Guest role', 'count': 0}],
                        'groups': [{'id': '7', 'name': 'Zabbix administrators', 'count': 1}, {'id': '8', 'name': 'Guests', 'count': 0}, {'id': '9', 'name': 'Internal', 'count': 3}]}}), 'application/json')
                if mode == 'templates':
                    tn = [{'path': p, 'name': p.split('/')[-1], 'parent': p.rsplit('/', 1)[0] if '/' in p else None, 'groupid': g, 'hosts': h}
                          for p, g, h in [('Templates', '1', 40), ('Templates/Applications', '12', 15), ('Templates/Databases', '13', 10), ('Templates/OS', '14', 15)]]
                    return self.send(json.dumps({'config': cfg, 'nodes': tn, 'total': {'hosts': 40}, 'access': {}}), 'application/json')
                nodes=[node('Sites','1',10,3,4),node('Sites/Rome','2',4,1,2),node('Sites/Rome/DC1','3',2,1,2),node('Sites/Milan','4',6,2,4),node('Servers','5',5,0,None),node('Servers/Linux','6',5,0,None)]
                return self.send(json.dumps({'nodes':nodes,'total':{'hosts':15,'problems':3,'severity':4,'sev_counts':[0,0,1,0,2,0],'unavailable':0,'host_masks':{'16':2,'4':1}},'config':cfg,'severity_names':{str(i):n for i,n in enumerate(['NC','Info','Warning','Average','High','Disaster'])},'group_form':'popup','maintenance_form':'popup','access':{'problems':True,'latest':True,'hosts':True,'inventory':True,'hosts_config':True,'edit_group':True,'maintenance':True,'create_maintenance':True,'create_group':True}}), 'application/json')
            theme = q.get('theme', ['blue-theme'])[0]
            dark = theme.startswith('dark') or theme == 'hc-dark'
            page = PAGE.replace('__THEME__', theme).replace('__LIST__', LATEST if a == 'latest.view' else DATATABLE if q.get('datatable') else
                '<table class="list-table" style="width:100%;border:1px solid #ccc"><tbody><tr><td>host1</td></tr><tr><td>host2</td></tr></tbody></table>')
            if a in CLASSIC:
                form = CLASSIC[a].replace('__G__', q.get('filter_groups[]', [''])[0])
                for k in ('filter_roles[]', 'filter_usrgrpids[]'):
                    if k in q or 'filter_set' in q:
                        form = form.replace(f'<input type="hidden" name="{k}" value="{"3" if "roles" in k else "7"}">', '')
                        form += ''.join(f'<input type="hidden" name="{k}" value="{v}">' for v in q.get(k, []))
                filt = f'<div class="filter-container"><form name="zbx_filter" style="border:1px solid #ccc;padding:10px">{form}</form></div>'
            else:
                filt = '' if a == 'latest.view' else '<div class="filter" style="border:1px solid #ccc;padding:10px">native filter</div>'
            page = page.replace('__FILTER__', filt)
            if dark:
                page = page.replace('<body>', '<body style="background:#00142b;color:#e5f1ff">')
            return self.send(page, 'text/html')
        self.send_error(404)
print('http://localhost:8765/zabbix.php?action=host.view', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
