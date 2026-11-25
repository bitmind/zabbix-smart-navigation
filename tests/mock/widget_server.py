"""
Mock dashboard for the widget module (no Zabbix needed).

    python3 tests/mock/widget_server.py     then open http://localhost:8766/

Two Host group tree widgets (A and B, as on two pages of the same dashboard) on a fake CWidget base class that
records broadcasts in window.LOG. In the browser console, runChecks() replays the page switch scenario and returns
{ok, results}.
"""
import http.server, sys, os
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'hostgrouptree-widget')
PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="/w/assets/css/widget.css">
<style>body{font:12px Arial;margin:20px;display:flex;gap:20px} .wbox{width:300px;height:330px;border:1px solid #ccc} .wbox>div{height:100%}
.disaster-bg{background:#e45959}.high-bg{background:#e97659}.average-bg{background:#ffa059}.warning-bg{background:#ffc859}.red{color:#e45959}</style></head>
<body><div class="wbox" id="p1"></div><div class="wbox" id="p2"></div>
<script>
window.LOG = [];
class CWidgetsData { static DATA_TYPE_HOST_GROUP_ID = '_hostgroupid'; static DATA_TYPE_HOST_GROUP_IDS = '_hostgroupids'; }
class CWidget {
  constructor(name, dashboardid) { this._name = name; this._dashboard = {dashboardid, templateid: null}; this._body = document.createElement('div'); this.onInitialize(); }
  onInitialize() {} onStart() {} onActivate() {} onDeactivate() {}
  broadcast(data) { LOG.push([this._name, JSON.stringify(data)]); }
}
</script>
<script src="/w/assets/js/class.widget.js"></script>
<script>
const node = (path, gid, hosts, sc) => ({path, name: path.split('/').pop(), parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null, groupid: gid, hosts, sev_counts: sc});
window.RESP = {nodes: [node('Sites','1',10,[0,0,1,0,2,0]), node('Sites/Rome','2',4,[0,0,1,0,0,0]), node('Sites/Rome/DC1','3',2,[0,0,1,0,0,0]), node('Sites/Milan','4',6,[0,0,0,0,2,0]), node('Servers',null,5,[0,0,0,0,0,0]), node('Servers/Linux','6',5,[0,0,0,0,0,1])],
  total: {hosts: 15, sev_counts: [0,0,1,0,2,1]}, show_problems: true, show_hosts: true, filtered: false, severity_names: {2:'Warning',4:'High',5:'Disaster'},
  access: {hosts: true, problems: true, latest: true, inventory: true, hosts_config: true, maintenance: true}};
window.A = new CWidgetHostGroupTree('A', '42'); document.getElementById('p1').append(A._body);
window.B = new CWidgetHostGroupTree('B', '42'); document.getElementById('p2').append(B._body);

window.runChecks = function () {
  sessionStorage.clear(); localStorage.clear(); LOG.length = 0;
  const results = [];
  const rows = (w) => [...w._body.querySelectorAll('.hgtw-row.is-selected')].map(r => r.dataset.path.replace('\\u0000root', 'All'));
  const last = () => LOG.length ? LOG[LOG.length - 1] : null;
  const check = (label, actual, expected) => results.push({label, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected});
  A.onStart(); A.onActivate(); A.setContents(RESP);
  check('A starts on All and broadcasts no group', [rows(A), last()], [['All'], ['A', '{"_hostgroupid":[],"_hostgroupids":[]}']]);
  A._body.querySelector('.hgtw-row[data-path="Sites"] .hgtw-toggle').click();
  A._body.querySelector('.hgtw-row[data-path="Sites/Rome"] .hgtw-label').click();
  check('A: click on Sites/Rome', last(), ['A', '{"_hostgroupid":["2"],"_hostgroupids":["2"]}']);
  A.onDeactivate(); B.onStart(); B.onActivate(); B.setContents(RESP);
  check('B (other page) takes the selection', [rows(B), last()], [['Sites/Rome'], ['B', '{"_hostgroupid":["2"],"_hostgroupids":["2"]}']]);
  B._body.querySelector('.hgtw-row[data-path="Servers"] .hgtw-label').click();
  B._body.querySelector('.hgtw-row[data-path="Sites/Milan"] .hgtw-label').dispatchEvent(new MouseEvent('click', {bubbles: true, ctrlKey: true}));
  check('B: virtual node + Ctrl+click', last(), ['B', '{"_hostgroupid":["6"],"_hostgroupids":["6","4"]}']);
  B.onDeactivate(); A.onActivate();
  check('A (back) takes the selection of B', [rows(A), last()], [['Servers', 'Sites/Milan'], ['A', '{"_hostgroupid":["6"],"_hostgroupids":["6","4"]}']]);
  const resp2 = JSON.parse(JSON.stringify(RESP)); resp2.nodes = resp2.nodes.filter(n => n.path !== 'Sites/Milan');
  A.setContents(resp2);
  check('selected group gone: back to All', [rows(A), last()], [['All'], ['A', '{"_hostgroupid":[],"_hostgroupids":[]}']]);
  check('All shows the units', A._body.querySelector('.hgtw-row.is-root').textContent, 'All15 hosts4 problems');
  const sites = () => A._body.querySelector('.hgtw-row[data-path="Sites"]');
  const state = () => [sites().getAttribute('aria-expanded'), sites().classList.contains('is-selected')];
  A._body.querySelector('.hgtw-row[data-path="Sites"] .hgtw-toggle').click();  // closed again (opened above)
  sites().querySelector('.hgtw-label').click();
  const first = [state(), last()];
  sites().querySelector('.hgtw-label').click();
  check('click on a name: selects and opens; again: closes, same selection', [first, [state(), last()]],
    [[['true', true], ['A', '{"_hostgroupid":["1"],"_hostgroupids":["1"]}']], [['false', true], ['A', '{"_hostgroupid":["1"],"_hostgroupids":["1"]}']]]);
  return {ok: results.every(r => r.ok), results};
};
</script></body></html>"""
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if self.path.startswith('/w/'):
            f = os.path.join(REPO, self.path[3:]); b = open(f,'rb').read(); ct = 'text/css' if f.endswith('.css') else 'application/javascript'
        else:
            b = PAGE.encode(); ct = 'text/html'
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(b)
print('http://localhost:8766/', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 8766), H).serve_forever()
