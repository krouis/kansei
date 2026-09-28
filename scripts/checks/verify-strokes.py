# Independent re-implementation: parse KanjiVG paths, compute arc length at very high
# resolution, and compare endpoints + arc length + resampled points against the
# Node build output. Deliberately written differently (t-uniform De Casteljau, 4000
# steps/segment) so a shared bug is unlikely.
import json, re, math, os, glob, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
KV=str(ROOT / "data/sources/kanjivg/kanji")
OUT=str(ROOT / "public/content/strokes")
num=re.compile(r'[-+]?(?:\d*\.\d+|\d+\.?\d*)')
def cubics(d):
    toks=re.findall(r'([A-Za-z])([^A-Za-z]*)',d)
    segs=[];cur=None;pc=None;curve=False;start=None
    for c,body in toks:
        a=[float(x) for x in num.findall(body)]
        rel=c.islower();C=c.upper()
        def R(x,y): return (cur[0]+x,cur[1]+y) if rel else (x,y)
        if C=='M':
            cur=(a[0],a[1]) if not (rel and cur) else (cur[0]+a[0],cur[1]+a[1])
            start=cur;pc=None;curve=False
            for i in range(2,len(a),2):
                to=R(a[i],a[i+1]);segs.append((cur,cur,to,to));cur=to;curve=False;pc=None
        elif C=='L':
            for i in range(0,len(a),2):
                to=R(a[i],a[i+1]);segs.append((cur,cur,to,to));cur=to;curve=False;pc=None
        elif C=='C':
            for i in range(0,len(a),6):
                c1=R(a[i],a[i+1]);c2=R(a[i+2],a[i+3]);to=R(a[i+4],a[i+5])
                segs.append((cur,c1,c2,to));cur=to;pc=c2;curve=True
        elif C=='S':
            for i in range(0,len(a),4):
                c1=(2*cur[0]-pc[0],2*cur[1]-pc[1]) if (curve and pc) else cur
                c2=R(a[i],a[i+1]);to=R(a[i+2],a[i+3])
                segs.append((cur,c1,c2,to));cur=to;pc=c2;curve=True
        else: raise SystemExit("unhandled "+c)
    return segs,start
def ev(p,t):
    (x0,y0),(x1,y1),(x2,y2),(x3,y3)=p;u=1-t
    return (u**3*x0+3*u*u*t*x1+3*u*t*t*x2+t**3*x3, u**3*y0+3*u*u*t*y1+3*u*t*t*y2+t**3*y3)
def polyline(d,steps=4000):
    segs,start=cubics(d);pts=[start];cum=[0.0];tot=0.0
    for s in segs:
        for i in range(1,steps+1):
            p=ev(s,i/steps)
            dd=math.dist(p,pts[-1])
            if dd==0: continue
            tot+=dd;pts.append(p);cum.append(tot)
    return pts,cum,tot
def resample(pts,cum,tot,n=24):
    if tot==0: return [pts[0]]*n
    out=[];j=0
    for i in range(n):
        target=tot*i/(n-1)
        while j<len(cum)-2 and cum[j+1]<target: j+=1
        seg=cum[j+1]-cum[j]; t=0 if seg==0 else (target-cum[j])/seg
        out.append((pts[j][0]+(pts[j+1][0]-pts[j][0])*t, pts[j][1]+(pts[j+1][1]-pts[j][1])*t))
    return out
idx=json.load(open(os.path.join(OUT,"index.json")))
chars=idx["characters"]
worstlen=0;worstpt=0;wl=None;wp=None;n=0
for glyph,meta in chars.items():
    ref=json.load(open(os.path.join(OUT,meta["file"])))
    hexn="%05x"%ord(glyph)
    svg=open(os.path.join(KV,hexn+".svg"),encoding="utf-8").read()
    region=svg.split('StrokePaths')[1]
    ds=re.findall(r'<path[^>]*\sd="([^"]*)"',region)
    assert len(ds)==len(ref["strokes"]), (glyph,len(ds),len(ref["strokes"]))
    for d,st in zip(ds,ref["strokes"]):
        assert d.strip()==st["path"], glyph
        pts,cum,tot=polyline(d)
        dl=abs(tot-st["length"])
        if dl>worstlen: worstlen=dl;wl=(glyph,tot,st["length"])
        rs=resample(pts,cum,tot)
        for a,b in zip(rs,st["points"]):
            dp=math.dist(a,b)
            if dp>worstpt: worstpt=dp;wp=(glyph,a,b)
        n+=1
print(json.dumps({"strokesChecked":n,
  "maxArcLengthDelta":round(worstlen,6),"atLength":wl,
  "maxResampledPointDelta":round(worstpt,6),"atPoint":wp},ensure_ascii=False))
