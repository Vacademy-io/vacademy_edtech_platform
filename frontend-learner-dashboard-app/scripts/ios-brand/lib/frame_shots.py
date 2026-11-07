"""Composite a raw simulator screenshot into a device frame on an App Store slot-size canvas.
Port of health-check device-frame-canvas.ts `mockLayout`: pad 5% of the short side,
iPhone bezel .028 / outer radius .12 / screen radius .096; iPad bezel .042 / .046 / .026.
Body = vertical gradient #525252 -> #171717 -> #404040 with a 0.3-alpha shadow. No dynamic island
(these captures carry no iOS status bar, so an island would cover the app header)."""
from PIL import Image, ImageDraw, ImageFilter
import sys

SLOTS = {'iphone': (1242, 2688), 'ipad': (2048, 2732)}
GEOM  = {'iphone': dict(bezel=.028, r_outer=.12, r_screen=.096), 'ipad': dict(bezel=.042, r_outer=.046, r_screen=.026)}

def rounded_mask(size, r):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0]-1, size[1]-1], radius=r, fill=255); return m

def frame(shot_path, kind, out_path, bg='white'):
    W, H = SLOTS[kind]; g = GEOM[kind]
    shot = Image.open(shot_path).convert('RGB')
    canvas = Image.new('RGB', (W, H), bg)
    pad = int(0.05 * min(W, H))
    # device outer box fills the canvas minus padding; screen aspect follows the screenshot
    bezel = int(g['bezel'] * min(W, H))
    avail_w, avail_h = W - 2*pad - 2*bezel, H - 2*pad - 2*bezel
    scale = min(avail_w / shot.width, avail_h / shot.height)
    sw, sh = int(shot.width * scale), int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    ow, oh = sw + 2*bezel, sh + 2*bezel
    ox, oy = (W - ow) // 2, (H - oh) // 2
    # shadow
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([ox, oy + int(0.01*oh), ox+ow, oy+oh + int(0.01*oh)], radius=int(g['r_outer']*min(ow, oh)), fill=(0, 0, 0, 77))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(0.02 * min(W, H))))
    canvas.paste(shadow, (0, 0), shadow)
    # body gradient
    body = Image.new('RGB', (ow, oh)); bd = ImageDraw.Draw(body)
    stops = [(0, (0x52,0x52,0x52)), (0.5, (0x17,0x17,0x17)), (1, (0x40,0x40,0x40))]
    for y in range(oh):
        t = y / max(oh-1, 1)
        for i in range(len(stops)-1):
            if stops[i][0] <= t <= stops[i+1][0]:
                f = (t - stops[i][0]) / (stops[i+1][0] - stops[i][0]); c = tuple(int(stops[i][1][k] + f*(stops[i+1][1][k]-stops[i][1][k])) for k in range(3)); break
        bd.line([(0, y), (ow, y)], fill=c)
    canvas.paste(body, (ox, oy), rounded_mask((ow, oh), int(g['r_outer'] * min(ow, oh))))
    # screen
    canvas.paste(shot, (ox + bezel, oy + bezel), rounded_mask((sw, sh), int(g['r_screen'] * min(sw, sh))))
    canvas.save(out_path, optimize=True); return (W, H)

if __name__ == '__main__':
    print(frame(sys.argv[1], sys.argv[2], sys.argv[3]))
