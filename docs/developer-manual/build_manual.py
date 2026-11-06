"""Rebuild the source-grounded Glasses developer manual with ReportLab."""
from pathlib import Path
import json, os
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'output/pdf/Glasses-Developer-Manual-API-v1.pdf'
font_candidates = [
    Path(os.environ.get('GLASSES_MANUAL_FONT_DIR', '/nonexistent')),
    Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype',
    Path('/usr/share/fonts/truetype/dejavu'),
]
FONTROOT = next((p for p in font_candidates if (p/'DejaVuSans.ttf').is_file()), None)
if FONTROOT is None:
    raise RuntimeError('Set GLASSES_MANUAL_FONT_DIR to a directory containing the DejaVu TTF family.')
for name, file in [('Sans','DejaVuSans.ttf'), ('Sans-Bold','DejaVuSans-Bold.ttf'), ('Sans-Oblique','DejaVuSans-Oblique.ttf'), ('Mono','DejaVuSansMono.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONTROOT/file)))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans-Oblique', boldItalic='Sans-Bold')
W,H=595.276,841.89
M=48
CW=W-2*M
INK=colors.HexColor('#202733'); MUTED=colors.HexColor('#596477')
RED=colors.HexColor('#bb2538'); LIGHT=colors.HexColor('#f2f4f7')
DARK=colors.HexColor('#17191f'); LINE=colors.HexColor('#d9dfe7')
styles={
 'body':ParagraphStyle('body',fontName='Sans',fontSize=10,leading=14.8,textColor=INK,spaceAfter=9),
 'small':ParagraphStyle('small',fontName='Sans',fontSize=8.1,leading=11.7,textColor=MUTED),
 'h2':ParagraphStyle('h2',fontName='Sans-Bold',fontSize=12.4,leading=17,textColor=INK,spaceAfter=6),
 'cell':ParagraphStyle('cell',fontName='Sans',fontSize=8.8,leading=12.7,textColor=INK),
 'thead':ParagraphStyle('thead',fontName='Sans-Bold',fontSize=8.5,leading=12.3,textColor=colors.white),
}
pages=[]
def page(section,title,subtitle='',blocks=None):
    pages.append(dict(section=section,title=title,subtitle=subtitle,blocks=blocks or []))
def p(t): return ('p',t)
def h(t): return ('h',t)
def note(title,t): return ('note',title,t)
def bullets(*items): return ('bullets',items)
def table(headers,rows,widths=None): return ('table',headers,rows,widths)
def code(t,label='Example',size=8.2): return ('code',t.strip('\n'),label,size)
def source(t): return ('source',t)
def diagram(kind): return ('diagram',kind)
def sourcecode(name,start=None,end=None,label=None):
    lines=(HERE/'examples'/name).read_text().splitlines()
    return code('\n'.join(lines[slice(start,end)]), label or name, 8.0)

exec((HERE/'manual_content.py').read_text(),globals())

class Book:
    def __init__(self):
        OUT.parent.mkdir(parents=True,exist_ok=True)
        self.c=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1)
        self.c.setTitle('Glasses Developer Manual | Extension API v1')
        self.c.setAuthor('THUGSred Glasses | Developer documentation')
        self.c.setSubject('SDK, plugins, examples, developer journeys, coding standards, UI/UX and compatibility')
        self.c.setKeywords('Glasses, THUGSred, SDK, API v1, plugins, extensions, developer manual')
        self.y=0; self.metrics=[]
    def para(self,t,style='body',x=M,width=CW):
        obj=Paragraph(t,styles[style]); _,hh=obj.wrap(width,1000)
        obj.drawOn(self.c,x,self.y-hh); self.y-=hh+styles[style].spaceAfter
    def block(self,b):
        kind=b[0]
        if kind=='p': self.para(b[1])
        elif kind=='h': self.y-=4; self.para(b[1],'h2')
        elif kind=='source':
            self.y-=3; self.para('<b>Implementation:</b> '+b[1],'small'); self.y-=8
        elif kind=='bullets':
            for t in b[1]:
                self.para('<font color="#bb2538"><b>•</b></font>  '+t)
        elif kind=='note':
            obj=Paragraph('<b>'+b[1]+'</b><br/>'+b[2],styles['body']); _,hh=obj.wrap(CW-28,1000)
            self.c.setFillColor(LIGHT); self.c.roundRect(M,self.y-hh-22,CW,hh+22,5,fill=1,stroke=0)
            self.c.setFillColor(RED); self.c.rect(M,self.y-hh-22,3,hh+22,fill=1,stroke=0)
            obj.drawOn(self.c,M+14,self.y-hh-11); self.y-=hh+34
        elif kind=='code':
            text,label,size=b[1:]; lines=text.splitlines(); leading=size*1.43
            for line in lines:
                if pdfmetrics.stringWidth(line,'Mono',size)>CW-26:
                    raise ValueError(f'Code line too wide in {self.page_title}: {line}')
            hh=len(lines)*leading+39
            self.c.setFillColor(LIGHT); self.c.roundRect(M,self.y-hh,CW,hh,5,fill=1,stroke=0)
            self.c.setFillColor(MUTED); self.c.setFont('Sans-Bold',7.5); self.c.drawString(M+13,self.y-15,label.upper())
            self.c.setFillColor(INK); self.c.setFont('Mono',size)
            for i,line in enumerate(lines): self.c.drawString(M+13,self.y-34-i*leading,line)
            self.y-=hh+12
        elif kind=='table':
            headers,rows,widths=b[1:]; widths=widths or [1/len(headers)]*len(headers)
            data=[[Paragraph(escape(str(t)),styles['thead']) for t in headers]]
            data += [[Paragraph(str(t),styles['cell']) for t in r] for r in rows]
            tb=Table(data,colWidths=[CW*v for v in widths],hAlign='LEFT')
            tb.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),DARK),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,LIGHT]),
                ('LINEBELOW',(0,0),(-1,0),.5,DARK),('LINEBELOW',(0,1),(-1,-1),.3,LINE),
            ])); _,hh=tb.wrap(CW,1000); tb.drawOn(self.c,M,self.y-hh); self.y-=hh+14
        elif kind=='diagram': self.draw_diagram(b[1])
    def draw_diagram(self,kind):
        if kind=='architecture':
            nodes=[('AUTHORING','Source assets + build-time Node','One validated JSON package'),
                   ('HOST','Main process + proxy core','Rules, checks, storage and request validation'),
                   ('APPLICATION','React workspace','Selection filtering + active-frame message checks'),
                   ('EXTENSION','Opaque-origin iframe','HTML, CSS, local JS + glassesPlugin bridge')]
        else:
            nodes=[('1 / CAPTURE','Local lab or authorized target','Select one request and the relevant text'),
                   ('2 / ANALYZE','Extension tool','Transform locally and explain the source'),
                   ('3 / PREPARE','Host Repeater draft','Validate destination, method, headers and bytes'),
                   ('4 / SEND','Explicit user action','User clicks Send; host records the new request')]
        for i,(tag,title,sub) in enumerate(nodes):
            self.c.setFillColor(DARK if i==3 else LIGHT)
            self.c.roundRect(M,self.y-74,CW,74,5,fill=1,stroke=0)
            self.c.setFillColor(colors.HexColor('#ff858c') if i==3 else RED)
            self.c.setFont('Sans-Bold',8); self.c.drawString(M+15,self.y-18,tag)
            self.c.setFillColor(colors.white if i==3 else INK)
            self.c.setFont('Sans-Bold',12); self.c.drawString(M+15,self.y-38,title)
            self.c.setFont('Sans',9); self.c.drawString(M+15,self.y-56,sub)
            self.y-=90
    def cover(self):
        c=self.c; c.setFillColor(DARK); c.rect(0,0,W,H,fill=1,stroke=0)
        c.setFillColor(RED); c.rect(0,H-15,W,15,fill=1,stroke=0)
        c.setFont('Sans-Bold',11); c.setFillColor(colors.white); c.drawString(M,H-67,'THUGS')
        c.setFillColor(colors.HexColor('#ff666e')); c.drawString(M+44,H-67,'red')
        c.setFont('Sans',10); c.setFillColor(colors.HexColor('#bdc4d0')); c.drawRightString(W-M,H-67,'DEVELOPER EDITION / 01')
        logo=ROOT/'docs/brand/glasses-preview.png'
        im=ImageReader(str(logo)); iw,ih=im.getSize(); dw=345; dh=dw*ih/iw
        c.drawImage(im,M+40,H-180-dh,width=dw,height=dh,mask='auto')
        c.setFillColor(colors.white); c.setFont('Sans-Bold',44); c.drawString(M,385,'GLASSES')
        c.setFont('Sans-Bold',29); c.drawString(M,340,'Developer manual')
        c.setFont('Sans',14); c.setFillColor(colors.HexColor('#c6ccd7'))
        c.drawString(M,304,'SDK / Extensions / Plugins')
        c.setStrokeColor(colors.HexColor('#414753')); c.line(M,275,W-M,275)
        for i,line in enumerate(['Build useful local tools. Preserve captured evidence.',
                                 'Design accessible interfaces. Ship compatible packages.']):
            c.setFont('Sans',11); c.drawString(M,247-i*19,line)
        c.setFillColor(colors.HexColor('#ff858c')); c.setFont('Sans-Bold',10)
        c.drawString(M,131,'GLASSES 0.1.0  /  EXTENSION API v1')
        c.setFillColor(colors.HexColor('#b0b8c6')); c.setFont('Sans',9)
        c.drawString(M,109,'Source-reviewed edition • 6 November 2026')
        c.drawString(M,65,'Practical journeys + complete example + API reference + release checklist')
    def toc(self,start,end):
        for i in range(start,end):
            q=pages[i]
            if q['section']=='Front matter': continue
            label=q['title']
            c=self.c
            c.setFont('Sans',9.1); c.setFillColor(INK); c.drawString(M,self.y,label)
            c.setFillColor(RED); c.drawRightString(W-M,self.y,str(i+1))
            c.linkRect('',f'page-{i+1}',(M,self.y-5,W-M,self.y+13),relative=0,thickness=0)
            self.y-=18.8
    def render(self):
        n=len(pages)
        for i,q in enumerate(pages,1):
            self.page_title=q['title']; self.c.bookmarkPage(f'page-{i}')
            self.c.addOutlineEntry(q['title'],f'page-{i}',level=0,closed=False)
            if i==1: self.cover(); self.c.showPage(); continue
            c=self.c; c.setFillColor(RED); c.rect(M,H-48,27,3,fill=1,stroke=0)
            c.setFillColor(MUTED); c.setFont('Sans-Bold',8); c.drawString(M+37,H-49,q['section'].upper())
            self.y=H-91
            title=Paragraph(q['title'],ParagraphStyle('title',fontName='Sans-Bold',fontSize=24,leading=29,textColor=INK))
            _,hh=title.wrap(CW,1000); title.drawOn(c,M,self.y-hh); self.y-=hh+13
            if q['subtitle']: self.para(q['subtitle'],'small'); self.y-=11
            if q.get('toc'):
                self.toc(*q['toc'])
            else:
                for b in q['blocks']: self.block(b)
            if self.y<64: raise ValueError(f'Page {i} overflow: {q["title"]}, bottom={self.y:.1f}')
            self.metrics.append({'page':i,'title':q['title'],'content_bottom':round(self.y,1)})
            c.setStrokeColor(LINE); c.line(M,49,W-M,49)
            c.setFillColor(MUTED); c.setFont('Sans',7.3)
            c.drawString(M,34,'GLASSES / DEVELOPER MANUAL / API v1')
            c.drawRightString(W-M,34,f'{i:02} / {n:02}')
            c.showPage()
        c.save()
        (HERE/'layout-report.json').write_text(json.dumps(self.metrics,indent=2)+'\n')
        print(f'Built {n} pages: {OUT}')

if __name__=='__main__': Book().render()
