# OpenStreetMap for Lightroom 6.14

**Experimental Map module replacement for Lightroom 6.14 on Windows.**

Restore map display and manual photo geotagging using OpenStreetMap tiles,
without a Google API key or a local runtime server.

This is a partial restoration, not a complete replacement for the original
Google Maps integration. **Address search, automatic address lookup, and map
themes/styles are not implemented.**

## What works?

| Feature | Status |
|---|---|
| Display OpenStreetMap tiles in Lightroom | Confirmed in Lightroom |
| Drag photos onto the map to set GPS coordinates | Confirmed in Lightroom |
| Update photo positions by dragging photos onto the map | Confirmed in Lightroom |
| Markers, clusters, marker dragging, Navigator rectangles, location-preset overlays, and drag-zoom | Exercised in the development browser harness; not exhaustively verified in Lightroom |
| Address/place search | Disabled |
| Automatic city/state/country lookup | Disabled |
| Light/dark themes and different map styles | Not implemented; all selections show the same standard OSM map |
| Satellite imagery and Street View | Not provided |
| Other Lightroom versions or macOS | Not validated |

## Before you start

- You need your own installed, licensed copy of Lightroom 6.14 for Windows.
- Back up the original `Location.lrmodule` and your catalog before experimenting.
- Close Lightroom before replacing its module.
- This repository provides source and build scripts, **not Adobe's module**.
  Build your replacement locally; do not commit or redistribute the original or
  patched Adobe binary.
- This is an unofficial project, not affiliated with Adobe, Google, Leaflet, or
  the OpenStreetMap Foundation. Use at your own risk.

## Requirements

For building:

- Windows PowerShell.
- Python 3, available as `python` (development used Python 3.11).
- [Resource Hacker](https://www.angusj.com/resourcehacker/) (development used
  version 5.1.8.360).
- The original `Location.lrmodule` from Lightroom 6.14.

No Google account or API key is required. An internet connection is needed to
load tiles when using the map.

Java and unluac are only needed for optional decompilation. Node.js and
Playwright were used during development, but are not required to build or use
the module.

## Build

1. Download or clone this repository and open PowerShell in its root folder.
2. Copy the **original** `Location.lrmodule` from the Lightroom installation into
   the repository root. Keep a separate untouched backup.
3. Set the Resource Hacker executable path and run the build:

   ```powershell
   $env:RESOURCE_HACKER = 'C:\Tools\ResourceHacker\ResourceHacker.exe'
   .\build-osm-module.ps1
   ```

   Replace the example executable path with your actual installation path.

The result is:

```text
_build_\Location.lrmodule
```

You can also pass paths explicitly:

```powershell
.\build-osm-module.ps1 `
    -ModulePath .\Location.lrmodule `
    -OutputPath .\_build_\Location.lrmodule `
    -ResourceHackerPath 'C:\Tools\ResourceHacker\ResourceHacker.exe' `
    -Python python
```

The build extracts resources, bundles Leaflet and the compatibility shim,
patches four Lua resources, writes a new module, and re-extracts it to verify the
replacement payloads. It does not modify the original input file.

**Build-directory warning:** each build recreates the `work` directory next to
the selected output file. Use a dedicated output folder. Rebuilding requires the
original module, not an already-patched copy.

### Optional: another tile server

```powershell
.\build-osm-module.ps1 -TileUrl 'https://example.com/{z}/{x}/{y}.png'
```

The URL must contain `{z}`, `{x}`, and `{y}`. This changes only the tile template,
not the connectivity probe or attribution. Those still refer to OpenStreetMap.
Review the shim attribution and connectivity patch, as well as the provider's
license, authentication, and usage policy, before using another service.
This option does not add map themes or satellite support automatically.

## Install and roll back

1. Close Lightroom.
2. Find `Location.lrmodule` in the Lightroom installation folder.
3. Back it up to a safe location outside the installation folder.
4. Copy the newly built `_build_\Location.lrmodule` into the installation folder,
   replacing the installed module. Windows may require administrator permission.
5. Start Lightroom and open the Map module.

For rollback, close Lightroom and restore your original module backup.

In Lightroom's Catalog Settings, under Metadata, disable the option to look up
city, state, and country from GPS coordinates. The replacement does not provide
that service.

## Known limitations and troubleshooting

### Search returns no results

This is expected. The geocoder is currently a stub; no replacement address-search
service has been implemented. OpenStreetMap tiles provide the map pictures, not
an address-search API.

### Changing the map style has no effect

This is expected. All Lightroom style selections use the same OSM tile layer.
Light/dark rendering, terrain, and satellite imagery are not implemented.

### Lightroom shows an offline message

The connectivity check requests `https://tile.openstreetmap.org/0/0/0.png`.
Check internet access, firewall/proxy settings, and tile-service availability.
When using a custom tile template, this probe still checks the OSM service.

### A script reports that a patch string was not found

Verify that the input is an untouched Lightroom 6.14 Windows module. Other
versions or previously patched files may not contain the expected constants.
Do not ignore patch or verification failures.

### Lightroom reports a missing URL `authority` on startup

An early development build used a hostless loader marker, which Lightroom's
URL-signing code could not process. Current patches use
`https://osm-shim.invalid/` instead. Rebuild from the original module with the
current source. This dummy address is intercepted by the shim; no server is
required at that address.

## How it works

Lightroom's module contains compiled Lua resources, embedded map-page
JavaScript, and image assets. The existing page expects Google's `google.maps`
API.

The replacement embeds Leaflet 1.9.4 and a compatibility layer in the existing
`MARKERCLUSTERER.JS` resource. The layer implements the subset of Google Maps
interfaces that Lightroom uses and translates them to Leaflet. Four small Lua
string patches redirect the loader, disable geocoding, and change the
connectivity check.

The decompiled Lua is used for investigation, not recompiled for the build:
string constants are patched directly in the original bytecode.

See [OSM-DEVELOPMENT.md](OSM-DEVELOPMENT.md) for the complete extraction,
decompilation, architecture, packaging, testing, and startup-fix history.

### Optional resource inspection

Set `RESOURCE_HACKER` as shown above, then:

```powershell
.\extract-lrmodule.ps1
.\decompile-lrmodule.ps1 -UnluacPath .\_tools_\unluac.jar
```

Decompilation requires Java and your own unluac JAR. Extraction writes to
`_temp_`; decompilation writes to `_temp_decomp_`. Their `-Force` switches delete
existing output-directory contents, so use dedicated scratch directories.

## Validation and reporting problems

Map display and manual photo placement were confirmed in Lightroom. Additional
interactions were exercised in a local headless-Edge harness. That harness is
not included in this repository and does not replace testing Lightroom's
embedded browser, native bridge, or catalog operations.

For a useful bug report, include:

- Exact Lightroom and Windows versions.
- Whether you built from an untouched original module.
- Steps to reproduce and the exact error message.
- Relevant build-log excerpts and, if helpful, a screenshot.

Do not upload Adobe's module, catalog files, license information, API keys, or
private photo/location data.

Potential future work includes a geocoding adapter for search, real style
selection with appropriate tile providers, and a reusable automated test suite.
These are possibilities, not supported features or delivery commitments.

## Tile usage and attribution

The default server is `tile.openstreetmap.org`. Follow the
[OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/);
it is not an unlimited tile-download service. Do not use the module for bulk
downloading or offline prefetching.

The map displays OpenStreetMap contributor attribution. OSM data is available
under the [Open Database License](https://www.openstreetmap.org/copyright).

## Credits and licensing

- Based on the research and Lua patching approach in
  [astuder/lightroom-map-fix](https://github.com/astuder/lightroom-map-fix).
- [patchluastr.py](patchluastr.py), by Adrian Studer, retains its MIT license
  notice.
- [Leaflet](https://leafletjs.com/) 1.9.4 is bundled under its
  [BSD-2-Clause license](osm/vendor/leaflet/LICENSE).
- See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for dependency notices.

Original project contributions are licensed under the [MIT License](LICENSE).
Third-party components retain their respective licenses and copyright notices.
Neither the project license nor those third-party licenses grant rights to
Adobe's software.
