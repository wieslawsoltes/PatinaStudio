export const presets = [
    { id: 'copper', name: 'Aged copper', category: 'Metals', color: '#b46c36', secondary: '#3a251c', metallic: .95, roughness: .32, height: .5, scale: 5, detail: .28, pattern: 1, description: 'Warm copper with subtle hammered grain' },
    { id: 'patina', name: 'Verdigris', category: 'Metals', color: '#3d9c88', secondary: '#183e38', metallic: .48, roughness: .69, height: .53, scale: 7, detail: .55, pattern: 2, description: 'Layered mineral oxidation and weathering' },
    { id: 'brass', name: 'Brushed brass', category: 'Metals', color: '#cfa964', secondary: '#755123', metallic: 1, roughness: .3, height: .5, scale: 6, detail: .25, pattern: 3, description: 'Fine directional tooling on warm brass' },
    { id: 'titanium', name: 'Titanium', category: 'Metals', color: '#a1afbf', secondary: '#424c5b', metallic: 1, roughness: .25, height: .5, scale: 8, detail: .2, pattern: 3, description: 'Cool satin metal with a directional finish' },
    { id: 'ceramic', name: 'Porcelain', category: 'Surfaces', color: '#e7e4d5', secondary: '#c1bca8', metallic: 0, roughness: .17, height: .5, scale: 4, detail: .07, pattern: 1, description: 'Glazed ceramic with a gentle microtexture' },
    { id: 'rubber', name: 'Soft rubber', category: 'Surfaces', color: '#282c2b', secondary: '#101313', metallic: 0, roughness: .83, height: .49, scale: 11, detail: .35, pattern: 1, description: 'Dense matte rubber and fine surface grain' },
    { id: 'paint', name: 'Signal orange', category: 'Paints', color: '#e56932', secondary: '#a74721', metallic: .12, roughness: .35, height: .52, scale: 5, detail: .16, pattern: 1, description: 'Industrial powder-coated enamel' },
    { id: 'enamel', name: 'Deep teal', category: 'Paints', color: '#226e73', secondary: '#123b40', metallic: .25, roughness: .24, height: .5, scale: 8, detail: .15, pattern: 1, description: 'Rich low-gloss teal enamel' },
    { id: 'wood', name: 'Smoked oak', category: 'Organic', color: '#997043', secondary: '#3e2a1d', metallic: 0, roughness: .61, height: .5, scale: 5, detail: .4, pattern: 4, description: 'Flowing grain and dark natural pores' },
    { id: 'stone', name: 'Basalt', category: 'Organic', color: '#7b7e78', secondary: '#303733', metallic: 0, roughness: .87, height: .5, scale: 7, detail: .65, pattern: 5, description: 'Volcanic stone with a coarse mineral grain' },
    { id: 'fabric', name: 'Woven linen', category: 'Organic', color: '#c8b896', secondary: '#82765f', metallic: 0, roughness: .96, height: .53, scale: 12, detail: .4, pattern: 6, description: 'Interleaved woven fibers and soft highlights' },
    { id: 'gold', name: 'Champagne gold', category: 'Metals', color: '#e7c88c', secondary: '#a37d3c', metallic: 1, roughness: .2, height: .5, scale: 5, detail: .1, pattern: 1, description: 'A polished pale gold finish' }
];
export const brushes = [{ id: 'round', name: 'Soft round', shape: 0, hardness: .3, spacing: .16 }, { id: 'hard', name: 'Hard round', shape: 0, hardness: .93, spacing: .12 }, { id: 'chalk', name: 'Dry chalk', shape: 1, hardness: .72, spacing: .18 }, { id: 'spray', name: 'Fine spray', shape: 2, hardness: .2, spacing: .17 }, { id: 'scratch', name: 'Scratch', shape: 3, hardness: .86, spacing: .13 }, { id: 'square', name: 'Square', shape: 4, hardness: .78, spacing: .16 }];
export const hexToRGB = h => {
    h = h.replace('#', '');
    if (h.length === 3)
        h = h.split('').map(x => x + x).join('');
    const x = parseInt(h, 16) || 0;
    return [(x >> 16 & 255) / 255, (x >> 8 & 255) / 255, (x & 255) / 255];
};
export const rgbToHex = a => '#' + a.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
export const materialById = id => structuredClone(presets.find(p => p.id === id) || presets[0]);
const fract = x => x - Math.floor(x), mix = (a, b, t) => a + (b - a) * t;
export function hash(x, y) {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}
export function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y), u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), u), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
export function fbm(x, y) {
    let s = 0, a = .5;
    for (let i = 0; i < 5; i++) {
        s += noise(x, y) * a;
        x = x * 2.03 + 3.7;
        y = y * 2.03 + 1.8;
        a *= .5;
    }
    return s;
}
/** Reference material evaluation, shared by CPU fallback and thumbnails. */
export function sampleMaterial(m, u, v) {
    const a = hexToRGB(m.color), b = hexToRGB(m.secondary), s = m.scale || 5, n = fbm(u * s, v * s), grain = noise(u * 420, v * 420);
    let f = .72 + n * .28, h = .5 + (grain - .5) * m.detail * .08;
    if (m.pattern === 2) {
        f = Math.min(1, Math.max(0, (n - .25) * 1.7));
        h = .48 + n * .08 + (grain - .5) * .024;
    }
    if (m.pattern === 3) {
        f = .75 + noise(u * 9, v * 900) * .25;
        h = .5 + (f - .85) * .016;
    }
    if (m.pattern === 4) {
        f = .5 + .5 * Math.sin(u * s * 16 + fbm(u * s, v * s) * 12);
        h = .48 + f * .04;
    }
    if (m.pattern === 5) {
        f = n * .6 + grain * .4;
        h = .44 + f * .12;
    }
    if (m.pattern === 6) {
        f = .7 + .3 * Math.sin(u * s * 35) * Math.sin(v * s * 35);
        h = .46 + f * .08;
    }
    const color = a.map((c, i) => mix(b[i], c, f));
    return { color, metallic: m.metallic, roughness: Math.max(.045, Math.min(1, m.roughness + (grain - .5) * m.detail * .15)), height: Math.max(0, Math.min(1, h + (m.height - .5))) };
}
/** Deterministic material-ball previews; no external thumbnail assets. */
export function drawMaterialPreview(canvas, m) {
    const n = canvas.width = canvas.height = 112, ctx = canvas.getContext('2d'), im = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const nx = (x - n / 2) / (n * .42), ny = (n / 2 - y) / (n * .42), r = nx * nx + ny * ny, k = (y * n + x) * 4;
            if (r > 1)
                continue;
            const z = Math.sqrt(1 - r), u = .5 + Math.atan2(nx, z) / (2 * Math.PI), v = Math.acos(ny) / Math.PI, s = sampleMaterial(m, u, v), nl = Math.max(0, nx * -.38 + ny * .68 + z * .64), spec = Math.pow(Math.max(0, nx * -.25 + ny * .4 + z * .88), Math.max(5, 100 * (1 - s.roughness))), rim = Math.pow(1 - z, 3) * .22;
            for (let c = 0; c < 3; c++)
                im.data[k + c] = Math.min(255, (s.color[c] * (.25 + nl * .87) + spec * (.1 + s.metallic * .4) + rim) * 255);
            im.data[k + 3] = 255;
        }
    ctx.putImageData(im, 0, 0);
}
