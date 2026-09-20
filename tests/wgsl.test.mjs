import test from 'node:test';
import assert from 'node:assert/strict';
import { brushWGSL, fillWGSL, compositeWGSL, normalWGSL } from '../packages/gpu/src/kernels.js';
import { meshWGSL, fullscreenWGSL } from '../packages/renderer/src/shaders.js';

// Regression for "Pressure brush: 27:31 'target' is a reserved keyword".
// Test the assembled shader strings, including interpolated shared code.
// This guard is intentionally not a WGSL parser; the browser CI test compiles
// and executes the real shaders using Chromium's WebGPU implementation.
// WGSL reserved words: https://www.w3.org/TR/WGSL/#reserved-words
for (const [name, source] of Object.entries({
    brushWGSL, fillWGSL, compositeWGSL, normalWGSL, meshWGSL, fullscreenWGSL
})) {
    test(`${name} does not use the WGSL-reserved target token`, () => {
        assert.doesNotMatch(source, /\btarget\b/,
            `${name}: use a descriptive identifier such as maskValue instead of target`);
    });
}
