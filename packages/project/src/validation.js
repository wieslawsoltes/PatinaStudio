/** Validate untrusted project JSON before allocating textures or inserting UI data. */
export function validateProject(project) {
    const fail = message => {
        throw new Error(message);
    };
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const number = (value, min, max, label) => {
        if (!Number.isFinite(value) || value < min || value > max)
            fail(`Invalid ${label}.`);
    };
    const text = (value, max, label) => {
        if (typeof value !== 'string' || value.length > max)
            fail(`Invalid ${label}.`);
    };
    const color = value => {
        if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))
            fail('Invalid material or brush color.');
    };
    if (!record(project) || project.format !== 'patina-project' || project.version !== 1)
        fail('Not a supported PatinaStudio project.');
    text(project.name, 200, 'project name');
    if (![256, 512, 1024, 2048].includes(project.resolution))
        fail('Unsupported texture resolution.');
    if (!Array.isArray(project.layers) || project.layers.length > 24)
        fail('A project supports at most 24 layers.');
    let totalPoints = 0;
    const validateStroke = stroke => {
        if (!record(stroke) || !record(stroke.settings) || ![0, 1, 2, 3].includes(stroke.mode))
            fail('Invalid stroke settings.');
        const b = stroke.settings;
        color(b.color);
        number(b.radius, 0.00001, 0.5, 'brush radius');
        for (const key of ['metallic', 'roughness', 'height', 'hardness', 'flow'])
            number(b[key], 0, 1, `brush ${key}`);
        if (!Number.isInteger(b.shape) || b.shape < 0 || b.shape > 4)
            fail('Invalid brush shape.');
        for (const key of ['pressureSize', 'pressureOpacity'])
            if (typeof b[key] !== 'boolean')
                fail(`Invalid ${key}.`);
        if (!Array.isArray(stroke.points) || stroke.points.length > 250000)
            fail('Invalid stroke.');
        totalPoints += stroke.points.length;
        if (totalPoints > 2000000)
            fail('The project exceeds two million brush stamps.');
        for (const point of stroke.points) {
            if (!Array.isArray(point) || point.length !== 3)
                fail('Invalid stroke point.');
            for (const v of point)
                number(v, 0, 1, 'stroke point');
        }
    };
    const ids = new Set();
    for (const layer of project.layers) {
        if (!record(layer) || typeof layer.id !== 'string' || !/^[\w-]{1,100}$/.test(layer.id) || ids.has(layer.id))
            fail('Duplicate or missing layer ID.');
        ids.add(layer.id);
        text(layer.name, 250, 'layer name');
        if (!['paint', 'fill'].includes(layer.type))
            fail('Invalid layer type.');
        if (typeof layer.visible !== 'boolean')
            fail('Invalid visibility.');
        number(layer.opacity, 0, 1, 'layer opacity');
        if (!['normal', 'multiply', 'screen', 'overlay', 'add'].includes(layer.blend))
            fail('Invalid blend mode.');
        if (!Array.isArray(layer.channels) || layer.channels.length !== 4 || layer.channels.some(v => typeof v !== 'boolean'))
            fail('Invalid channel flags.');
        if (!['none', 'edge', 'cavity', 'oxidation', 'dirt', 'noise'].includes(layer.generator))
            fail('Invalid generator.');
        number(layer.generatorAmount, 0, 1, 'generator amount');
        if (!Array.isArray(layer.strokes) || layer.strokes.length > 20000)
            fail('Invalid stroke history.');
        if (!record(layer.mask) || typeof layer.mask.enabled !== 'boolean' || !Array.isArray(layer.mask.strokes) || layer.mask.strokes.length > 20000)
            fail('Invalid mask.');
        number(layer.mask.base, 0, 1, 'mask base');
        for (const stroke of layer.strokes)
            validateStroke(stroke);
        for (const stroke of layer.mask.strokes)
            validateStroke(stroke);
        if (layer.type === 'fill' && !record(layer.material))
            fail('Fill material missing.');
        if (layer.material !== null) {
            const m = layer.material;
            if (!record(m))
                fail('Invalid material.');
            color(m.color);
            color(m.secondary);
            for (const key of ['metallic', 'roughness', 'height', 'detail'])
                number(m[key], 0, 1, `material ${key}`);
            number(m.scale, 0.1, 100, 'material scale');
            if (!Number.isInteger(m.pattern) || m.pattern < 0 || m.pattern > 6)
                fail('Invalid material pattern.');
        }
        // Portable projects cannot trigger arbitrary network requests or embed SVG scripts.
        if (layer.image !== undefined && (typeof layer.image !== 'string' || layer.image.length > 40 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(layer.image)))
            fail('Invalid embedded raster image.');
    }
    if (project.selectedLayer !== null && !ids.has(project.selectedLayer))
        fail('Selected layer is missing.');
    if (!record(project.mesh))
        fail('Mesh missing.');
    if (project.mesh.primitive !== undefined) {
        if (!['artifact', 'sphere', 'cube', 'torus'].includes(project.mesh.primitive))
            fail('Invalid primitive.');
    }
    else {
        const m = project.mesh.data;
        if (!record(m))
            fail('Mesh data missing.');
        for (const key of ['positions', 'normals', 'uvs', 'indices'])
            if (!Array.isArray(m[key]))
                fail('Invalid mesh arrays.');
        const count = m.positions.length / 3;
        if (!Number.isInteger(count) || count < 3 || count > 1000000 || m.indices.length < 3 || m.indices.length > 6000000 || m.indices.length % 3 || m.normals.length !== m.positions.length || m.uvs.length !== count * 2)
            fail('Invalid mesh dimensions.');
        for (const v of m.positions)
            number(v, -1000000, 1000000, 'vertex');
        for (const v of m.normals)
            number(v, -1.001, 1.001, 'normal');
        for (const v of m.uvs)
            number(v, 0, 1, 'single-tile UV');
        for (const v of m.indices)
            if (!Number.isInteger(v) || v < 0 || v >= count)
                fail('Invalid triangle index.');
    }
    if (project.bake !== undefined) {
        const b = project.bake;
        if (!record(b) || ![128, 256, 512].includes(b.resolution))
            fail('Invalid bake resolution.');
        const expectedLength = 4 * Math.ceil(b.resolution * b.resolution * 4 / 3);
        for (const key of ['geometry', 'surface'])
            if (typeof b[key] !== 'string' || b[key].length !== expectedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(b[key]))
                fail('Invalid baked map data.');
    }
    return project;
}
