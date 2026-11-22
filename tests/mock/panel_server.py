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
STATE = {'pages': {'monitoring_hosts': True, 'monitoring_problems': True, 'data_collection_hosts': True}, 'calls': []}
DATATABLE = """<div class="datatable" style="border:1px solid #003a7a;border-radius:4px"><div class="datatable-header"><div class="datatable-cell-header" style="color:#939ca4;padding:6px;border-bottom:2px solid #002e61">Name</div></div>
<div class="datatable-body" style="background:#001f42"><div class="datatable-row"><div class="datatable-cell-data" style="padding:6px;border-bottom:1px solid #003a7a">host1</div></div><div class="datatable-row"><div class="datatable-cell-data" style="padding:6px;border-bottom:1px solid #003a7a">host2</div></div></div></div>"""
PAGE = """<!doctype html><html lang="en" theme="__THEME__"><head><meta charset="utf-8">
<link rel="stylesheet" href="/modules/hostgrouptree/assets/css/hostgrouptree.css"></head>
<body><aside class="sidebar" style="position:fixed;left:0;top:0;bottom:0;width:200px;background:#333"></aside>
<div style="margin-left:220px"><main><header class="header-title"><h1>Hosts</h1></header>
<div class="filter" style="border:1px solid #ccc;padding:10px">native filter</div>
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
                nodes=[node('Sites','1',10,3,4),node('Sites/Rome','2',4,1,2),node('Sites/Rome/DC1','3',2,1,2),node('Sites/Milan','4',6,2,4),node('Servers','5',5,0,None),node('Servers/Linux','6',5,0,None)]
                return self.send(json.dumps({'nodes':nodes,'total':{'hosts':15,'problems':3,'severity':4,'sev_counts':[0,0,1,0,2,0],'unavailable':0,'host_masks':{'16':2,'4':1}},'config':cfg,'severity_names':{str(i):n for i,n in enumerate(['NC','Info','Warning','Average','High','Disaster'])},'group_form':'popup','maintenance_form':'popup','access':{'problems':True,'latest':True,'hosts':True,'inventory':True,'hosts_config':True,'edit_group':True,'maintenance':True,'create_maintenance':True,'create_group':True}}), 'application/json')
            theme = q.get('theme', ['blue-theme'])[0]
            dark = theme.startswith('dark') or theme == 'hc-dark'
            page = PAGE.replace('__THEME__', theme).replace('__LIST__', DATATABLE if q.get('datatable') else
                '<table class="list-table" style="width:100%;border:1px solid #ccc"><tbody><tr><td>host1</td></tr><tr><td>host2</td></tr></tbody></table>')
            if dark:
                page = page.replace('<body>', '<body style="background:#00142b;color:#e5f1ff">')
            return self.send(page, 'text/html')
        self.send_error(404)
print('http://localhost:8765/zabbix.php?action=host.view', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
