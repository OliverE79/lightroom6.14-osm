# Developing the OpenStreetMap replacement for Lightroom 6.14

This document records the development path from the original Windows
`Location.lrmodule` to the working OpenStreetMap replacement: resource extraction,
Lua decompilation, investigation, implementation, packaging, and validation.

The target was Lightroom 6.14 on Windows. Other Lightroom versions and macOS were
not validated. After the startup correction described below, the user confirmed
that the replacement worked in Lightroom. That confirmation is not an exhaustive
test of every Map module workflow.

## 1. Goal and scope

The upstream [astuder/lightroom-map-fix](https://github.com/astuder/lightroom-map-fix)
project's original fix substituted a Google API key. Its existing OSM
tile hack still depended on Google's JavaScript API to create and operate the
map. Replacing only the tile URL therefore could not remove the broken Google
dependency.

The chosen approach was to preserve Lightroom's map page and its callbacks, but
replace the Google implementation behind them:

```text
Lightroom Lua and embedded HTML/JavaScript
                    |
          google.maps compatibility API
                    |
              Leaflet 1.9.4
                    |
          OpenStreetMap raster tiles
```

Agreed scope:

- Embed the replacement scripts in the module, with no separate runtime server.
- Keep the existing marker, clustering, Navigator, and location-preset interfaces.
- Show standard OSM tiles for every map-style selection.
- Disable address search and reverse geocoding.
- Build a replacement Windows module without overwriting the original input.

## 2. Tools and working files

| Tool | Purpose |
|---|---|
| Windows PowerShell | Extraction, decompilation, and build orchestration |
| Resource Hacker | Extract and replace Windows resources; development used version 5.1.8.360 |
| Python 3 | Run the existing Lua string patcher and generate a binary resource file |
| Java and unluac | Decompile Lua bytecode for investigation |
| Leaflet 1.9.4 | Render the map and overlays |
| Node.js, playwright-core, Microsoft Edge | Run development browser tests |

Java, unluac, Node.js, Playwright, and Edge are investigation/test tools, not
requirements for running the patched module. The build itself needs PowerShell,
Python, Resource Hacker, the original module, and this repository's source files.

The development environment used Python 3.11 and Java 11.

| File or directory | Role |
|---|---|
| `Location.lrmodule` | Original module copied from the Lightroom installation |
| [extract-lrmodule.ps1](extract-lrmodule.ps1) | Resource extraction script |
| [decompile-lrmodule.ps1](decompile-lrmodule.ps1) | Decompilation and asset organization |
| `_temp_` | Raw extracted resources |
| `_temp_decomp_` | Decompiled Lua and organized assets |
| [osm/gmaps-leaflet-shim.js](osm/gmaps-leaflet-shim.js) | Google Maps compatibility adapter |
| [osm/vendor/leaflet/](osm/vendor/leaflet/) | Bundled Leaflet JavaScript, CSS, and license |
| [osm/patches/](osm/patches/) | Four Lua string-patch definitions |
| [patchluastr.py](patchluastr.py) | Existing Lua bytecode string patcher |
| [osm/make_res.py](osm/make_res.py) | Binary Win32 resource-file generator |
| [build-osm-module.ps1](build-osm-module.ps1) | End-to-end build and verification |
| `_temp_work_` | Local development harness and experiments |
| `_build_\Location.lrmodule` | Final patched module |

The temporary, tool, and build directories are ignored by Git. The browser
harness described below is local development material in an ignored directory,
not a committed, self-contained test suite.

## 3. Unpacking the module

### What the file contains

On Windows, `Location.lrmodule` is a PE module with embedded Windows resources,
not a ZIP archive or a directory tree. Resource entries are addressed by type,
name, and language. Dots in names such as `LOCATIONMAPVIEW.LUA` are part of the
resource name, not directory separators.

The inspected module contained 193 resources:

| Type | Count | Content |
|---|---:|---|
| LUA | 34 | Compiled Lua chunks |
| JS | 3 | JSON, KeyDragZoom, and MarkerClusterer scripts |
| PNG | 154 | Pins, controls, and other graphics |
| JPG | 1 | Offline-map image |
| Manifest | 1 | Windows manifest |

Resource Hacker's extraction also creates `resources.rc` and a log. Those two
files are extraction metadata, not additional module resources.

### Extraction command

Run the following from the repository root, substituting your Resource Hacker
installation path:

```powershell
$env:RESOURCE_HACKER = 'C:\Tools\ResourceHacker\ResourceHacker.exe'
.\extract-lrmodule.ps1 -ModulePath .\Location.lrmodule -OutputDir .\_temp_
```

The environment variable applies to the current PowerShell session. Alternatively,
pass `-ResourceHackerPath` explicitly. In this standalone repository, the scripts
require one of these settings rather than a development-machine-specific path.

Internally, the script invokes Resource Hacker with:

```text
-action extract -mask ,,
```

It checks the process exit code and the `Success!` log entry. The result includes
files such as:

```text
_temp_
  resources.rc
  resourcehacker.log
  LOCATIONMAPVIEW.LUA.bin
  LOCATIONNAVIGATORVIEW.LUA.bin
  MARKERCLUSTERER.JS.txt
  KEYDRAGZOOM.JS.txt
  JSON.JS.txt
  ...image and manifest resources...
```

An existing nonempty output directory is rejected unless `-Force` is supplied.
**`-Force` deletes its existing contents**, so use a dedicated scratch directory.

## 4. Decompiling and organizing the extracted content

Place unluac at `_tools_\unluac.jar`, or pass its location explicitly:

```powershell
.\decompile-lrmodule.ps1 `
    -InputDir .\_temp_ `
    -OutputDir .\_temp_decomp_ `
    -UnluacPath .\_tools_\unluac.jar
```

The Lua header begins with `1B 4C 75 61 51 00`, identifying Lua 5.1 bytecode.
For each Lua resource, the script runs `java -jar unluac.jar` and writes the
decompiled text as UTF-8. Failed decompilations are reported rather than silently
treated as successful output.

The script creates this organization for convenience:

```text
_temp_decomp_
  lua       Decompiled Lua
  js        Existing JavaScript copied with .js extensions
  images    PNG/JPG resources copied with image extensions
  other     Manifest, resource script, and extraction log
```

This structure is created by our script; it does not exist inside the module.
Only the Lua requires decompilation. JavaScript is already text, and images are
already usable binary assets. Native executable code is not decompiled.

As with extraction, `-Force` replaces the contents of the output directory.

**Important:** the decompiled Lua was used to understand the program. It was not
edited and recompiled into the final module. The final build patches string
constants in the original bytecode, preserving the existing instructions.

## 5. Understanding Lightroom's map implementation

The most useful decompiled resources were:

| Resource | What it revealed |
|---|---|
| `LOCATIONMAPVIEW.LUA` | Embedded HTML/JavaScript, Google loader URLs, initialization, marker operations, projection helpers, geocoder calls, and host callbacks |
| `LOCATIONNAVIGATORVIEW.LUA` | Navigator rectangles, bounds updates, and rectangle-drag behavior |
| `LOCATIONVIEWCONTROLLER.LUA` | Connectivity check that selects the map or offline message |
| `AGREVERSEGEOCODESERVICE.LUA` | Lua-side HTTP reverse-geocoding requests |
| `REVERSEGEOCODESERVICEFALLBACK.LUA` | Hidden browser-page geocoder fallback |
| `LOCATIONMODULE.LUA` and `LOCATIONDEBUGPANEL.LUA` | URL signing, later important for the startup fix |

Lightroom builds a browser page from Lua strings. That page loads bundled
resources through addresses under `lrres://map`, then dynamically appends the
Google loader script. The loader is expected to call `initialize`.

The page reports actions to Lightroom through `hosteval` callbacks. Keeping this
interface intact avoids replacing the surrounding Lightroom UI and controller
logic.

Investigation covered more than `google.maps.Map`: the page, MarkerClusterer,
and KeyDragZoom also require events, projections, overlays, marker icons, bounds,
and several constants. That inventory defined the adapter's required surface.

## 6. Implementing the Leaflet adapter

The implementation is in
[osm/gmaps-leaflet-shim.js](osm/gmaps-leaflet-shim.js). It supplies the subset of
`google.maps` used by Lightroom and its bundled scripts, not a complete general
replacement for Google's API.

| API surface | Purpose |
|---|---|
| `Map`, map-type constants, projection helpers | Map setup, navigation, bounds, and screen/location conversion |
| `LatLng`, `LatLngBounds`, `Point`, `Size` | Compatible coordinate and geometry values |
| Event helpers, `MVCObject`, `MVCArray` | Listener registration and object/array interfaces used by existing scripts |
| `OverlayView` and map panes | Support the original MarkerClusterer overlays |
| `Marker`, `MarkerImage` | Lightroom pins, anchors, hover icons, selection, and drag events |
| `Polyline`, `Polygon`, `Circle`, `Rectangle` | Paths, arrows, location presets, and Navigator bounds |
| `Geocoder`, `StreetViewPanorama` stubs | Keep callers functional without enabling those services |

The shim uses ES5-style JavaScript for Lightroom's older embedded browser.
Leaflet renders standard raster tiles from:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

Every map style resolves to the same OSM map. The shim inserts the bundled
Leaflet CSS into the document and displays OpenStreetMap attribution.

### Compatibility details discovered during development

- MarkerClusterer copies properties from `OverlayView.prototype`, so its
  interface must remain compatible with that older implementation.
- Overlay setup and redraws are scheduled to allow the existing initialization
  sequence to finish.
- Custom panes preserve the layering expected by clusters and other overlays.
- Marker icon changes update the image in place, keeping hover/drag interactions
  stable.
- Overlay mouse events are marked so they do not also trigger the underlying
  map's mouse handler. The Navigator test exposed a duplicate mousedown before
  this correction.
- Lightroom activates KeyDragZoom programmatically. Testing only an ordinary
  modifier-key gesture would not exercise its actual activation path.

### Intercepting the loader

The shim wraps `Node.prototype.appendChild` and `insertBefore`. When Lightroom
tries to append its map-loader script, the shim decodes its URL, recognizes the
`osm-shim` marker, and invokes the named callback asynchronously instead of
inserting the script.

This keeps Lightroom's existing `loadScript`/`initialize` sequence while avoiding
the Google loader request. The final placeholder uses
`https://osm-shim.invalid/`; it is a marker, not a service to contact.

## 7. Patching the original Lua bytecode

[patchluastr.py](patchluastr.py) locates string constants in Lua bytecode, replaces
the requested substrings, and updates their stored lengths. This allows URLs of
different lengths without recompiling the decompiled Lua.

The patch format uses `< ` for the old substring and `> ` for the replacement.
For example:

```text
< http://maps.google.com/maps/api/js?sensor=false
> https://osm-shim.invalid/?sensor=false
```

The final build applies these four patch files:

| Patch | Resource | Effect |
|---|---|---|
| [locationmapview.patch](osm/patches/locationmapview.patch) | `LOCATIONMAPVIEW.LUA` | Replace all three Google loader variants with dummy-host shim URLs |
| [agreversegeocodeservice.patch](osm/patches/agreversegeocodeservice.patch) | `AGREVERSEGEOCODESERVICE.LUA` | Redirect reverse-geocoding HTTP requests to `http://127.0.0.1:9/geocode-disabled?`, where failure is expected |
| [reversegeocodeservicefallback.patch](osm/patches/reversegeocodeservicefallback.patch) | `REVERSEGEOCODESERVICEFALLBACK.LUA` | Replace the fallback page's Google loader with `about:blank` |
| [locationviewcontroller.patch](osm/patches/locationviewcontroller.patch) | `LOCATIONVIEWCONTROLLER.LUA` | Check connectivity using the OSM tile at zoom 0 instead of Google's API |

The main loader's final replacement prefixes are:

```text
https://osm-shim.invalid/?%s
https://osm-shim.invalid/?testing=1
https://osm-shim.invalid/?sensor=false
```

The rest of each Lua string, including the callback and language parameters,
remains intact. Preserve the `%s` placeholders: Lightroom still supplies the
original `string.format` arguments.

Address search remains disabled because the JavaScript `Geocoder` stub returns
an empty result with `ZERO_RESULTS`. Lua-side reverse geocoding follows its
existing failure path. No replacement search provider was implemented.

## 8. Packaging the resources back into the module

### JavaScript bundle

Rather than introducing a new resource and changing the page's static script
references, the build replaces `MARKERCLUSTERER.JS` with this bundle:

```text
License/header comments
Leaflet JavaScript
window.__osmLeafletCss = <JSON-encoded Leaflet CSS>;
Google Maps-to-Leaflet shim
Original MarkerClusterer JavaScript
```

That order makes the compatibility API available before the original clusterer
uses it. `JSON.JS`, `KEYDRAGZOOM.JS`, and image resources are retained.

The build substitutes the tile URL into the shim, encodes the CSS as a JavaScript
string, and rejects non-ASCII bundle text.

### Resource Hacker dotted-name issue

During development, Resource Hacker masks naming resources such as
`JS,MARKERCLUSTERER.JS,1033` silently matched nothing, even with an exit code of
zero. Its resource-script compiler also rejected the dotted names in the tested
forms.

The workaround is [osm/make_res.py](osm/make_res.py), which creates a binary
Win32 `.res` file directly. It writes the five replacement entries with
UTF-16LE names, four-byte alignment, and language ID 1033 (`0x0409`), matching the
inspected module.

Resource Hacker then merges that file in one operation:

```text
-action addoverwrite -res <osm.res> -mask ,,
```

Exactly five resources are replaced: one JavaScript resource and four Lua
resources. The build requires five `Modified:` log entries rather than trusting
the process exit code alone.

## 9. Reproducing the final build

Keep an untouched original module at the repository root, set the Resource
Hacker path, and run:

```powershell
$env:RESOURCE_HACKER = 'C:\Tools\ResourceHacker\ResourceHacker.exe'
.\build-osm-module.ps1
```

Explicit paths are also supported:

```powershell
.\build-osm-module.ps1 `
    -ModulePath .\Location.lrmodule `
    -OutputPath .\_build_\Location.lrmodule `
    -ResourceHackerPath 'C:\Tools\ResourceHacker\ResourceHacker.exe' `
    -Python python
```

For another raster tile endpoint:

```powershell
.\build-osm-module.ps1 -TileUrl 'https://example.com/{z}/{x}/{y}.png'
```

The template must contain `{z}`, `{x}`, and `{y}`. This option only changes the
tile template: the connectivity check remains the OSM URL in its patch file,
and the attribution text remains the OSM attribution in the shim. A provider
change therefore also requires reviewing connectivity, attribution, licensing,
and authentication requirements.

The build does not require `_temp_` or `_temp_decomp_`; it extracts the input
module again into its own workspace:

```text
_build_
  Location.lrmodule
  work
    extracted       Original resources
    patched         Five replacement resource payloads
    osm.res         Binary resource collection
    addoverwrite.log
    Location.lrmodule
    verify          Resources re-extracted from the final module
```

It rejects using the input file as the output and rejects input already
containing the OSM shim. Each build removes and recreates the `work` directory
beneath the selected output directory; use a dedicated build location.

### Built-in verification

The build:

1. Checks extraction and resource-update success logs.
2. Rejects missing patch targets or reported patch errors.
3. Requires the expected five resource modifications.
4. Re-extracts the output and checks that the file count is unchanged.
5. Compares the hashes of all five extracted replacements with their generated
   payloads.
6. Warns if recognized Google Maps loader/geocoding URLs remain in Lua resources.

These checks verify packaging. They do not execute Lightroom, prove all UI
behavior, or check every possible network request.

For the inspected files, the original module was 1,052,120 bytes and the final
corrected output was 1,279,448 bytes. Sizes are useful development observations,
not a general compatibility check for another source module.

## 10. Browser validation during development

A local harness reconstructed the main and fixed-map pages from the embedded
HTML/JavaScript. It used the rebuilt bundle extracted from the output module,
copied the existing assets, redirected local resource references, recorded
`hosteval` calls, and collected JavaScript errors.

The development-only files were:

```text
_temp_work_\make_harness.py
_temp_work_\html\main.html
_temp_work_\html\fixed.html
_temp_work_\test.js
_temp_work_\test-nav.js
```

With those local files and their Playwright dependency present, the test sequence
was:

```powershell
python .\_temp_work_\make_harness.py
python -m http.server 8765 --bind 127.0.0.1 --directory .\_temp_work_\harness
```

In a second PowerShell window:

```powershell
node .\_temp_work_\test.js
node .\_temp_work_\test-nav.js
```

Stop the HTTP server with Ctrl+C afterwards. The server is needed only for these
tests, not for Lightroom.

Observed passing checks included:

- Initialization and the `onInitMap` host callback.
- Successfully loaded OSM tiles and no Google requests in the observed page load.
- Marker and cluster rendering, cluster-click callbacks, and a selected cluster
  count of 20.
- Marker hover icon changes, dragging, changed coordinates, and drag callbacks.
- Map mouse callbacks.
- Location-preset circle/handles and arrow-path rendering.
- KeyDragZoom initialization and a zoom increase from 12 to 14.
- Fixed-map initialization with dragging disabled.
- Navigator rectangle dragging, matching inner/outer bounds, and host callbacks.
- No collected JavaScript errors in the tested pages.

The coordinate-conversion helper result was also inspected. Some harness checks,
such as map mouse handling, were broad callback checks rather than exhaustive
assertions. The scripts print `FAIL`/`FAILED` diagnostics but do not consistently
set a failing exit code for failed assertions; inspect their output, not only
the exit status.

Headless modern Edge is not Lightroom's embedded browser. The harness also
substitutes host callbacks and a loader URL; it cannot test the native bridge,
Lua URL signing, catalog operations, or actual photo drag-and-drop end to end.

## 11. Startup failure and the final correction

The first Lightroom startup attempt failed with:

```text
?:0: attempt to concatenate field 'authority' (a nil value)
```

The initial loader marker was `osm-shim:?…`. This worked in the browser harness,
but did not include a URL authority (host).

Tracing the decompiled Lua revealed:

```text
LOCATIONMAPVIEW constructs loader URL
  -> LocationModule.debugLog(url)
  -> LocationDebugPanel.log(url, signing key)
  -> parse URL and sign it
  -> rebuild scheme://authority...
```

Despite the `debugLog` name, this path signs and reconstructs a URL. With the
hostless marker, `authority` was nil and the concatenation failed before the
browser could load the page.

All three loader replacements were changed to use `https://osm-shim.invalid/`.
This gives the signer a scheme and authority, while remaining recognizable by
the shim's loader interception.

The fallback page's `about:blank` was checked separately: it is inserted directly
as a script source and does not pass through that signing path.

The module was rebuilt, the embedded replacement strings were inspected, and
the browser tests passed again. The user then reported: **"Works now."**

The key lesson is that a loader URL must satisfy both Lightroom's Lua-side URL
processing and the JavaScript adapter. Testing only the latter missed the
startup failure.

## 12. Installing, rolling back, and understanding the result

1. Close Lightroom.
2. Back up the original `Location.lrmodule` from the Lightroom installation.
3. Copy `_build_\Location.lrmodule` into that installation, replacing the module.
4. Start Lightroom and open the Map module.
5. Restore the original backup to roll back, with Lightroom closed.

Keep the original module as the input for future builds, not the installed,
already-patched copy. Do not commit or redistribute Adobe's module as part of
this source documentation.

Current behavior and limitations:

- Maps use OpenStreetMap raster tiles through Leaflet, without a Google API key.
- All map-style choices show the same map; satellite/terrain imagery and Street
  View are not provided.
- Address search and reverse geocoding remain disabled. Disable the catalog
  Metadata option for looking up city, state, and country to avoid failed lookup
  attempts.
- A failed OSM connectivity probe can cause Lightroom to show its offline view.
- No separate local service is required in normal use.
- The user's successful Lightroom run complements, but does not replace,
  targeted checks of photo placement, tracks, saved locations, and other catalog
  workflows.

Search restoration was discussed afterwards as a possible future geocoder
adapter; it was not part of this implementation.

Use of the default tile service must comply with the
[OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Do not use this module for bulk tile downloading or assume unlimited service
availability. The shim displays OpenStreetMap attribution. Leaflet's
[BSD-2-Clause license](osm/vendor/leaflet/LICENSE) is included with the vendored
library.

## 13. Where to make future changes

- Map behavior, overlays, or event compatibility:
  [osm/gmaps-leaflet-shim.js](osm/gmaps-leaflet-shim.js).
- Embedded endpoint strings:
  [osm/patches/](osm/patches/).
- Bundle construction, packaging, or verification:
  [build-osm-module.ps1](build-osm-module.ps1).
- Binary resource serialization:
  [osm/make_res.py](osm/make_res.py).
- Investigation of a different module:
  start again with extraction and decompilation; do not assume its resource
  names, bytecode, languages, or call paths match this Lightroom 6.14 module.

After a source change, rebuild from the original module. Verify the output
resources, exercise the affected browser behavior, and validate in Lightroom
whenever Lua-side processing or the native application bridge is involved.
