from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output/pdf'; SHOTS=ROOT/'test-results'
W,H=595.276,841.89; M=44; CW=W-2*M
RED=HexColor('#e9374c'); INK=HexColor('#171b23'); MUTED=HexColor('#596474'); LIGHT=HexColor('#edf0f4'); DARK=HexColor('#11151d')
for name,file in [('Body','Arial.ttf'),('Bold','Arial Bold.ttf'),('Italic','Arial Italic.ttf'),('Display','Arial Black.ttf')]:
    pdfmetrics.registerFont(TTFont(name, '/System/Library/Fonts/Supplemental/'+file))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
styles={
 'p':ParagraphStyle('p',fontName='Body',fontSize=10.2,leading=14.8,textColor=INK,spaceAfter=9),
 'small':ParagraphStyle('small',fontName='Body',fontSize=8.7,leading=12.4,textColor=MUTED),
 'h':ParagraphStyle('h',fontName='Bold',fontSize=13,leading=17,textColor=INK,spaceAfter=7),
 'intro':ParagraphStyle('intro',fontName='Body',fontSize=12.2,leading=17.5,textColor=MUTED),
 'code':ParagraphStyle('code',fontName='Courier',fontSize=9,leading=13,textColor=INK),
 'white':ParagraphStyle('white',fontName='Body',fontSize=12,leading=18,textColor=HexColor('#d5dce7')),
}

def brand(c,x,y,size=12,dark=False):
    c.setFont('Bold',size);c.setFillColor(white if dark else INK);c.drawString(x,y,'THUGS')
    c.setFillColor(RED);c.drawString(x+pdfmetrics.stringWidth('THUGS','Bold',size),y,'red')
def para(c,text,x,y,width=CW,style='p'):
    text=text.replace('THUGSred','THUGS<font color="#e9374c">red</font>')
    p=Paragraph(text,styles[style]);_,h=p.wrap(width,1000);p.drawOn(c,x,y-h);return y-h-styles[style].spaceAfter

def blocks(c,items,x,y,width):
    for title,text in items:
        if title:y=para(c,title,x,y,width,'h')
        y=para(c,text,x,y,width)
        y-=9
    if y<64:raise ValueError(f'Page {c.getPageNumber()} overflows at {y}: {items[-1][0]}')
    return y

def image(c,name,x,y,width,height=None):
    src=SHOTS/name if not name.startswith('/') else Path(name)
    reader=ImageReader(str(src));iw,ih=reader.getSize();height=height or width*ih/iw
    c.drawImage(reader,x,y-height,width=width,height=height,mask='auto')
    return y-height

def header(c,number,section,title,intro):
    c.setFillColor(white);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(RED);c.rect(0,H-8,W,8,fill=1,stroke=0)
    brand(c,M,H-38,10)
    c.setFillColor(MUTED);c.setFont('Body',9);c.drawRightString(W-M,H-38,'GLASSES 0.1  /  FIELD MANUAL')
    c.bookmarkPage(f'p{number}');c.addOutlineEntry(title,f'p{number}',level=0,closed=False)
    c.setFillColor(RED);c.setFont('Bold',9);c.drawString(M,H-79,section.upper())
    c.setFillColor(INK);c.setFont('Bold',27);c.drawString(M,H-114,title)
    y=para(c,intro,M,H-133,CW,'intro')
    c.setStrokeColor(LIGHT);c.line(M,49,W-M,49)
    c.setFillColor(MUTED);c.setFont('Body',8);c.drawString(M,32,'glasses.thugs.red  •  Local development release  •  6 November 2026')
    c.drawRightString(W-M,32,f'{number:02}')
    c.linkURL('https://glasses.thugs.red',(M,27,M+83,42),relative=0,thickness=0)
    return y-18

def standard(c,n,section,title,intro,left,right,shot=None,caption='',detail=False):
    y=header(c,n,section,title,intro)
    if shot:
        iw,ih=ImageReader(str(SHOTS/shot)).getSize();h=CW*ih/iw
        if not detail:h=min(h,265)
        if h>260:h=260
        # Preserve aspect ratio; avoid stretching screenshots.
        width=min(CW,h*iw/ih);x=M+(CW-width)/2
        c.setFillColor(DARK);c.roundRect(x-1,y-h-1,width+2,h+2,6,fill=1,stroke=0)
        image(c,shot,x,y,width,h)
        y-=h+9;y=para(c,caption,M,y,CW,'small')-16
    gap=24;col=(CW-gap)/2
    blocks(c,left,M,y,col);blocks(c,right,M+col+gap,y,col)
    c.showPage()

def cover(c,promotional=False):
    c.setFillColor(DARK);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(Color(.9,.13,.24,.08));c.circle(W-40,H-190,210,fill=1,stroke=0)
    c.setFillColor(HexColor('#27303f'));c.setFont('Courier',9)
    for i in range(10):c.drawString(M,H-95-i*13,('01001101 10100110 01010011 '*4)[:82])
    brand(c,M,H-47,15,True)
    c.setFont('Body',9);c.setFillColor(HexColor('#aeb9ca'));c.drawRightString(W-M,H-44,'RESEARCH  /  DEVELOPMENT  /  SECURITY')
    logo=ROOT/'docs/brand/glasses-preview.png'
    c.drawImage(str(logo),M+50,H-230,width=CW-100,height=(CW-100)*440/1200,mask='auto')
    c.setFillColor(white);c.setFont('Display',57);c.drawString(M,H-310,'Glasses')
    c.setFillColor(RED);c.setFont('Bold',28);c.drawString(M,H-350,'Look closer.')
    text='One workspace for the traffic, the questions,<br/>and the next experiment.' if promotional else 'The illustrated field manual.<br/>Capture. Inspect. Intercept. Repeat. Extend.'
    para(c,text,M,H-373,CW,'white')
    image(c,'glasses-traffic-dark.png',M,385,CW)
    c.setFillColor(HexColor('#aeb9ca'));c.setFont('Body',9)
    c.drawString(M,48,'PRODUCT OVERVIEW  /  0.1' if promotional else 'USER & DEVELOPER GUIDE  /  VERSION 0.1.0')
    c.setFillColor(white);c.setFont('Bold',11);c.drawRightString(W-M,47,'glasses.thugs.red')
    c.linkURL('https://glasses.thugs.red',(W-M-125,39,W-M,61),relative=0,thickness=0)
    c.setFont('Body',8);c.setFillColor(HexColor('#93a0b3'));c.drawString(M,30,'Real application screenshot using the built-in local lab. macOS development release.')
    c.bookmarkPage('p1');c.addOutlineEntry('Glasses - Look closer','p1',level=0);c.showPage()

manual=canvas.Canvas(str(OUT/'Glasses-0.1-User-Manual.pdf'),pagesize=(W,H),pageCompression=1)
manual.setTitle('Glasses 0.1 - Illustrated User and Developer Manual');manual.setAuthor('THUGSred');manual.setSubject('Operation, corporate routing, security, plugins and release reference')
cover(manual)
y=header(manual,2,'Start here','Your guide to Glasses','A practical reference for researchers, web developers and extension authors. The screenshots use local lab traffic and example settings, never private browsing data.')
contents=[(3,'First run and local lab'),(4,'The research workspace'),(5,'Reading captured traffic'),(6,'Context menus and transforms'),(7,'Intercept, edit and forward'),(8,'Repeater and request editing'),(9,'Iterations and fuzz payloads'),(10,'Site Timeline / Speed Inspector'),(11,'SSL / TLS Inspector'),(12,'Header Hardening and rules'),(13,'System proxy toggle'),(14,'Proxy and SOCKS relay chains'),(15,'Privacy bypass lists'),(16,'Organization CA and trust'),(17,'Themes, storage and exchange'),(18,'Installing community extensions'),(19,'Building an extension'),(20,'Security architecture'),(21,'Build and release reference'),(22,'Troubleshooting and glossary')]
for idx,(page,title) in enumerate(contents):
    col=0 if idx<10 else 1;row=idx if idx<10 else idx-10;x=M+col*(CW/2+10);yy=y-row*31
    manual.setFillColor(RED);manual.setFont('Bold',10);manual.drawString(x,yy,f'{page:02}')
    manual.setFillColor(INK);manual.setFont('Body',9.5);manual.drawString(x+25,yy,title)
    manual.linkRect('',f'p{page}',(x,yy-4,x+CW/2-10,yy+12),relative=0,thickness=0)
y-=325
blocks(manual,[('What this release is','Glasses 0.1 is a usable local development release. macOS ARM64 is the primary tested desktop. Packages target Intel macOS and x64/ARM64 Windows/Linux; those desktops still need platform acceptance. Signed distribution, notarization and enterprise deployment controls remain release work.'),('Official home','<link href="https://glasses.thugs.red" color="#e9374c">glasses.thugs.red</link> is the official application and future community address. The website is maintained separately. The online catalog, accounts, publishing, ratings and updates are planned services. Local extensions already work without a backend.'),('How to read the screenshots','Ports, fingerprints and request durations are examples. Your installation creates its own CA and local lab port. Dark and light modes show the same tools. The guidance describes implemented behavior; the release reference marks important limitations.')],M,y,CW)
manual.showPage()
standard(manual,3,'Getting started','First run and local lab','Start with real local traffic before connecting your own browser or corporate network.',[
('1  Open the application','On Apple Silicon, use the arm64 macOS package; on Intel, use x64. Open the DMG and copy Glasses to Applications, or extract the ZIP. These local builds are not Developer ID signed or notarized. Use your organization’s normal approval process for development software.'),
('2  Try Local lab','Click <b>Local lab</b> in the footer. Glasses starts its listeners and requests six routes from a server on your own Mac: a page, JSON APIs, a slow response and a missing route. Select a row to inspect its request and response.'),
('3  Try an experiment','Send an API request to Repeater. Change a query value, send it again, then compare the new response. Open Timeline to see the deliberately slow lab route. This checks your basic workflow without an external target.')],[
('4  Connect a browser','<b>Open browser</b> starts an isolated Chromium research session. On a fresh launch it explicitly uses Glasses and accepts correctly named, currently valid certificates signed by the active research CA. It does not share your personal browser profile.'),
('5  Connect other clients','The default HTTP/HTTPS endpoint is <b>127.0.0.1:8080</b>; SOCKS5 is <b>127.0.0.1:1080</b>. Export the public CA if your client needs to trust intercepted HTTPS. The proxy listens on loopback only.'),
('Before corporate use','Configure the upstream relay first when your network requires a proxy. Add confidential hosts to the privacy bypass list before opening them. Use <b>Toggle proxy</b> for system-aware clients; the research browser also works without global changes.')])
standard(manual,4,'Workspace','The research workspace','The toolbar controls routing and interception; the sidebar moves between the questions you are investigating.',[
('Navigate by task','<b>Traffic</b> is the capture list and paired inspectors. <b>Intercept</b> holds paused messages. <b>Repeater</b> sends edited requests and runs payload experiments. Timeline, TLS Inspector and Header Hardening provide focused analysis.'),
('Settings stay separate','Use the top-right Settings button or <b>Cmd/Ctrl+,</b>. All themes, network listeners, interception filters, relays, bypass lists, CA choices, storage and community preferences live in that pane.')],[
('Know the three switches','<b>Start proxy / Capturing</b> controls the local listeners. <b>Toggle proxy</b> changes system routing on macOS. <b>Intercept</b> pauses matching messages. A running listener does not mean every application is using it.'),
('Move quickly','<b>Cmd/Ctrl+K</b> opens the command palette. <b>Cmd/Ctrl+R</b> sends the selected record to Repeater when focus is outside an editor. Escape closes a context menu. The footer shows listener and CA state.')],shot='glasses-traffic-dark.png',caption='Workspace overview: local lab records, host navigation and separate request/response inspection.')
standard(manual,5,'Capture','Reading captured traffic','Preserve context while moving from a request list to the exact headers and bytes that explain it.',[
('Find the relevant request','Filter by URL, host, method or status, choose a protocol filter, or select a host in the sidebar. <b>In scope</b> uses literal host/URL fragments from General settings. Scope is a display filter, not a privacy exclusion.'),
('Choose the representation','Headers show fields. Body decodes supported content encodings and can pretty-print JSON. Raw combines a reconstructed HTTP/1.1 start line, headers and body. Hex shows bytes with offsets. Raw is not a wire-perfect TCP transcript.'),
('Move to the right tool','Right-click a record to send it to Repeater, intercept future matching requests, view timing, inspect TLS on HTTPS targets, check response headers, or copy a URL/cURL command. Unavailable actions are disabled.')],[
('Respect capture boundaries','Captured bodies default to 2 MiB. Responses above the limit continue streaming; only the prefix is retained. Oversized incoming requests are rejected. A response that exceeds the limit cannot wait for whole-body interception.'),
('Preview versus export','Text and hex previews are bounded so large data does not overwhelm the interface. Hex displays up to 64 KiB. Save the body to obtain all captured bytes. This still excludes bytes that were never retained because the capture limit was exceeded.'),
('History is temporary','Records stay in memory until you export. Old completed entries are trimmed by the configured count and an approximately 128 MiB body budget. Clearing the list requires resolving paused messages first. Export before clearing if you need the evidence.')])
standard(manual,6,'Context actions','Right-click where you work','Menus are specific to the view and selected data. Extensions can add commands to those same surfaces.',[
('Body and byte views','Select a substring before opening the menu, or operate on the whole current view. Copy the selection/view, open the encode/decode preview, save the captured body, or transfer the related request to another tool.'),
('Headers','Header menus offer field-aware copy and rule actions alongside request handoffs. A response security header can lead directly to a hardening check. Transport-managed fields are protected from rewrite rules.')],[
('Transform with a preview','Use URL, Base64, hexadecimal, HTML entity and JSON transformations. Check the output before copying it or replacing an editable selection. Invalid input reports an error. Previewing a captured body does not rewrite its stored evidence.'),
('Community contributions','A plugin can register commands for request/response bodies and headers, traffic, Repeater, Intercept, Timeline and TLS. The menu labels include the plugin name. Its declared capabilities determine which selected data it receives.')],shot='glasses-context-with-extension.png',caption='Response context menu with the Data Lens extension. Commands act on the originating record and selected text.')
standard(manual,7,'Interception','Intercept, edit and forward','Pause a matching request or response, make a controlled change, and choose what happens next.',[
('Configure the pause','In Proxy & interception, choose <b>Request</b>, <b>Response</b> or <b>Request and response</b>. Optionally restrict interception to a literal, case-sensitive URL fragment. Enable Intercept from the workspace toolbar.'),
('Edit the pending message','Select a pending item. For requests, edit method, URL, headers and body. For responses, edit status, headers and body. <b>Forward</b> continues with your changes; <b>Drop</b> fails that exchange.')],[
('Keep the queue moving','The queue is limited to 100 pending messages. An unresolved message is dropped at the configured deadline, default 120 seconds. Turning Intercept off forwards pending items. Stopping the proxy drops them.'),
('Know the boundaries','Large responses stream when they exceed the capture budget. Repeater requests do not enter the interactive interception queue. Bypassed destinations cannot be inspected; changing network/bypass settings disconnects tunnels and cancels pending work.')],shot='glasses-intercept.png',caption='An actual local request paused before forwarding. The editor and decision buttons stay together.')
standard(manual,8,'Repeater','Repeat with intent','Rebuild an exchange, change one variable, and inspect what the server actually returns.',[
('Seed and send','Choose <b>Send to Repeater</b> on a captured HTTP request, or prepare a request draft from an extension. Review the method and URL. Edit headers as name/value lines; use the body editor for content. Click <b>Send request</b>.'),
('Preserve the bytes you need','Use UTF-8 for ordinary text and Base64 for binary payloads. Glasses derives Host and Content-Length for the target and body. Header newlines and invalid method/URL forms are rejected.')],[
('Use the same route','Repeater uses the saved relay chain, upstream TLS verification and rewrite rules. The result appears in the session history and response pane. It cannot bypass a failed relay or a privacy exclusion silently.'),
('A good debugging loop','Start with a successful baseline. Change a parameter or header, send, compare status/body/size, then save the useful records. Copy as cURL when you need a command-line reproduction. Repeater drafts do not send until you ask.')],shot='glasses-repeater.png',caption='Repeater with a completed three-request payload run against the local lab.')
standard(manual,9,'Repeater','Iterations and fuzz payloads','Turn a single draft into a bounded experiment with explicit payloads, concurrency and timing.',[
('Build a template','Enable <b>Iterations / fuzz</b>. Put <font name="Courier">{{payload}}</font> in the URL, a header value or body. Put <font name="Courier">{{iteration}}</font> where you want the one-based request number. Replacement is literal.'),
('Define the run','Enter one payload per line. Payloads cycle if the iteration count is larger than the list. The maximum is 1,000 iterations and 10 concurrent workers. The delay is applied per worker, so concurrency affects aggregate request rate.'),
('Example','URL:<br/><font name="Courier">https://app.example/search?q={{payload}}</font><br/><br/>Payloads: <font name="Courier">alpha</font>, <font name="Courier">beta</font>, <font name="Courier">gamma</font>.<br/>Set 3 iterations and concurrency 1 for one request per value. URL-encode payloads explicitly when needed.')],[
('Read the result table','Each result reports iteration, payload, status, captured record, duration or an error. Open a result to inspect its request and response. A failed request does not mean the whole run stopped; review the per-result error.'),
('Cancel predictably','Cancel stops active requests and wakes waiting workers. Stopping the proxy or changing routing cancels active runs too. A server may already have received an earlier request; cancellation cannot undo server-side changes.'),
('What fuzz means in 0.1','This is payload substitution and repeatable request execution. It is not an automatic vulnerability scanner, a combinatorial attack engine or a malformed-wire request-smuggling tool. Keep your interpretation tied to the actual response evidence.')])
standard(manual,10,'Performance','Site Timeline / Speed Inspector','See where observed network time is spent, compare slow requests, and follow an outlier back to its evidence.',[
('Start with captured traffic','Timeline uses the current session. Capture a page or API workflow, then open Timeline. Compare request starts, total duration and transfer sizes; sort or inspect interesting rows and send them to Repeater.'),
('Read measured phases','Connection, TLS, first-byte wait and download are based on proxy observations. A configured relay can add negotiation time. Missing phases are unavailable rather than invented; local lab transfers often have little measurable connection delay.')],[
('Use a repeatable comparison','Compare the same route and request under similar conditions. Run sequentially when measuring single-request latency; use concurrency deliberately when studying contention. Include response size and errors when comparing results.'),
('This is network timing','Glasses does not measure DOM rendering, browser layout, paint, JavaScript execution or Core Web Vitals. It does not replace a browser performance profiler. Export timing data or captures to continue analysis elsewhere.')],shot='glasses-timeline.png',caption='The local lab includes a deliberate slow response so the waterfall has an explainable comparison.')
standard(manual,11,'Transport','SSL / TLS Inspector','Probe the upstream identity and transport independently of the certificate Glasses presents to a client.',[
('Inspect an endpoint','Enter an HTTPS host/URL and optional port, or open the inspector from a captured HTTPS record. Click <b>Inspect TLS</b>. The probe uses the saved relay chain and respects privacy exclusions.'),
('Read the chain','Select the leaf or an issuer to inspect subject, issuer, SANs, validity, fingerprint and certificate details. Copy or export certificate information when comparing deployments or reporting a mismatch.')],[
('Interpret the trust result','The inspector reports a validation error so you can examine a broken certificate. Ordinary proxied HTTPS still requires upstream validation. Inspecting a failure does not grant it trust for later browsing.'),
('One negotiated connection','Protocol, cipher, ALPN and handshake duration describe that connection. This is not an exhaustive cipher scan or vulnerability assessment. The illustrated local TLS lab uses the active test CA and is explicitly trusted for this demonstration.')],shot='glasses-tls.png',caption='A real TLS handshake with the local HTTPS lab. Certificates and timestamps vary per installation.')
standard(manual,12,'Response policy','Header Hardening and rules','Use response evidence to review browser protections, then test a specific policy change.',[
('Review the findings','The checks cover CSP, CORS, HSTS, nosniff, framing, referrer/permissions/isolation headers, cookie flags and technology disclosure. Select a captured response to inspect the observed values and advice.'),
('Treat results as context','A missing policy is a review item, not proof of a vulnerability. Public APIs may intentionally allow broad CORS; cookies differ by purpose. CSP checks are heuristics, not a full policy parser.')],[
('Test header changes','Rules can set or remove a request/response header for a literal URL-substring match. Create a rule from a header context menu or in Rules. Enable it, repeat the exchange, and inspect the visible applied-rule provenance.'),
('Keep the evidence clear','Rules modify actual forwarded traffic, not only the display. Transport-managed headers cannot be rewritten through the rule API. Bypassed destinations skip rules. Plugin-provided checks are attributed to the extension.')],shot='glasses-headers.png',caption='Header findings are advisory and grounded in the selected response, including lab endpoints with absent policies.')
standard(manual,13,'Network routing','The system proxy toggle','Switch between Glasses and your saved network configuration without dismantling the research workspace.',[
('Turn it on','On macOS, click <b>Toggle proxy</b> next to Start proxy. Glasses starts its listeners if needed and configures HTTP, HTTPS and SOCKS on enabled services in the current network location. macOS may request authorization.'),
('Corporate setup comes first','If an existing manual proxy or PAC configuration is detected, Glasses requires an upstream relay before replacing it. Use <b>Show current macOS proxies</b> in Settings as a reference. PAC evaluation and credential import are not automatic.'),
('Turn it off','Click again to restore the saved proxy dictionaries and protocol-enabled state, including prior PAC, bypass and authentication settings. The listeners remain running for clients configured manually. Stop/quit also restores managed system settings.')],[
('Research browser behavior','Switching off returns open research sessions to system routing and closes pooled connections. Reload to create a fresh connection. On a fresh launch, Open browser explicitly uses Glasses even when global routing has never been enabled.'),
('Recovery and conflicts','A recovery journal is saved before changing settings. After an unclean exit, restoration is attempted next launch. If another application changed a service, Glasses preserves its changes and releases settings still owned by Glasses. A recovery report is saved. If the OS refuses restoration, Quit anyway closes the app and keeps the journal for next launch.'),
('Scope of the switch','This is a system-proxy convenience, not a VPN. Explicitly configured apps can ignore it; new services/locations need another toggle cycle. Windows/Linux use manual proxy setup in 0.1. Tests cover restore/rollback, conflicts and shutdown failures. A real leftover macOS proxy configuration was restored successfully; fresh takeover still needs interactive acceptance.')])
standard(manual,14,'Corporate networks','Proxy / SOCKS relay chains','Put Glasses in front of a mandatory corporate proxy, or build a deliberate sequence of upstream hops.',[
('Configure in order','In Proxy & interception, add a hop, select HTTP, HTTPS or SOCKS5, and enter host/port. Add credentials if needed. Use the arrows to reorder up to eight hops. Enable relaying and save. The diagram follows connection order.'),
('Test the saved route','Use an HTTPS test destination. The test opens the connection and validates TLS without fetching a page. HTTP destinations use absolute-form forwarding at the last HTTP(S) proxy. Intermediate links and HTTPS targets use CONNECT.')],[
('Authentication and privacy','HTTP Basic and SOCKS5 username/password are supported. Relay passwords use OS-backed encryption and are not returned to the renderer. The first HTTP/SOCKS5 link is unencrypted; use HTTPS proxy transport where available.'),
('Explicit boundaries','Relay failure never falls back to direct access. PAC scripts, NTLM, Kerberos and SOCKS4 are not yet supported. A relay is also used for excluded traffic, Repeater, TLS inspection and WebSocket upgrades. Remote SOCKS DNS and local CIDR checks can differ.')],shot='glasses-relay-detail.png',caption='Example configuration, relay disabled until enabled and saved. Use your real corporate endpoints.',detail=True)
standard(manual,15,'Confidential destinations','Privacy bypass lists','Exclude sensitive hosts from interception and history while retaining the network route they need.',[
('Write precise entries','Use one entry per line: a hostname, <font name="Courier">*.corp.example</font>, an IP, or an IPv4/IPv6 CIDR. Blank lines and lines beginning with # are ignored. Up to 500 entries are accepted.'),
('Understand matching','A literal hostname is exact. A wildcard matches subdomains only; add the bare domain separately. IP ranges also check locally resolved hostname addresses. If a CIDR check cannot resolve, the connection is withheld.')],[
('What bypass changes','Excluded HTTPS CONNECT stays an opaque tunnel, preserving the origin certificate. Excluded HTTP/SOCKS traffic is forwarded without capture, interception, rules or plugin visibility. The saved corporate relay still applies.'),
('Apply before browsing','Saving closes existing tunnels and cancels pending work. Repeater and TLS Inspector refuse excluded targets. Older captures and exports remain until you clear/delete them. For remote split DNS, list sensitive hostnames explicitly; local CIDR checks cannot know a relay’s different DNS answer.')],shot='glasses-bypass-detail.png',caption='Examples only: *.corp.example, 10.0.0.0/8 and the IPv6 documentation range 2001:db8::/32.',detail=True)
standard(manual,16,'Identity and trust','Organization CA and trust','Use a dedicated local CA or an organization-issued signing CA already trusted by your managed clients.',[
('Import the signing material','Stop the proxy. In Certificates, enter a key passphrase if needed, then choose <b>Import certificate & signing key…</b>. Select the PEM CA file first and its matching PEM private key second. Place parent certificates after the signing CA in issuer order.'),
('Validation and support','Glasses checks CA/signing usage, validity, key match and supplied issuer signatures. The first release accepts RSA keys of at least 2048 bits. Leaf validity never extends beyond the signing CA. ECDSA and hardware-backed signing are deferred.')],[
('Trust is a separate action','A public CA alone cannot sign intercepted connections. Clients need to trust the signing chain. Glasses never installs OS trust automatically. The research browser narrowly accepts active-CA signatures with valid names and dates.'),
('Protect and recover','Imported keys are stored with private file permissions, unencrypted at rest; the unlock passphrase is not saved. Export CA certificate returns public material only. <b>Use local CA</b> removes the imported copy and returns to the original installation CA.')],shot='glasses-ca-detail.png',caption='Certificate import is an explicit operation while the proxy is stopped. No private key is shown in the UI.',detail=True)
standard(manual,17,'Preferences and files','Themes, storage and exchange','Keep the main workspace focused while tailoring presentation, limits and evidence handling in Settings.',[
('Appearance','Choose System, Dark or Light; System follows the OS. Red, violet, ocean and amber accents affect controls. The glasses remain red and the THUGSred suffix remains red. Compact density fits more data on screen.'),
('Session exchange','Save a native Glasses session to reopen captured work. Export HAR for exchange with other tools. Import accepts native sessions and HAR, normalizing some metadata; imported HAR does not restore original per-phase timing.')],[
('Storage controls','Files & storage selects the default export folder, reveals application data, sets the entry limit and capture budget. Normal captures remain in memory. Exports can contain cookies, tokens and bodies, so choose their destination deliberately.'),
('Important defaults','1,000 entries; 2 MiB per captured body; 30-second network deadline; 120-second interception deadline. Port changes need a listener restart. Toggle managed system routing off before changing ports. Unsaved edits can be saved or discarded when leaving Settings.')],shot='glasses-settings-light.png',caption='Light mode uses the same dedicated Settings layout and keeps the product’s red branding.')
standard(manual,18,'Extensions','Install a community tool','Local extensions already add useful workflows. The online community shop will arrive with the separate backend.',[
('Install and review','Open Plugins and select <b>Install from file</b>. Choose a UTF-8 JSON manifest, review its declared capabilities, then install it. New plugins start disabled. Enable only the capabilities/workflow you intend to use.'),
('Try the examples','Security Headers adds declared header rules/checks. Data Lens adds a sidebar tool, selection-aware context actions, JSON/text operations and a Repeater handoff. Export the examples from the app or use the plugin-sdk examples directory.')],[
('Manage contributions','An enabled extension can add multiple tools and contextual commands. Disabling/removing it removes its contributions and unloads an active tool. Replacing a plugin currently requires removing the previous version first.'),
('Capabilities are boundaries','Selected traffic may include sensitive data. Plugins receive only declared context and brokered host actions. They have no direct Node, filesystem or network access. Publishers are self-declared; a signed catalog, updates and reputation system are future work at glasses.thugs.red.')],shot='glasses-extension-tool.png',caption='Data Lens is a complete extension pane, not just a fixed toolbar action.')
standard(manual,19,'Extension development','Build your own extension','API v1 uses a bounded JSON manifest with declarative contributions and isolated HTML/CSS/JavaScript.',[
('Declare the surface','Set apiVersion: 1, an id, name, semver version, author and description. Declare capabilities before adding tools or contextMenus. A manifest is limited to 256 KiB, with up to 10 tools and 30 contextual commands.'),
('Receive context','Use <font name="Courier">glassesPlugin.onContext(callback)</font>. The object identifies command, originating view and toolId. selection.read permits selected text; traffic.readSelected permits the related record with base64 captured bodies. The last context is also window.glassesContext.'),
('Prepare a handoff','With repeater.write, call <font name="Courier">glassesPlugin.sendToRepeater(draft)</font> using url, method, headers, body and bodyEncoding. The host validates the draft and the researcher clicks Send. With text.transform, showText opens a result preview.')],[
('Choose capabilities','UI: ui.tools, ui.contextMenus.<br/>Context: selection.read, traffic.readSelected.<br/>Actions: text.transform, repeater.write.<br/>Declarative analysis: request.headers, response.headers, response.analyze.'),
('Treat traffic as hostile','Use textContent to display untrusted strings. Do not turn captured HTML into executable UI. Bundle code/styles in the manifest; remote imports are denied. Host messages are source-checked, rate-limited to 20/second, with text results up to 1 MiB.'),
('Develop from the SDK','The repository’s plugin-sdk/README.md contains the complete manifest and bridge contract, surfaces and runnable examples. UI frames are opaque-origin sandboxes. CPU/memory quotas, arbitrary proxy hook workers, packaged assets and persistent plugin storage are not in v1.')])
standard(manual,20,'Security model','Treat hostile content as data','Glasses intentionally handles untrusted traffic. Its research capabilities are separated from application authority.',[
('Renderer and browser','The application UI is local, sandboxed, context-isolated and has no Node integration. Captured HTML/SVG/JavaScript is rendered as text. A separate research browser can run site JavaScript without receiving the application IPC bridge.'),
('Privileged operations','The main process validates the calling window, top frame and origin as well as action payloads. There is no generic shell or arbitrary file-read bridge. Native file dialogs provide deliberate import/export boundaries. The About action opens one fixed HTTPS URL.'),
('Bounded processing','Header construction rejects injection characters. Capture limits, request/interception deadlines and a bounded decompressor limit resource use. Operational logs contain metadata rather than traffic bodies, URLs, keys or credentials.')],[
('Network controls','Upstream TLS validation remains enabled for ordinary traffic. Relay failures do not use direct access. Private destinations are excluded before capture and MITM. Local listeners are loopback-only but are not authenticated against other programs on the same machine.'),
('Extension isolation','An opaque frame, restrictive CSP and capability-checked messages separate extension code from the core. These controls do not prevent every resource-exhaustion or misleading-interface problem. Disable a misbehaving extension.'),
('Release posture','Packaged fuses disable RunAsNode, Node options and Node inspection, require ASAR and enable supported integrity checks. Independent security review, signed/notarized distribution, updates, encrypted evidence vaults and enterprise administration remain work. See SECURITY.md for the full threat model and source references.')])
standard(manual,21,'Developer reference','Build and release reference','The repository contains the application, proxy core, extension SDK, tests and native packaging configuration.',[
('Run from source','Use Node.js 24 LTS and npm. Run <font name="Courier">npm ci</font>, then <font name="Courier">npm run dev</font>. On macOS the native helper build needs Xcode command-line tools. For production UI: run native, build, then start.'),
('Validate','<font name="Courier">npm run check</font>: build and core tests.<br/><font name="Courier">npm run test:ui</font>: Electron workflow and screenshots.<br/><font name="Courier">npm run security:check</font>: build/tests plus dependency audit.<br/><font name="Courier">npm run test:packaged</font>: local hardened ARM64 package smoke.'),
('Package','Use release:all from the Mac checkout. macOS builds locally; Windows uses a local Docker/Wine worker; Linux uses a disposable Docker/SSH worker. Packages and SHA256SUMS return to release/. See docs/BUILDING.md for worker setup.')],[
('Verified versus configured','39 core/security/network tests pass. Desktop, recovery and hardened ARM64 package smokes pass. The native helper restored real leftover macOS settings. Linux packages were built for both architectures; Windows cross-builds target both. Windows/Linux GUI acceptance is separate.'),
('Protocol boundaries','HTTP/1.1 inspection; HTTPS MITM; SOCKS5 TCP metadata; WebSocket upgrade passthrough. No HTTP/2 or HTTP/3 inspection, gRPC semantics, SOCKS UDP or WebSocket frame editing. The TLS tool observes one negotiated connection.'),
('Shipping work','Packages are development builds without distribution signing or notarization. Intel macOS was not run on Intel hardware. The repository uses CC BY-NC 4.0 with additional workplace/consulting permission; read LICENSE before redistribution.')])
standard(manual,22,'Keep moving','Troubleshooting and glossary','Start with the route, then trust, then the specific request. Keep the version and a minimal reproduction with any report.',[
('No traffic appears','Check that the listener is running and the client actually uses it. Toggle proxy only affects system-aware clients. Explicit browser proxy settings can override it. Review protocol and scope filters, then the privacy bypass list.'),
('Connection or relay errors','Confirm hop order, hostname, port and credentials. Save before Test saved route. HTTP 407 usually means proxy authentication is needed; this release supports Basic, not NTLM/Kerberos. A relay may disallow CONNECT to a requested port. There is no direct fallback.'),
('HTTPS fails','Check the upstream certificate with TLS Inspector. For intercepted traffic, verify client trust in the active signing chain. For pinned clients, use an appropriate bypass entry. Confirm CA validity and that the import includes a matching RSA signing key.'),
('Requests remain paused','Review Intercept and its URL/phase filter. Forward, drop, or turn Intercept off. Deadline expiry drops the message. Large responses may have already streamed without a whole-body pause.')],[
('Restoration conflict','Glasses preserves externally changed endpoints and releases remaining settings it owns. A conflict does not block closing. If macOS rejects the write, use Quit anyway or keep working; the recovery journal remains for the next launch. After an unclean exit, check network settings if connectivity is affected.'),
('Terms','<b>MITM:</b> decrypting and re-signing a client’s HTTPS connection for inspection.<br/><b>CA:</b> certificate authority used for signing.<br/><b>Relay/hop:</b> a proxy in the upstream route.<br/><b>CIDR:</b> an IP network/prefix such as 10.0.0.0/8.<br/><b>HAR:</b> HTTP Archive exchange format.'),
('Further reference','Project: README.md, SECURITY.md, docs/RELEASE_NOTES.md and plugin-sdk/README.md.<br/><link href="https://www.electronjs.org/docs/latest/tutorial/security" color="#e9374c">Electron security guidance</link><br/><link href="https://developer.apple.com/documentation/systemconfiguration/scpreferences-ft8" color="#e9374c">Apple network preferences API</link><br/><link href="https://datatracker.ietf.org/doc/html/rfc1928" color="#e9374c">SOCKS5 protocol specification</link><br/><link href="https://glasses.thugs.red" color="#e9374c">Official Glasses home</link>')])
manual.save()

# A concise four-page, shareable introduction; no invented download or account CTA.
b=canvas.Canvas(str(OUT/'Glasses-Product-Overview.pdf'),pagesize=(W,H),pageCompression=1)
b.setTitle('Glasses - Look closer. Product overview');b.setAuthor('THUGSred');b.setSubject('Four-page introduction to the Glasses research workspace')
cover(b,True)
def promo_header(c,page,kicker,title,subtitle):
    c.setFillColor(white);c.rect(0,0,W,H,fill=1,stroke=0);brand(c,M,H-40,11)
    c.setFillColor(RED);c.setFont('Bold',9);c.drawString(M,H-86,kicker)
    c.setFillColor(INK);c.setFont('Bold',30);c.drawString(M,H-125,title)
    y=para(c,subtitle,M,H-148,CW,'intro')
    c.setStrokeColor(LIGHT);c.line(M,49,W-M,49);c.setFillColor(MUTED);c.setFont('Body',8);c.drawString(M,31,'GLASSES 0.1  /  PRODUCT OVERVIEW');c.drawRightString(W-M,31,f'{page:02}');return y-20

y=promo_header(b,2,'FROM OBSERVATION TO EXPERIMENT','Follow the request.','See what moved across the wire, ask a better question, and test it from the same workspace.')
y=image(b,'glasses-repeater.png',M,y,CW)-23
col=(CW-24)/2
blocks(b,[('Inspect the evidence','Paired request/response views keep headers, readable bodies and bytes close together. Context menus move the selected exchange into the next tool.'),('Make a precise change','Intercept and edit a message before forwarding. Repeater turns an observed request into a controlled experiment, with payload iterations when you need to compare inputs.')],M,y,col)
blocks(b,[('Find the delay','A request waterfall, durations and transfer totals help explain slow exchanges. Follow an outlier back to the request that caused it.'),('Review transport and policy','Inspect TLS identity and certificate chains. Review CSP, CORS, nosniff, HSTS and other response-header signals with advice tied to the captured evidence.')],M+col+24,y,col)
b.showPage()
y=promo_header(b,3,'WORK WITH YOUR ENVIRONMENT','Keep your route.','A research proxy should fit the network you actually have - and keep confidential destinations out of the capture.')
# Legible vector route diagram.
labels=['Your client','Glasses','Corporate relay','Destination'];boxw=(CW-45)/4
for i,label in enumerate(labels):
    x=M+i*(boxw+15);b.setFillColor(RED if i==1 else LIGHT);b.roundRect(x,y-62,boxw,55,8,fill=1,stroke=0)
    b.setFillColor(white if i==1 else INK);b.setFont('Bold',10);b.drawCentredString(x+boxw/2,y-39,label)
    if i<3:b.setFillColor(MUTED);b.setFont('Bold',12);b.drawCentredString(x+boxw+7.5,y-39,'>')
y-=94
blocks(b,[('Chain the required proxies','Configure ordered HTTP, HTTPS and SOCKS5 hops, with supported authentication and a route test. If the relay fails, Glasses does not silently connect directly.'),('Switch without the setup ritual','The macOS system proxy toggle saves the existing configuration and restores it when you switch off, stop or quit. Local listeners remain separate from system routing.'),('Keep private traffic private','Exclude hostnames, wildcard subdomains, IPs or CIDRs before capture. Excluded HTTPS remains an opaque tunnel. Your configured corporate relay still carries the traffic.')],M,y,col)
blocks(b,[('Bring your organization CA','Import an RSA signing CA and matching key, including its issuer chain. Existing managed client trust can fit your workflow; OS trust installation stays an explicit administrative choice.'),('Build the tool you wish existed','Extensions can add complete sidebar tools, focused context actions, header rules and analysis. The v1 SDK and working examples support local development today.'),('A workspace that stays readable','Dedicated Settings, OS-following light/dark modes, multiple accent palettes and consistent cross-tool actions keep attention on the investigation.')],M+col+24,y,col)
b.setFillColor(LIGHT);b.roundRect(M,98,CW,78,10,fill=1,stroke=0)
para(b,'<b>Built around hostile data.</b> Captured content stays text in the application UI. Sandboxed windows, constrained IPC and isolated extension frames protect the boundary between web traffic and application authority.',M+17,158,CW-34,'p')
b.showPage()
y=promo_header(b,4,'A COMMUNITY TOOL, TAKING SHAPE','Look closer. Build further.','Created by THUGSred, the Danish hacking community, for web security research and development.')
b.drawImage(str(ROOT/'docs/brand/glasses-preview.png'),M+45,y-149,width=CW-90,height=(CW-90)*440/1200,mask='auto')
y-=185
blocks(b,[('Available in the first build','HTTP/1.1 and HTTPS inspection, SOCKS5 TCP tunnels, interception, Repeater iterations, timeline, TLS/header inspection, local extensions, custom CA, bypass policies and upstream proxy chains.'),('macOS first, portable by design','The first desktop is built and exercised on Apple Silicon. Packages target Intel macOS and x64/ARM64 Windows/Linux, with all builds initiated from the Mac checkout. Native platform acceptance and distribution hardening continue.')],M,y,col)
blocks(b,[('What is coming next','The official home is glasses.thugs.red; the online extension community is planned for the same address. Catalog publishing, accounts, ratings, signed extension distribution and automatic updates are planned separately.'),('Release status','Version 0.1 is a local development release, not an audited enterprise deployment. Packages are not Developer ID signed/notarized. HTTP/2/3, WebSocket frame editing and enterprise proxy SSO are not yet supported.')],M+col+24,y,col)
b.setFillColor(DARK);b.roundRect(M,88,CW,94,12,fill=1,stroke=0)
b.setFont('Bold',20);b.setFillColor(white);b.drawString(M+20,143,'glasses.thugs.red')
para(b,'The official home for Glasses.<br/>Keep this introduction with the illustrated user manual.',M+20,128,CW-120,'white')
widget=qr.QrCodeWidget('https://glasses.thugs.red');bounds=widget.getBounds();size=66;d=Drawing(size,size,transform=[size/(bounds[2]-bounds[0]),0,0,size/(bounds[3]-bounds[1]),0,0]);d.add(widget)
b.setFillColor(white);b.roundRect(W-M-83,101,70,70,4,fill=1,stroke=0);renderPDF.draw(d,b,W-M-81,103)
b.linkURL('https://glasses.thugs.red',(M,88,W-M,182),relative=0,thickness=0)
b.showPage();b.save()
print('Created 22-page manual and 4-page product overview in',OUT)
