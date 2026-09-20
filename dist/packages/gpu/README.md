# @patina/gpu

Native WebGPU resources and compute kernels. ESM source package, version 0.1.0.

## Public API

`GPUContext`, `fillWGSL`, `brushWGSL`, `compositeWGSL`, `normalWGSL`; full kernel exports via @patina/gpu/kernels.

## Host contract

Requires a browser WebGPU adapter. Shader diagnostics and device errors are surfaced; allocation, copying, readback and destruction are explicit.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
