# SongCut native Windows font resolver

This directory contains the policy-free, in-process DirectWrite provider used
by SongCut.  The DLL only collects raw operating-system metadata.  It does not
match a requested family, classify bold/regular, reject simulations, choose a
face, or decide glyph coverage.  Those decisions remain in Python.

## ABI

`include/scut_windows_font_resolver.h` defines a versioned C ABI
(`SCUT_FONT_ABI_VERSION == 1`).  Every POD starts with `abi_version` and
`struct_size`; malformed headers, pointers, counts, overflows and failed
HRESULTs are reported without exceptions escaping the DLL.

Stage 1 (`scut_font_resolver_enumerate`) refreshes/reads the DirectWrite system
font collection and returns every family/face candidate.  Each candidate has a
generation-scoped opaque ID, raw weight/style/stretch/simulation values, and
localized family/face/full/PostScript names.  No requested name or style is
accepted by this stage.

Stage 2 (`scut_font_resolver_inspect_face`) accepts a candidate ID and its
generation plus caller-provided UCS4 code points.  It returns the raw
`IDWriteFontFace` index/simulations, every file reference, local-loader/path
HRESULTs, and one glyph record per input code point.  A refresh increments the
generation and invalidates all earlier IDs; callers must enumerate again.

Both stages use a caller-owned two-call buffer contract: the first call passes
zero capacities and receives required record/blob sizes with
`SCUT_FONT_BUFFER_TOO_SMALL`; the second call supplies arrays and a UTF-16LE
blob.  The DLL never allocates returned memory.

Resolver operations are serialized per handle and may be called from different
threads.  Each exported call enters an MTA COM scope when possible.  A handle
must not be used after `scut_font_resolver_destroy`; destroy waits for active
operations and releases DirectWrite objects while COM is available.

## Build and native tests

The supported entry point is:

```text
.\packaging\build_native_font_resolver.ps1
```

The script resolves MSBuild from `-MSBuild`, `SONGCUT_MSBUILD`, `vswhere`, or
the standard Visual Studio installation, selects the installed v145/v143
platform tools, then builds x64 Release with `/MT`,
warnings-as-errors, Control Flow Guard, ASLR and DEP.  It runs the native ABI
and DirectWrite metadata smoke tests and prints the PE machine and DLL SHA-256.

The deterministic output paths are:

```text
build/native/windows_font_resolver/x64/Release/songcut_font_resolver.dll
build/native/windows_font_resolver/x64/Release/songcut_font_resolver_tests.exe
```

Only system `dwrite.lib` and `ole32.lib` are linked; no helper process or
third-party runtime is used.
