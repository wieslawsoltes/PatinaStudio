export const FORMAT = 'patina-project', VERSION = 1;
export const uuid = () => globalThis.crypto?.randomUUID?.() || 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export function newLayer(type = 'paint', material = null, name) {
    return { id: uuid(), type, name: name || (type === 'fill' ? 'Fill layer' : 'Paint layer'), visible: true, opacity: 1, blend: 'normal', channels: [true, true, true, true], material: material ? structuredClone(material) : null, generator: 'none', generatorAmount: .5, mask: { enabled: false, base: 1, strokes: [] }, strokes: [] };
}
export function createProject() {
    return { format: FORMAT, version: VERSION, name: 'Artifact 07', resolution: 1024, mesh: { primitive: 'artifact' }, layers: [], selectedLayer: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
import { validateProject } from './validation.js';
export { validateProject };
/** Immutable checkpoints of semantic edits. Pixels are reconstructed by replay. */
export class History {
    constructor(limit = 40) {
        this.limit = limit;
        this.past = [];
        this.future = [];
        this.bytes = 0;
        this.maxBytes = 64 * 1024 * 1024;
    }
    push(project, label = 'Edit') {
        const json = JSON.stringify(project);
        this.past.push({ json, label });
        this.bytes += json.length * 2;
        this.future = [];
        while (this.past.length > this.limit || (this.bytes > this.maxBytes && this.past.length > 1)) {
            this.bytes -= this.past.shift().json.length * 2;
        }
    }
    undo(current) {
        if (!this.past.length)
            return null;
        const s = this.past.pop();
        this.bytes -= s.json.length * 2;
        this.future.push({ json: JSON.stringify(current), label: s.label });
        return { project: JSON.parse(s.json), label: s.label };
    }
    redo(current) {
        if (!this.future.length)
            return null;
        const s = this.future.pop(), json = JSON.stringify(current);
        this.past.push({ json, label: s.label });
        this.bytes += json.length * 2;
        return { project: JSON.parse(s.json), label: s.label };
    }
    clear() {
        this.past = [];
        this.future = [];
        this.bytes = 0;
    }
}
export class ProjectStore {
    async open() {
        if (this.db)
            return this.db;
        this.db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('PatinaStudio', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('projects');
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        return this.db;
    }
    async save(project) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            tx.objectStore('projects').put(structuredClone(project), 'autosave');
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || Error('Save aborted'));
        });
    }
    async load() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const r = db.transaction('projects', 'readonly').objectStore('projects').get('autosave');
            r.onsuccess = () => resolve(r.result ? validateProject(r.result) : null);
            r.onerror = () => reject(r.error);
        });
    }
}
